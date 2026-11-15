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
import {
    normalizeActive, cycleVendor, enabledVendors, isPinnedMode, panelVendors, pollVendors,
} from '../lib/config-resolve.js';
import {writeActiveVendorMirror} from '../lib/active-vendor.js';
import {request, disposeSession} from '../lib/http.js';
import {getAdapter} from '../lib/vendors/registry.js';
import {vendorLabel, vendorIconName, GENERIC_ICON, VENDOR_IDS} from '../lib/vendors.js';
import {renderSection} from './vendorSection.js';
import {errorText} from '../lib/vendors/section-common.js';
import {scanSessions} from '../lib/context/scan.js';
import {tooltipRows, vformat} from '../lib/format.js';
import {segmentModel, nearestSegment, Tone} from '../lib/panel-segments.js';
import {decide, Urgency} from '../lib/notify.js';
import {severityColor, Severity} from '../lib/severity.js';
import {defaultTheme, withOverrides} from '../lib/theme.js';
import {
    parseFakePct, parseFakeErrorVendors, parseFakeDelayMs, FakeFailure,
    FAKE_PCT_ENV, FAKE_ERROR_ENV, FAKE_DELAY_ENV, FAKE_ERROR_MESSAGE,
} from '../lib/debug.js';
import {
    RELEASES_API_URL, RELEASES_PAGE_URL, afterCheck, availableUpdate, isDue, parseLatestTag,
} from '../lib/update-check.js';
import {readUpdateState, writeUpdateState} from '../lib/update-store.js';

const RERENDER_INTERVAL_S = 60;
// Claude Code transcripts belong to the Claude section only.
const CONTEXT_VENDOR = 'anthropic';
const TOOLTIP_DELAY_MS = 400;

function fakeHttpFailure() {
    return {status: 503, headers: {}, bodyBytes: new TextEncoder().encode(FAKE_ERROR_MESSAGE), error: null};
}

// Panel badge for a vendor: its short code, upper-cased (e.g. "CLD", "GPT");
// a provider named by the user derives it from the configured name.
function vendorTag(id, config) {
    const adapter = getAdapter(id);
    return (adapter.shortCode ? adapter.shortCode(config) : adapter.vendorShort).toUpperCase();
}

// What the vendor badges (popup headers and panel segments) are drawn from.
function badgeSignature(config) {
    return `${config.vendors.custom.name}|${config.showVendorIcons}`;
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
        this._guards = new Map();       // vendorId -> FetchGuard
        this._activeId = normalizeActive(this._config);
        this._pollIds = pollVendors(this._config);
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
        // AI_USAGEBAR_FAKE_ERROR=<id[:stale]|*,...> fails those vendors' fetches;
        // AI_USAGEBAR_FAKE_DELAY_MS=<ms> holds every fetch that long first.
        this._fakeErrors = parseFakeErrorVendors(GLib.getenv(FAKE_ERROR_ENV), VENDOR_IDS);
        this._fakeDelayMs = parseFakeDelayMs(GLib.getenv(FAKE_DELAY_ENV));
        if (this._fakeErrors !== null)
            log(`ai-usagebar: ${FAKE_ERROR_ENV}=${[...this._fakeErrors].map(([id, f]) => `${id}:${f}`).join(',')}, failing those fetches`);
        if (this._fakeDelayMs !== null)
            log(`ai-usagebar: ${FAKE_DELAY_ENV}=${this._fakeDelayMs}, delaying every fetch`);
        this._fakeDelayIds = new Set();

        // Lazy per-vendor data: only the poll set (panel segments + the active
        // vendor) is polled; other sub-sections render from whatever is already
        // here. `_fetchedAt` pins each vendor's footer timestamp to its real
        // fetch instant across live re-renders.
        this._results = new Map();      // vendorId -> FetchResult
        this._notifySource = null;
        this._sessions = null;          // last context scan for CONTEXT_VENDOR
        this._fetchedAt = new Map();    // vendorId -> Date
        this._vendorItems = new Map();  // vendorId -> PopupMenu.PopupSubMenuMenuItem
        this._enabledSig = '';
        this._segments = new Map();     // vendorId -> {box, label}
        this._segmentSig = '';
        this._pendingAll = new Set();   // vendorIds whose coalesced rerun came from "Refresh all"

        this._segmentsBox = new St.BoxLayout({style_class: 'panel-status-menu-box aiusagebar-segments'});
        this.add_child(this._segmentsBox);

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

        // Seed the polled vendors with a Loading… state so their sub-sections (and
        // an immediately-opened popup) are never empty before the first fetch lands.
        for (const id of this._pollIds)
            this._results.set(id, {ok: false, kind: 'loading'});
        this._rebuildVendorSections(this._config);
        this._rebuildSegments(this._config);

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

        // A vendor that joined the poll set (scroll write, primary sync, a pin, or a
        // disable that bumped the fallback) is fetched now; a cache-warm revisit
        // skips the network via the 60s TTL. Everything else repaints in-process.
        this._config = config;
        this._barFormat = config.barFormat;
        for (const id of this._syncTargets(config))
            this._refreshVendor(id).catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));

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
        return `${enabledVendors(config).join(',')}|${badgeSignature(config)}`;
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

    // Re-resolve the active vendor, the poll set, the popup sections and the
    // panel segments from `config`; returns the ids that joined the poll set.
    _syncTargets(config) {
        const activeId = normalizeActive(config);
        const activeChanged = activeId !== this._activeId;
        this._activeId = activeId;
        const before = this._pollIds;
        this._pollIds = pollVendors(config);

        const added = this._pollIds.filter(id => !before.includes(id));
        for (const id of added) {
            if (!this._results.has(id))
                this._results.set(id, {ok: false, kind: 'loading'});
        }

        this._maybeRebuildVendorSections(config);
        this._maybeRebuildSegments(config);
        for (const id of added)
            this._renderVendorSection(id);
        if (activeChanged)
            this._setActiveExpansion(activeId);
        return added;
    }

    async _refresh() {
        this._config = readConfig(this._settings);
        this._barFormat = this._config.barFormat;
        this._syncTargets(this._config);
        await Promise.all(this._pollIds.map(id => this._refreshVendor(id)));
    }

    async _refreshAll() {
        this._config = readConfig(this._settings);
        this._barFormat = this._config.barFormat;
        this._syncTargets(this._config);
        await Promise.all(enabledVendors(this._config).map(id => this._refreshVendor(id, {all: true})));
    }

    _guardFor(id) {
        let guard = this._guards.get(id);
        if (!guard) {
            guard = new FetchGuard();
            this._guards.set(id, guard);
        }
        return guard;
    }

    // One fetch for `id`, coalesced with any already in flight for it. A fresh
    // result notifies only while `id` is still polled (or when "Refresh all"
    // asked for it), so a vendor scrolled away from mid-fetch stays quiet.
    async _refreshVendor(id, {all = false} = {}) {
        const guard = this._guardFor(id);
        const token = guard.begin();
        if (token === null) {
            if (all)
                this._pendingAll.add(id);
            return;
        }

        const adapter = getAdapter(id);
        const cache = Cache.forVendor(adapter.cacheId);
        const config = this._config;
        let res;
        try {
            res = await this._runFetch(adapter, {config, cache, http: request, signal: this._cancellable});
        } catch (e) {
            res = {ok: false, kind: 'error', message: e?.message ?? String(e)};
        }
        if (this._destroyed)
            return;

        const again = guard.end(token);
        this._storeResult(id, res);
        this._maybeScanContext(id, res, config);
        const polled = this._pollIds.includes(id);
        if (all || polled)
            this._maybeNotify(adapter, cache, res, config);
        if ((all || polled) && !res.ok && res.kind === 'error')
            console.warn(`ai-usagebar: ${errorText(res)}`);
        try {
            this._paintSegment(id);
            this._renderVendorSection(id);
        } catch (e) {
            console.warn(`ai-usagebar: render failed: ${e}`);
        }
        // A rerun for a vendor no longer polled could only repaint from the TTL cache.
        const rerunAll = this._pendingAll.delete(id);
        if (again && (rerunAll || this._pollIds.includes(id)))
            await this._refreshVendor(id, {all: rerunAll});
    }

    // Real fetch, reshaped by the dev overrides when set: AI_USAGEBAR_FAKE_DELAY_MS
    // waits first; AI_USAGEBAR_FAKE_PCT returns a synthetic snapshot from adapters
    // with one; AI_USAGEBAR_FAKE_ERROR fails the listed vendors. A synthetic
    // failure takes the shapes a real one ends in (an error, or the snapshot
    // marked stale with the HTTP error); without FAKE_PCT the real fetch runs
    // against an HTTP 503, so its own stale fallback and sidecars are exercised.
    async _runFetch(adapter, ctx) {
        if (this._fakeDelayMs !== null)
            await this._fakeDelay(this._fakeDelayMs);
        const failure = this._fakeErrors?.get(adapter.id) ?? null;
        if (this._fakePct !== null && typeof adapter.fakeSnapshot === 'function') {
            if (failure === FakeFailure.ERROR)
                return {ok: false, kind: 'error', message: FAKE_ERROR_MESSAGE};
            return {
                ok: true,
                snapshot: adapter.fakeSnapshot(this._fakePct, new Date(), ctx.config),
                stale: failure === FakeFailure.STALE,
                lastError: failure === FakeFailure.STALE ? {code: 503, body: FAKE_ERROR_MESSAGE} : null,
                cacheAgeMs: 0,
            };
        }
        if (failure !== null)
            return adapter.fetchSnapshot({...ctx, http: () => Promise.resolve(fakeHttpFailure())});
        return adapter.fetchSnapshot(ctx);
    }

    _fakeDelay(ms) {
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._fakeDelayIds.delete(id);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._fakeDelayIds.add(id);
        });
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

    // Repaint every panel segment and the active sub-section from the results map.
    _reRenderFromCache() {
        if (this._destroyed)
            return;
        try {
            this._paintSegments();
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
        if (enabled.length < 2 || isPinnedMode(config))
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

    // The segments are rebuilt only when what they are made of changes: which
    // vendors, their logos, or the custom provider's name (its short code).
    _segmentSignature(config) {
        return `${panelVendors(config).join(',')}|${badgeSignature(config)}`;
    }

    _maybeRebuildSegments(config) {
        if (this._segmentSignature(config) !== this._segmentSig)
            this._rebuildSegments(config);
    }

    _rebuildSegments(config) {
        this._segmentsBox.destroy_all_children();
        this._segments.clear();
        for (const id of panelVendors(config)) {
            const box = new St.BoxLayout({style_class: 'aiusagebar-segment'});
            // The badge is the vendor's logo, or its short code with logos off or
            // for a vendor without a mark of its own.
            if (config.showVendorIcons && vendorIconName(id) !== GENERIC_ICON) {
                box.add_child(new St.Icon({
                    style_class: 'aiusagebar-vendor-icon',
                    gicon: this._vendorGicon(id),
                    icon_size: 16,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            } else {
                box.add_child(new St.Label({
                    style_class: 'aiusagebar-panel-tag',
                    text: vendorTag(id, config),
                    y_align: Clutter.ActorAlign.CENTER,
                    y_expand: true,
                }));
            }
            const label = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER, y_expand: true});
            box.add_child(label);
            this._segmentsBox.add_child(box);
            this._segments.set(id, {box, label});
        }
        this._segmentSig = this._segmentSignature(config);
        this._paintSegments();
    }

    _paintSegments() {
        for (const id of this._segments.keys())
            this._paintSegment(id);
    }

    _paintSegment(id) {
        const segment = this._segments.get(id);
        if (!segment)
            return;
        const model = segmentModel(this._results.get(id), {
            adapter: getAdapter(id),
            barFormat: this._barFormat,
            paceArrows: this._config.showPaceArrows,
            alone: this._segments.size === 1,
            now: new Date(),
        }, _, ngettext);
        const color = model.tone === Tone.SEVERITY ? severityColor(model.severity, this._theme) : this._theme.fg;
        segment.label.text = model.text;
        segment.label.set_style(`color: ${color};`);
    }

    // A click or tap on the button focuses the nearest segment's vendor. The
    // click itself is the shell's (vfunc_event up to 49, a ClickGesture from 50),
    // so the event that opened the menu is read here; a keyboard open (Super+U,
    // Enter on the focused button) has no position and keeps the active vendor.
    _focusClickedSegment() {
        const event = Clutter.get_current_event();
        const type = event?.type();
        if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.BUTTON_RELEASE &&
            type !== Clutter.EventType.TOUCH_BEGIN && type !== Clutter.EventType.TOUCH_END)
            return;
        const [x] = event.get_coords();
        const spans = [...this._segments].map(([id, {box}]) => {
            const [sx] = box.get_transformed_position();
            const [width] = box.get_transformed_size();
            return {id, x: sx, width};
        });
        const id = nearestSegment(x, spans);
        if (id === null || id === this._activeId)
            return;
        this._activeId = id;
        this._settings.set_string('active-vendor', id);
        writeActiveVendorMirror(id);
    }

    _onPopupOpen() {
        this._focusClickedSegment();
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

    // Symbolic name (-symbolic.svg) so St recolors it to the menu foreground;
    // a plain icon would render its currentColor as black and vanish in dark.
    _vendorGicon(id = null) {
        const name = id !== null && this._config.showVendorIcons ? vendorIconName(id) : GENERIC_ICON;
        const f = Gio.File.new_for_path(GLib.build_filenamev([this._path, 'icons', `${name}.svg`]));
        return new Gio.FileIcon({file: f});
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
        for (const id of this._fakeDelayIds)
            GLib.Source.remove(id);
        this._fakeDelayIds.clear();
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
        this._segments.clear();
        this._guards.clear();
        this._pendingAll.clear();
        this._results.clear();
        this._fetchedAt.clear();

        this.menu?.removeAll();

        super.destroy();
    }
});
