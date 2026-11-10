import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Cache} from '../lib/cache.js';
import {readConfig} from '../lib/config.js';
import {FetchGuard} from '../lib/fetch-guard.js';
import {normalizeActive, cycleVendor, enabledVendors} from '../lib/config-resolve.js';
import {writeActiveVendorMirror} from '../lib/active-vendor.js';
import {request, disposeSession} from '../lib/http.js';
import {getAdapter} from '../lib/vendors/registry.js';
import {vendorLabel, vendorIconName, GENERIC_ICON} from '../lib/vendors.js';
import {renderSection} from './vendorSection.js';
import {errorText} from '../lib/vendors/section-common.js';
import {scanSessions} from '../lib/context/scan.js';
import {substitute, tooltipRows, vformat, withPaceArrow} from '../lib/format.js';
import {decide, Urgency} from '../lib/notify.js';
import {severityColor, Severity} from '../lib/severity.js';
import {defaultTheme, withOverrides} from '../lib/theme.js';
import {parseFakePct, FAKE_PCT_ENV} from '../lib/debug.js';
import {
    RELEASES_API_URL, RELEASES_PAGE_URL, afterCheck, availableUpdate, isDue, parseLatestTag,
} from '../lib/update-check.js';
import {readUpdateState, writeUpdateState} from '../lib/update-store.js';

const RERENDER_INTERVAL_S = 60;
// Claude Code transcripts belong to the Claude section only.
const CONTEXT_VENDOR = 'anthropic';
const STALE_MARK = ' ⏸';
const TOOLTIP_DELAY_MS = 400;

// Panel badge for a vendor: its short code, upper-cased (e.g. "CLD", "GPT");
// a provider named by the user derives it from the configured name.
function vendorTag(id, config) {
    const adapter = getAdapter(id);
    return (adapter.shortCode ? adapter.shortCode(config) : adapter.vendorShort).toUpperCase();
}

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(settings, openPreferences, extensionPath, version) {
        const config = readConfig(settings);
        // Centered like the clock's menu when beside it; _place() rebuilds on a box change.
        super._init(config.panel.box === 'center' ? 0.5 : 0.0, 'ai-usagebar');

        // Pin the whole popup to a consistent width (see .aiusagebar-popup). Set
        // on the menu's item box so it holds regardless of which vendor sub-menu
        // is expanded, rather than on a per-section container nested in a submenu.
        this.menu.box.add_style_class_name('aiusagebar-popup');

        this._settings = settings;
        this._openPreferences = openPreferences;
        this._path = extensionPath;
        this._version = version;
        this._updateCheckBusy = false;
        this._config = config;
        this._barFormat = this._config.barFormat;

        this._cancellable = new Gio.Cancellable();
        this._fetchGuard = new FetchGuard();
        this._activeId = normalizeActive(this._config);
        this._adapter = getAdapter(this._activeId);
        this._cache = Cache.forVendor(this._adapter.cacheId);
        this._theme = defaultTheme();
        this._rebuildTheme();
        this._timeoutId = null;
        this._renderTimeoutId = null;
        this._openStateId = null;
        this._scrollId = null;
        this._settingsChangedId = null;
        this._destroyed = false;

        // Dev override: AI_USAGEBAR_FAKE_PCT=<0..100> short-circuits the real
        // fetch with a synthetic snapshot at that percentage (see `make run`).
        this._fakePct = parseFakePct(GLib.getenv(FAKE_PCT_ENV));
        if (this._fakePct !== null)
            log(`ai-usagebar: ${FAKE_PCT_ENV}=${this._fakePct}, overriding usage fetch`);

        // Lazy per-vendor data: only the active vendor is polled; other sub-sections
        // render from whatever is already here. `_fetchedAt` pins each vendor's
        // footer timestamp to its real fetch instant across live re-renders.
        this._results = new Map();      // vendorId -> FetchResult
        this._notifySource = null;
        this._sessions = null;          // last context scan for CONTEXT_VENDOR
        this._fetchedAt = new Map();    // vendorId -> Date
        this._vendorItems = new Map();  // vendorId -> PopupMenu.PopupSubMenuMenuItem
        this._enabledSig = '';

        this._box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._tag = new St.Label({
            style_class: 'aiusagebar-panel-tag',
            text: vendorTag(this._activeId, this._config),
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        this._tagIcon = new St.Icon({
            style_class: 'aiusagebar-vendor-icon',
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._tagIcon);
        this._box.add_child(this._tag);
        this._box.add_child(this._label);
        this.add_child(this._box);
        this._setVendorTag(this._activeId);

        // Footer is a single non-reactive row of icon-only action buttons
        // (handlers connected once); per-vendor sub-sections are inserted above
        // the separator on (re)build. A lazily-created tooltip label (shared by
        // all three buttons) lives in the uiGroup and is torn down in destroy().
        this._tooltip = null;
        this._tooltipTimeoutId = null;
        this._separator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._separator);
        this._actionsItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const actionsBox = new St.BoxLayout({
            style_class: 'aiusagebar-actions',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        actionsBox.add_child(this._makeActionButton('view-refresh-symbolic', _('Refresh now'), () =>
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`))));
        actionsBox.add_child(this._makeActionButton('emblem-synchronizing-symbolic', _('Refresh all'), () =>
            this._refreshAll().catch(e => console.warn(`ai-usagebar: refresh all failed: ${e}`))));
        actionsBox.add_child(this._makeActionButton('preferences-system-symbolic', _('Preferences'), () =>
            this._openPreferences?.()));
        this._actionsItem.add_child(actionsBox);
        this.menu.addMenuItem(this._actionsItem);

        this._updateItem = new PopupMenu.PopupImageMenuItem('', 'software-update-available-symbolic');
        this._updateItem.visible = false;
        this._updateItem.connect('activate', () => this._openReleasesPage());
        this.menu.addMenuItem(this._updateItem);

        // Seed the active vendor with a Loading… state so its sub-section (and an
        // immediately-opened popup) is never empty before the first fetch lands.
        this._results.set(this._activeId, {ok: false, kind: 'loading'});
        this._rebuildVendorSections(this._config);

        // Live countdowns: re-render the active sub-section only while open.
        this._openStateId = this.menu.connect('open-state-changed', (_m, open) => {
            if (this._destroyed)
                return;
            if (open)
                this._onPopupOpen();
            else
                this._onPopupClose();
        });

        this._scrollId = this.connect('scroll-event', (actor, event) => this._onScroll(actor, event));

        // React to settings changes (prefs / gsettings / scroll write) immediately.
        this._settingsChangedId = this._settings.connect('changed', (s, key) => this._onSettingsChanged(s, key));

        // One immediate refresh, then poll. A rejected promise must never escape
        // into the timeout callback / event loop.
        this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
        this._rearmPollTimer(this._config.refreshIntervalSecs);
        this._checkForUpdate();
    }

    _rearmPollTimer(secs) {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
            this._checkForUpdate();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onSettingsChanged(settings, key) {
        if (this._destroyed)
            return;

        // A primary-vendor change forces active := primary. The set_string re-enters
        // this handler as key='active-vendor'; GSettings emits nothing for an
        // unchanged value, so there is no recursion. Return so the active-vendor
        // re-entry does the re-resolve/fetch below exactly once.
        if (key === 'primary-vendor') {
            const primary = settings.get_string('primary-vendor');
            if (settings.get_string('active-vendor') !== primary) {
                settings.set_string('active-vendor', primary);
                writeActiveVendorMirror(primary);
                return;
            }
        }

        const config = readConfig(this._settings);

        // Interval change: re-arm the timer (cadence only, no fetch).
        if (key === 'refresh-interval') {
            this._config = config;
            this._rearmPollTimer(config.refreshIntervalSecs);
            return;
        }

        if (key === 'update-check-enabled') {
            this._config = config;
            this._checkForUpdate();
            return;
        }

        // Active vendor changed (scroll write, primary sync, or a disable that
        // bumped the fallback): _refresh swaps adapter + cache, rebuilds sub-menus,
        // and fetches; a cache-warm revisit skips the network via the 60s TTL.
        if (normalizeActive(config) !== this._adapter.id) {
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
            return;
        }

        // Same active vendor: reflect config in-process only (no fetch).
        this._config = config;
        this._barFormat = config.barFormat;
        this._setVendorTag(this._activeId);
        this._maybeRebuildVendorSections(config);

        // Appearance-only keys (severity colors, popup format, pace marker) affect
        // every built section, not just the active one: rebuild the theme on a
        // color change and re-render all sub-sections. Everything else repaints
        // just the active section.
        if (key.startsWith('color-'))
            this._rebuildTheme();
        if (key.startsWith('color-') || key === 'tooltip-format' || key === 'show-pace-marker')
            this._reRenderAllSections();
        else
            this._reRenderFromCache();
    }

    // The custom provider's name is its sub-menu label and the logos toggle
    // swaps every header icon, so either one rebuilds the sub-menus too.
    _enabledSignature(config) {
        return `${enabledVendors(config).join(',')}|${config.vendors.custom.name}|${config.showVendorIcons}`;
    }

    _maybeRebuildVendorSections(config) {
        if (this._enabledSignature(config) !== this._enabledSig)
            this._rebuildVendorSections(config);
    }

    _rebuildVendorSections(config) {
        for (const item of this._vendorItems.values())
            item.destroy();
        this._vendorItems.clear();

        enabledVendors(config).forEach((id, idx) => {
            const sub = new PopupMenu.PopupSubMenuMenuItem('', true);
            sub.icon.gicon = this._vendorGicon(id);
            sub.label.text = vendorLabel(id, config);
            this.menu.addMenuItem(sub, idx);
            this._vendorItems.set(id, sub);
            this._renderVendorSection(id);
        });

        this._enabledSig = this._enabledSignature(config);
        this._setActiveExpansion(this._activeId);
    }

    _renderVendorSection(id) {
        const item = this._vendorItems.get(id);
        if (!item)
            return;
        const section = item.menu;
        const res = this._results.get(id);
        if (!res) {
            this._setSubmenuMessage(section, _('No data: use "Refresh all"'), {dim: true});
            return;
        }
        if (res.ok) {
            const now = new Date();
            const fetchedAt = this._fetchedAt.get(id) ?? new Date(Date.now() - res.cacheAgeMs);
            const adapter = getAdapter(id);
            const model = adapter.buildSection(
                res.snapshot,
                {stale: res.stale, lastError: res.lastError, fetchedAt, sessions: this._sessionsFor(id)},
                now,
                this._theme,
                _,
                ngettext
            );
            // A non-empty tooltip-format prepends additive text rows built from
            // this vendor's placeholders, above the structured layout.
            if (this._config.tooltipFormat) {
                const extra = tooltipRows(this._config.tooltipFormat, adapter.placeholders(res.snapshot, now, ngettext));
                if (extra.length)
                    model.rows = [...extra, ...model.rows];
            }
            renderSection(section, model, this._config.showPaceMarker);
        } else if (res.kind === 'loading') {
            this._setSubmenuMessage(section, _('Loading…'), {dim: true});
        } else {
            this._setSubmenuMessage(section, errorText(res, _), {
                color: severityColor(Severity.CRITICAL, this._theme),
                iconName: 'dialog-warning-symbolic',
                // Only Anthropic errors carry a plan (read from its credentials).
                // Translators: %s is the Anthropic plan name (e.g. "Max"), kept verbatim.
                title: res.plan ? vformat(_('Claude %s'), res.plan) : null,
            });
        }
    }

    _setActiveExpansion(activeId) {
        for (const [id, item] of this._vendorItems) {
            const want = id === activeId;
            if (item.menu.isOpen !== want)
                item.setSubmenuShown(want);
        }
    }

    async _refresh() {
        this._config = readConfig(this._settings);
        this._barFormat = this._config.barFormat;

        // Swap adapter + cache when the effective active vendor changed. Each
        // vendor's result is rendered through its own adapter, so no map entry
        // needs dropping: only the active fetch target changes.
        const activeId = normalizeActive(this._config);
        const activeChanged = activeId !== this._adapter.id;
        if (activeChanged) {
            this._adapter = getAdapter(activeId);
            this._cache = Cache.forVendor(this._adapter.cacheId);
            this._setVendorTag(activeId);
        }
        this._activeId = activeId;

        this._maybeRebuildVendorSections(this._config);
        if (activeChanged)
            this._setActiveExpansion(activeId);

        // A vendor switch must not wait behind the old vendor's (possibly slow) fetch.
        if (activeChanged && this._fetchGuard.busy)
            this._fetchGuard.supersede();
        const token = this._fetchGuard.begin();
        if (token === null)
            return;

        // Captured now: a scroll during the await swaps this._adapter / this._cache.
        const adapter = this._adapter;
        const cache = this._cache;
        const config = this._config;
        let res;
        try {
            res = await this._runFetch(adapter, {config, cache, http: request, signal: this._cancellable});
        } catch (e) {
            res = {ok: false, kind: 'error', message: e?.message ?? String(e)};
        }
        if (this._destroyed)
            return;

        const current = this._fetchGuard.isCurrent(token) &&
            activeId === normalizeActive(readConfig(this._settings));
        const again = this._fetchGuard.end(token);
        this._storeResult(activeId, res);
        this._maybeScanContext(activeId, res, config);
        if (current) {
            this._maybeNotify(adapter, cache, res, config);
            this._render(res);
        } else {
            this._renderVendorSection(activeId);
        }
        if (again)
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
    }

    async _refreshAll() {
        const config = readConfig(this._settings);
        this._maybeRebuildVendorSections(config);

        for (const id of enabledVendors(config)) {
            const adapter = getAdapter(id);
            const cache = Cache.forVendor(adapter.cacheId);
            let res;
            try {
                res = await this._runFetch(adapter, {
                    config,
                    cache,
                    http: request,
                    signal: this._cancellable,
                });
            } catch (e) {
                res = {ok: false, kind: 'error', message: e?.message ?? String(e)};
            }
            if (this._destroyed)
                return;
            this._storeResult(id, res);
            this._maybeScanContext(id, res, config);
            this._maybeNotify(adapter, cache, res, config);
            this._renderVendorSection(id);
        }

        const activeRes = this._results.get(this._activeId);
        if (activeRes)
            this._render(activeRes);
    }

    // Real fetch, unless AI_USAGEBAR_FAKE_PCT is set and the adapter can build a
    // synthetic snapshot, then return that instead (dev rendering check).
    _runFetch(adapter, ctx) {
        if (this._fakePct !== null && typeof adapter.fakeSnapshot === 'function') {
            return Promise.resolve({
                ok: true,
                snapshot: adapter.fakeSnapshot(this._fakePct),
                stale: false,
                lastError: null,
                cacheAgeMs: 0,
            });
        }
        return adapter.fetchSnapshot(ctx);
    }

    _storeResult(id, res) {
        this._results.set(id, res);
        if (res.ok)
            this._fetchedAt.set(id, new Date(Date.now() - res.cacheAgeMs));
    }

    // Turning the option off hides the sessions at once, before any refresh.
    _sessionsFor(id) {
        return id === CONTEXT_VENDOR && this._config.context.enabled ? this._sessions : null;
    }

    // Once per refresh, and only while the option is on: an errored Claude
    // entry gets no sessions, and nothing is read from disk when it is off.
    async _maybeScanContext(id, res, config) {
        if (id !== CONTEXT_VENDOR)
            return;
        if (!config.context.enabled || !res.ok) {
            this._sessions = null;
            return;
        }
        try {
            const scan = await scanSessions({
                root: config.context.projectsPath,
                modelWindows: config.context.modelWindows,
                defaultWindow: config.context.windowTokens,
                cancellable: this._cancellable,
            });
            if (this._destroyed)
                return;
            this._sessions = scan;
            this._renderVendorSection(id);
        } catch (e) {
            if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`ai-usagebar: context scan failed: ${e}`);
        }
    }

    // Only a fresh fetch notifies: a stale fallback or the TTL fast path
    // re-reports numbers that were already judged. The dedupe state is saved
    // before delivery, so a failed save skips the notification instead of
    // repeating it on every poll.
    async _maybeNotify(adapter, cache, res, config) {
        if (!res.ok || res.stale || res.cacheAgeMs !== 0 || !config.notifications.enabled)
            return;
        try {
            const {fired, state} = decide({
                vendor: vendorLabel(adapter.id, config),
                rows: adapter.notifyRows(res.snapshot, _),
                credits: adapter.resetCredits(res.snapshot),
                threshold: config.notifications.threshold,
                previous: await cache.readNotified(),
                now: new Date(),
                _,
            });
            if (this._destroyed)
                return;
            cache.writeNotified(state);
            for (const n of fired) {
                const source = this._notificationSource();
                source.addNotification(new MessageTray.Notification({
                    source,
                    title: n.title,
                    body: n.body,
                    urgency: n.urgency === Urgency.CRITICAL ? MessageTray.Urgency.CRITICAL : MessageTray.Urgency.NORMAL,
                }));
            }
            if (fired.length > 0) {
                global.display.get_sound_player().play_from_theme(
                    'message-new-instant', vendorLabel(adapter.id, config), null);
            }
        } catch (e) {
            console.warn(`ai-usagebar: notification check failed: ${e}`);
        }
    }

    // One tray source for the extension; the shell destroys it once its last
    // notification is gone, so it is rebuilt on demand.
    _notificationSource() {
        if (!this._notifySource) {
            this._notifySource = new MessageTray.Source({title: 'AI Usage Bar', icon: this._vendorGicon()});
            this._notifySource.connect('destroy', () => {
                this._notifySource = null;
            });
            Main.messageTray.add(this._notifySource);
        }
        return this._notifySource;
    }

    // Rides the poll tick: the on-disk deadline, not a timer, keeps it to one
    // request a day across indicator rebuilds and logins.
    async _checkForUpdate() {
        if (!this._config.updateCheck.enabled) {
            this._updateItem.visible = false;
            return;
        }
        if (this._updateCheckBusy)
            return;
        this._updateCheckBusy = true;
        try {
            let state = await readUpdateState();
            if (this._destroyed)
                return;
            this._paintUpdate(state);
            if (!isDue(state, Date.now()))
                return;

            const res = await request({
                url: RELEASES_API_URL,
                headers: {Accept: 'application/vnd.github+json'},
                cancellable: this._cancellable,
            });
            if (this._destroyed)
                return;
            const latest = res.status === 200 ? parseLatestTag(new TextDecoder().decode(res.bodyBytes)) : null;
            state = afterCheck(state, latest, Date.now());
            writeUpdateState(state);
            this._paintUpdate(state);
        } catch (e) {
            console.warn(`ai-usagebar: update check failed: ${e}`);
        } finally {
            this._updateCheckBusy = false;
        }
    }

    _paintUpdate(state) {
        const latest = this._config.updateCheck.enabled ? availableUpdate(state, this._version) : null;
        if (latest) {
            // Translators: %s is the version number of the newer release (e.g. "1.6.0").
            this._updateItem.label.text = vformat(_('Update available: %s'), latest);
        }
        this._updateItem.visible = latest !== null;
    }

    _openReleasesPage() {
        try {
            Gio.AppInfo.launch_default_for_uri(RELEASES_PAGE_URL, global.create_app_launch_context(0, -1));
        } catch (e) {
            console.warn(`ai-usagebar: could not open the releases page: ${e}`);
        }
    }

    _render(res) {
        if (res.ok) {
            const now = new Date();
            this._paintLabelOk(res.snapshot, res.stale, now);
        } else if (res.kind === 'loading') {
            this._setLabel(_('Loading…'), this._theme.fg);
        } else {
            // kind: 'error', message is retained on disk (.last_error) and in
            // the result; surface it in the popup and log it.
            console.warn(`ai-usagebar: ${errorText(res)}`);
            this._setLabel('⚠', severityColor(Severity.CRITICAL, this._theme));
        }
        this._renderVendorSection(this._activeId);
    }

    _reRenderFromCache() {
        if (this._destroyed)
            return;
        const res = this._results.get(this._activeId);
        if (!res || !res.ok)
            return;
        try {
            const now = new Date();
            this._paintLabelOk(res.snapshot, res.stale, now);
            this._renderVendorSection(this._activeId);
        } catch (e) {
            console.warn(`ai-usagebar: re-render failed: ${e}`);
        }
    }

    _rebuildTheme() {
        this._theme = withOverrides(defaultTheme(), this._config.colors);
    }

    _reRenderAllSections() {
        if (this._destroyed)
            return;
        this._reRenderFromCache();
        for (const id of this._vendorItems.keys()) {
            if (id !== this._activeId)
                this._renderVendorSection(id);
        }
    }

    _onScroll(_actor, event) {
        if (this._destroyed)
            return Clutter.EVENT_PROPAGATE;

        const dir = event.get_scroll_direction();
        let delta;
        if (dir === Clutter.ScrollDirection.UP)
            delta = +1;
        else if (dir === Clutter.ScrollDirection.DOWN)
            delta = -1;
        else
            return Clutter.EVENT_PROPAGATE;  // SMOOTH / horizontal: ignore.

        const config = readConfig(this._settings);
        const enabled = enabledVendors(config);
        if (enabled.length < 2)
            return Clutter.EVENT_PROPAGATE;

        const active = normalizeActive(config);
        const next = cycleVendor(enabled, active, delta);
        if (next === active)
            return Clutter.EVENT_PROPAGATE;

        this._settings.set_string('active-vendor', next);
        writeActiveVendorMirror(next);
        // Expand synchronously for instant feedback; the reactive settings handler
        // (fired by the active-vendor write) re-resolves + fetches the new vendor.
        this._setActiveExpansion(next);
        return Clutter.EVENT_STOP;
    }

    _paintLabelOk(snapshot, stale, now) {
        const values = this._adapter.placeholders(snapshot, now, ngettext);
        let text = substitute(this._barFormat, values);
        if (this._config.showPaceArrows)
            text = withPaceArrow(text, this._barFormat, values);
        if (stale)
            text += STALE_MARK;
        this._setLabel(text, severityColor(this._adapter.severity(snapshot), this._theme));
    }

    _onPopupOpen() {
        this._setActiveExpansion(this._activeId);
        this._reRenderFromCache();
        if (this._renderTimeoutId)
            return;
        this._renderTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RERENDER_INTERVAL_S, () => {
            this._reRenderFromCache();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onPopupClose() {
        if (this._renderTimeoutId) {
            GLib.Source.remove(this._renderTimeoutId);
            this._renderTimeoutId = null;
        }
    }

    _setSubmenuMessage(menu, text, opts = {}) {
        menu.removeAll();
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({style_class: 'aiusagebar-row'});
        if (opts.iconName) {
            box.add_child(new St.Icon({
                icon_name: opts.iconName,
                style_class: opts.dim ? 'popup-menu-icon aiusagebar-dim' : 'popup-menu-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        const l = new St.Label({text, y_align: Clutter.ActorAlign.CENTER});
        if (opts.color)
            l.set_style(`color: ${opts.color};`);
        else if (opts.dim)
            l.add_style_class_name('aiusagebar-dim');
        box.add_child(l);
        if (opts.title) {
            const container = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-section'});
            container.add_child(new St.Label({text: opts.title, style_class: 'aiusagebar-title'}));
            container.add_child(box);
            item.add_child(container);
        } else {
            item.add_child(box);
        }
        menu.addMenuItem(item);
    }

    _setLabel(text, color) {
        this._label.text = text;
        this._label.set_style(`color: ${color};`);
    }

    // Symbolic name (-symbolic.svg) so St recolors it to the menu foreground;
    // a plain icon would render its currentColor as black and vanish in dark.
    _vendorGicon(id = null) {
        const name = id !== null && this._config.showVendorIcons ? vendorIconName(id) : GENERIC_ICON;
        const f = Gio.File.new_for_path(GLib.build_filenamev([this._path, 'icons', `${name}.svg`]));
        return new Gio.FileIcon({file: f});
    }

    // The badge is the vendor's logo, or its short code with logos off or
    // for a vendor without a mark of its own.
    _setVendorTag(id) {
        this._tag.text = vendorTag(id, this._config);
        const logo = this._config.showVendorIcons && vendorIconName(id) !== GENERIC_ICON;
        if (logo)
            this._tagIcon.gicon = this._vendorGicon(id);
        this._tagIcon.visible = logo;
        this._tag.visible = !logo;
    }

    _makeActionButton(iconName, label, onClick) {
        const button = new St.Button({
            style_class: 'aiusagebar-action-button',
            child: new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}),
            can_focus: true,
            track_hover: true,
        });
        button.accessible_name = label;
        button.connect('clicked', () => {
            if (this._destroyed)
                return;
            this._hideTooltip();
            onClick();
        });
        button.connect('notify::hover', () => this._onActionHover(button, label));
        return button;
    }

    _onActionHover(button, label) {
        if (this._destroyed)
            return;
        this._cancelTooltipTimer();
        if (!button.hover) {
            this._hideTooltip();
            return;
        }
        this._tooltipTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
            this._tooltipTimeoutId = null;
            this._showTooltip(button, label);
            return GLib.SOURCE_REMOVE;
        });
    }

    _showTooltip(button, label) {
        if (this._destroyed || !button.hover)
            return;
        if (!this._tooltip) {
            this._tooltip = new St.Label({style_class: 'aiusagebar-tooltip'});
            this._tooltip.hide();
            Main.layoutManager.uiGroup.add_child(this._tooltip);
        }
        this._tooltip.text = label;
        this._tooltip.show();
        const [bx, by] = button.get_transformed_position();
        const x = Math.round(bx + button.width / 2 - this._tooltip.width / 2);
        const y = Math.round(by + button.height + 4);
        this._tooltip.set_position(Math.max(0, x), y);
    }

    _hideTooltip() {
        this._tooltip?.hide();
    }

    _cancelTooltipTimer() {
        if (this._tooltipTimeoutId) {
            GLib.Source.remove(this._tooltipTimeoutId);
            this._tooltipTimeoutId = null;
        }
    }

    destroy() {
        this._destroyed = true;

        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._renderTimeoutId) {
            GLib.Source.remove(this._renderTimeoutId);
            this._renderTimeoutId = null;
        }
        this._cancelTooltipTimer();
        if (this._tooltip) {
            this._tooltip.destroy();
            this._tooltip = null;
        }
        if (this._openStateId) {
            this.menu.disconnect(this._openStateId);
            this._openStateId = null;
        }
        if (this._scrollId) {
            this.disconnect(this._scrollId);
            this._scrollId = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        disposeSession();
        this._notifySource?.destroy();
        this._notifySource = null;
        this._settings = null;

        this._vendorItems.clear();
        this._results.clear();
        this._fetchedAt.clear();

        this.menu?.removeAll();

        super.destroy();
    }
});
