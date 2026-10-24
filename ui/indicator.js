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
import {normalizeActive, cycleVendor, enabledVendors, panelVendors, isEnabled} from '../lib/config-resolve.js';
import {writeActiveVendorMirror} from '../lib/active-vendor.js';
import {request, disposeSession} from '../lib/http.js';
import {getAdapter} from '../lib/vendors/registry.js';
import {vendorLabel, vendorIconName, GENERIC_ICON} from '../lib/vendors.js';
import {renderSection} from './vendorSection.js';
import {errorText} from '../lib/vendors/section-common.js';
import {scanSessions} from '../lib/context/scan.js';
import {substitute, tooltipRows, vformat} from '../lib/format.js';
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
        this._fetchGuards = new Map(); // one independent fetch slot per vendor
        this._activeId = normalizeActive(this._config);
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

        // Each visible vendor is polled independently. `_fetchedAt` pins each
        // vendor's footer timestamp to its real fetch instant across re-renders.
        this._results = new Map();      // vendorId -> FetchResult
        this._notifySource = null;
        this._sessions = null;          // last context scan for CONTEXT_VENDOR
        this._fetchedAt = new Map();    // vendorId -> Date
        this._vendorItems = new Map();  // vendorId -> PopupMenu.PopupSubMenuMenuItem
        this._enabledSig = '';

        this._panelItems = new Map(); // vendorId -> {box, icon, tag, label}
        this._box = new St.BoxLayout({style_class: 'panel-status-menu-box aiusagebar-panel-vendors'});
        this._emptyLabel = new St.Label({
            text: _('No panel vendors selected'),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._box.add_child(this._emptyLabel);
        this.add_child(this._box);
        this._syncPanelItems();

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

        for (const id of panelVendors(this._config))
            this._results.set(id, {ok: false, kind: 'loading'});
        this._renderPanel();
        this._rebuildVendorSections(this._config);

        // Panel countdowns keep ticking even while the popup is closed.
        this._openStateId = this.menu.connect('open-state-changed', (_m, open) => {
            if (this._destroyed)
                return;
            if (open)
                this._onPopupOpen();
        });

        this._scrollId = this.connect('scroll-event', (actor, event) => this._onScroll(actor, event));

        // React to settings changes (prefs / gsettings / scroll write) immediately.
        this._settingsChangedId = this._settings.connect('changed', (s, key) => this._onSettingsChanged(s, key));

        // One immediate refresh, then poll. A rejected promise must never escape
        // into the timeout callback / event loop.
        this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
        this._rearmPollTimer(this._config.refreshIntervalSecs);
        this._renderTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RERENDER_INTERVAL_S, () => {
            this._renderPanel();
            if (this.menu.isOpen) {
                for (const id of this._vendorItems.keys())
                    this._renderVendorSection(id);
            }
            return GLib.SOURCE_CONTINUE;
        });
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

        const activeChanged = normalizeActive(config) !== this._activeId;
        const vendorsChanged = enabledVendors(config).join(',') !== enabledVendors(this._config).join(',');
        const panelSelectionChanged = panelVendors(config).join(',') !== panelVendors(this._config).join(',');
        this._syncConfig(config);
        if (key.startsWith('color-'))
            this._rebuildTheme();
        this._reRenderAllSections();

        if (vendorsChanged || panelSelectionChanged) {
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
        } else if (activeChanged && isEnabled(config, this._activeId)) {
            this._refreshVendor(this._activeId, config)
                .catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
        }
    }

    _syncConfig(config) {
        const activeId = normalizeActive(config);
        const activeChanged = activeId !== this._activeId;
        this._config = config;
        this._barFormat = config.barFormat;
        this._activeId = activeId;
        this._syncPanelItems();
        this._maybeRebuildVendorSections(config);
        if (activeChanged)
            this._setActiveExpansion(activeId);
    }

    _syncPanelItems() {
        const ids = panelVendors(this._config);
        for (const [id, item] of this._panelItems) {
            if (!ids.includes(id)) {
                item.box.destroy();
                this._panelItems.delete(id);
            }
        }
        ids.forEach((id, index) => {
            let item = this._panelItems.get(id);
            if (!item) {
                const box = new St.BoxLayout({reactive: true});
                const icon = new St.Icon({
                    style_class: 'aiusagebar-vendor-icon',
                    icon_size: 16,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                const tag = new St.Label({
                    style_class: 'aiusagebar-panel-tag',
                    y_align: Clutter.ActorAlign.CENTER,
                    y_expand: true,
                });
                const label = new St.Label({
                    y_align: Clutter.ActorAlign.CENTER,
                    y_expand: true,
                });
                box.add_child(icon);
                box.add_child(tag);
                box.add_child(label);
                box.connect('button-press-event', (_actor, event) => {
                    if (!this._destroyed && event.get_button() === 1) {
                        this._settings.set_string('active-vendor', id);
                        writeActiveVendorMirror(id);
                        this._setActiveExpansion(id);
                    }
                    // The enclosing panel button opens/closes the shared popup.
                    return Clutter.EVENT_PROPAGATE;
                });
                this._box.add_child(box);
                item = {box, icon, tag, label};
                this._panelItems.set(id, item);
            }
            this._box.set_child_at_index(item.box, index);
            item.box.accessible_name = vendorLabel(id, this._config);
            this._setVendorTag(id);
        });
        this._emptyLabel.visible = ids.length === 0;
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
                // Translators: %s is the Anthropic plan name (e.g. "Max 5x"), kept verbatim.
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
        const config = readConfig(this._settings);
        this._syncConfig(config);
        this._renderPanel();
        await Promise.all(panelVendors(config).map(id => this._refreshVendor(id, config)));
    }

    async _refreshAll() {
        const config = readConfig(this._settings);
        this._syncConfig(config);
        await Promise.all(enabledVendors(config).map(id => this._refreshVendor(id, config)));
    }

    async _refreshVendor(id, config) {
        if (this._destroyed || !isEnabled(config, id))
            return;
        let guard = this._fetchGuards.get(id);
        if (!guard) {
            guard = new FetchGuard();
            this._fetchGuards.set(id, guard);
        }
        const token = guard.begin();
        if (token === null)
            return;

        const adapter = getAdapter(id);
        const cache = Cache.forVendor(adapter.cacheId);
        if (!this._results.has(id)) {
            this._results.set(id, {ok: false, kind: 'loading'});
            this._renderPanelVendor(id);
            this._renderVendorSection(id);
        }
        let res;
        try {
            res = await this._runFetch(adapter, {config, cache, http: request, signal: this._cancellable});
        } catch (e) {
            res = {ok: false, kind: 'error', message: e?.message ?? String(e)};
        }
        const again = guard.end(token);
        if (this._destroyed)
            return;

        // Disabling a vendor during a fetch must not restore it or notify for it.
        const currentConfig = readConfig(this._settings);
        if (isEnabled(currentConfig, id)) {
            this._storeResult(id, res);
            this._maybeScanContext(id, res, currentConfig);
            this._maybeNotify(adapter, cache, res, currentConfig);
            this._renderPanelVendor(id);
            this._renderVendorSection(id);
        }
        if (again && isEnabled(currentConfig, id))
            await this._refreshVendor(id, currentConfig);
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

    _renderPanelVendor(id) {
        const item = this._panelItems.get(id);
        if (!item)
            return;
        const res = this._results.get(id);
        if (res?.ok) {
            const adapter = getAdapter(id);
            const format = this._config.vendorBarFormats[id] || this._barFormat;
            let text = substitute(format, adapter.placeholders(res.snapshot, new Date(), ngettext));
            if (res.stale)
                text += STALE_MARK;
            item.label.text = text;
            item.label.set_style(`color: ${severityColor(adapter.severity(res.snapshot), this._theme)};`);
        } else if (!res || res.kind === 'loading') {
            item.label.text = _('Loading…');
            item.label.set_style(`color: ${this._theme.fg};`);
        } else {
            item.label.text = '⚠';
            item.label.set_style(`color: ${severityColor(Severity.CRITICAL, this._theme)};`);
        }
        item.box.accessible_name = `${vendorLabel(id, this._config)}: ${item.label.text}`;
    }

    _renderPanel() {
        if (this._destroyed)
            return;
        for (const id of this._panelItems.keys())
            this._renderPanelVendor(id);
    }

    _rebuildTheme() {
        this._theme = withOverrides(defaultTheme(), this._config.colors);
    }

    _reRenderAllSections() {
        if (this._destroyed)
            return;
        this._renderPanel();
        for (const id of this._vendorItems.keys())
            this._renderVendorSection(id);
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

    _onPopupOpen() {
        this._setActiveExpansion(this._activeId);
        this._reRenderAllSections();
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
        const item = this._panelItems.get(id);
        item.tag.text = vendorTag(id, this._config);
        const logo = this._config.showVendorIcons && vendorIconName(id) !== GENERIC_ICON;
        if (logo)
            item.icon.gicon = this._vendorGicon(id);
        item.icon.visible = logo;
        item.tag.visible = !logo;
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
        this._panelItems.clear();
        this._fetchGuards.clear();
        this._results.clear();
        this._fetchedAt.clear();

        this.menu?.removeAll();

        super.destroy();
    }
});
