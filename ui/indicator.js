import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Cache} from '../lib/cache.js';
import {readConfig} from '../lib/config.js';
import {FetchGuard} from '../lib/fetch-guard.js';
import {
    normalizeActive, cycleVendor, enabledVendors, isPinnedMode, pollVendors,
} from '../lib/config-resolve.js';
import {writeActiveVendorMirror} from '../lib/active-vendor.js';
import {request} from '../lib/http.js';
import {getAdapter} from '../lib/vendors/registry.js';
import {vendorLabel, vendorIconName, GENERIC_ICON, VENDOR_IDS} from '../lib/vendors.js';
import {VendorCard} from './vendorSection.js';
import {ActionBar} from './actionBar.js';
import {Tooltip} from './tooltip.js';
import {PanelSegments, badgeSignature} from './panelSegments.js';
import {UpdateItem} from './updateItem.js';
import {errorText, footerRow} from '../lib/vendors/section-common.js';
import {loading} from '../lib/vendors/fetch-common.js';
import {scanSessions} from '../lib/context/scan.js';
import {tooltipRows, vformat} from '../lib/format.js';
import {severityColor, Severity} from '../lib/severity.js';
import {defaultTheme, withOverrides, luminance, legibleOnDark} from '../lib/theme.js';
import {settingsEffects} from '../lib/settings-effect.js';
import {
    parseFakePct, parseFakeErrorVendors, parseFakeDelayMs, fakeResult, fakeHttpFailure,
    FAKE_PCT_ENV, FAKE_ERROR_ENV, FAKE_DELAY_ENV,
} from '../lib/debug.js';

const RERENDER_INTERVAL_S = 60;
// Claude Code transcripts belong to the Claude section only.
const CONTEXT_VENDOR = 'anthropic';

// A rejected promise must never escape into a timeout callback or the event loop.
function warnOnFailure(what) {
    return e => console.warn(`ai-usagebar: ${what} failed: ${e}`);
}

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    // `notifier` belongs to the extension and outlives a rebuild.
    _init(settings, openPreferences, extensionPath, version, notifier) {
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
        this._config = config;

        this._cancellable = new Gio.Cancellable();
        this._guards = new Map();       // vendorId -> FetchGuard
        this._activeId = normalizeActive(this._config);
        this._pollIds = pollVendors(this._config);
        this._rebuildTheme();
        this._timeoutId = null;
        this._renderTimeoutId = null;
        this._settingsIdleId = null;
        this._pendingKeys = new Set();
        this._destroyed = false;
        this._darkPopup = true;

        this._readDevOverrides();

        // Lazy per-vendor data: only the poll set (panel segments + the active
        // vendor) is polled; other sub-sections render from whatever is already
        // here. `_fetchedAt` pins each vendor's timestamp to its real fetch
        // instant across live re-renders.
        this._results = new Map();      // vendorId -> FetchResult
        this._sessions = null;          // last context scan for CONTEXT_VENDOR
        this._fetchedAt = new Map();    // vendorId -> Date
        this._vendorItems = new Map();  // vendorId -> VendorCard
        this._enabledSig = '';
        this._pendingAll = new Set();   // vendorIds whose coalesced rerun came from "Refresh all"

        this._segments = new PanelSegments(id => this._vendorGicon(id));
        this.add_child(this._segments.actor);
        this._notifier = notifier;

        this._tooltip = new Tooltip();

        // Per-vendor sub-sections are inserted above the separator on (re)build.
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._actions = new ActionBar(this._tooltip, [
            {iconName: 'view-refresh-symbolic', label: _('Refresh all'), onClick: () => this._refreshAll().catch(warnOnFailure('refresh all'))},
            {iconName: 'preferences-system-symbolic', label: _('Preferences'), onClick: () => this._openPreferences?.()},
        ]);
        this.menu.addMenuItem(this._actions.item);
        this._update = new UpdateItem(version, this._cancellable);
        this.menu.addMenuItem(this._update.item);

        // Seed the polled vendors with a Loading… state so their cards (and an
        // immediately-opened popup) are never empty before the first fetch lands.
        for (const id of this._pollIds)
            this._results.set(id, loading());
        this._rebuildVendorSections(this._config);
        this._rebuildSegments(this._config);

        // Live countdowns: re-render the cards only while open.
        this.menu.connectObject('open-state-changed', (_m, open) => {
            if (this._destroyed)
                return;
            if (open)
                this._onPopupOpen();
            else
                this._onPopupClose();
        }, this);

        // React to settings changes (prefs / gsettings / scroll write) immediately.
        this._settings.connectObject('changed', (s, key) => this._onSettingsChanged(s, key), this);

        this._refresh().catch(warnOnFailure('refresh'));
        this._rearmPollTimer(this._config.refreshIntervalSecs);
        this._update.check(this._config.updateCheck.enabled);
    }

    // AI_USAGEBAR_FAKE_PCT=<0..100> answers every fetch with a synthetic
    // snapshot; AI_USAGEBAR_FAKE_ERROR=<id[:stale]|*,...> fails those vendors'
    // fetches; AI_USAGEBAR_FAKE_DELAY_MS=<ms> holds every fetch that long first.
    _readDevOverrides() {
        this._fakePct = parseFakePct(GLib.getenv(FAKE_PCT_ENV));
        if (this._fakePct !== null)
            log(`ai-usagebar: ${FAKE_PCT_ENV}=${this._fakePct}, overriding usage fetch`);
        this._fakeErrors = parseFakeErrorVendors(GLib.getenv(FAKE_ERROR_ENV), VENDOR_IDS);
        this._fakeDelayMs = parseFakeDelayMs(GLib.getenv(FAKE_DELAY_ENV));
        if (this._fakeErrors !== null)
            log(`ai-usagebar: ${FAKE_ERROR_ENV}=${[...this._fakeErrors].map(([id, f]) => `${id}:${f}`).join(',')}, failing those fetches`);
        if (this._fakeDelayMs !== null)
            log(`ai-usagebar: ${FAKE_DELAY_ENV}=${this._fakeDelayMs}, delaying every fetch`);
        this._fakeDelayIds = new Set();
    }

    // Removes the GLib source stored in `this[field]`, if any.
    _clearSource(field) {
        if (this[field]) {
            GLib.Source.remove(this[field]);
            this[field] = null;
        }
    }

    _rearmPollTimer(secs) {
        this._clearSource('_timeoutId');
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            this._refresh().catch(warnOnFailure('refresh'));
            this._update.check(this._config.updateCheck.enabled);
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Keys changed in one main-loop turn (a reset writes every key) are applied
    // once, from an idle.
    _onSettingsChanged(settings, key) {
        if (this._destroyed)
            return;

        // A primary-vendor change forces active := primary. The set_string re-enters
        // this handler as key='active-vendor'; GSettings emits nothing for an
        // unchanged value, so there is no recursion.
        if (key === 'primary-vendor') {
            const primary = settings.get_string('primary-vendor');
            if (settings.get_string('active-vendor') !== primary)
                this._setActiveVendor(primary);
        }

        this._pendingKeys.add(key);
        this._settingsIdleId ??= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._settingsIdleId = null;
            this._applySettings();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applySettings() {
        const effects = settingsEffects([...this._pendingKeys]);
        this._pendingKeys.clear();
        this._config = readConfig(this._settings);
        if (effects.interval)
            this._rearmPollTimer(this._config.refreshIntervalSecs);
        if (effects.updateCheck)
            this._update.check(this._config.updateCheck.enabled);
        if (!effects.sync)
            return;

        // A vendor that joined the poll set (scroll write, primary sync, a pin, or a
        // disable that bumped the fallback) is fetched now; a cache-warm revisit
        // skips the network via the 60s TTL.
        for (const id of this._syncTargets(this._config))
            this._refreshVendor(id).catch(warnOnFailure('refresh'));
        if (effects.rebuildTheme)
            this._rebuildTheme();
        this._reRenderFromCache();
    }

    // The mirror is for out-of-shell readers; the settings change comes back
    // through _onSettingsChanged.
    _setActiveVendor(id) {
        this._settings.set_string('active-vendor', id);
        writeActiveVendorMirror(id);
    }

    // The custom provider's name is its card title and the logos toggle swaps
    // every header icon, so either one rebuilds the cards too.
    _enabledSignature(config) {
        return `${enabledVendors(config).join(',')}|${badgeSignature(config)}`;
    }

    _maybeRebuildVendorSections(config) {
        if (this._enabledSignature(config) !== this._enabledSig)
            this._rebuildVendorSections(config);
    }

    _rebuildVendorSections(config) {
        for (const card of this._vendorItems.values())
            card.item.destroy();
        this._vendorItems.clear();

        enabledVendors(config).forEach((id, idx) => {
            const card = new VendorCard({
                gicon: this._vendorGicon(id),
                name: vendorLabel(id, config),
                tooltip: this._tooltip,
                refreshLabel: _('Refresh now'),
                onRefresh: () => this._refreshVendor(id, {all: true}).catch(warnOnFailure('refresh')),
            });
            this.menu.addMenuItem(card.item, idx);
            this._vendorItems.set(id, card);
            this._renderVendorSection(id);
        });

        this._enabledSig = this._enabledSignature(config);
        this._setActiveExpansion(this._activeId);
    }

    _renderVendorSection(id) {
        const card = this._vendorItems.get(id);
        if (!card)
            return;
        const res = this._results.get(id);
        if (!res) {
            card.setMessage(_('No data: use "Refresh all"'), {dim: true});
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
            card.setModel(model, {showPace: this._config.showPaceMarker, textColor: c => this._textColor(c)});
        } else if (res.kind === 'loading') {
            card.setMessage(_('Loading…'), {dim: true});
        } else {
            // Only Anthropic errors carry a plan (read from its credentials).
            if (res.plan)
                // Translators: %s is the Anthropic plan name (e.g. "Max"), kept verbatim.
                card.setPlan(vformat(_('Claude %s'), res.plan));
            card.setMessage(errorText(res, _), {
                color: this._textColor(severityColor(Severity.CRITICAL, this._theme)),
                iconName: 'dialog-warning-symbolic',
            });
        }
        this._updateStatus();
    }

    // The footer shows the most recent successful fetch among the cards.
    _updateStatus() {
        let latest = null;
        for (const id of this._vendorItems.keys()) {
            const at = this._results.get(id)?.ok ? this._fetchedAt.get(id) : null;
            if (at && (latest === null || at > latest))
                latest = at;
        }
        this._actions.setStatus(latest ? footerRow({fetchedAt: latest}, _).text : '');
    }

    // Palette colours are tuned for bars; as text on a dark popup they are
    // brightened until readable. A light popup keeps them as they are.
    _textColor(color) {
        return color && this._darkPopup ? legibleOnDark(color) : color;
    }

    // The shell theme is dark when its menu foreground is light.
    _readPopupScheme() {
        const fg = this.menu.box.get_theme_node().get_foreground_color();
        const hex = `#${[fg.red, fg.green, fg.blue].map(v => v.toString(16).padStart(2, '0')).join('')}`;
        this._darkPopup = luminance(hex) > 0.5;
    }

    _setActiveExpansion(activeId) {
        for (const [id, card] of this._vendorItems) {
            const want = id === activeId;
            if (card.item.menu.isOpen !== want)
                card.item.setSubmenuShown(want);
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
                this._results.set(id, loading());
        }

        this._maybeRebuildVendorSections(config);
        if (this._segments.maybeRebuild(config))
            this._paintSegments();
        for (const id of added)
            this._renderVendorSection(id);
        if (activeChanged)
            this._setActiveExpansion(activeId);
        return added;
    }

    _reloadConfig() {
        this._config = readConfig(this._settings);
        this._syncTargets(this._config);
    }

    async _refresh() {
        this._reloadConfig();
        await Promise.all(this._pollIds.map(id => this._refreshVendor(id)));
    }

    async _refreshAll() {
        this._reloadConfig();
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

        this._vendorItems.get(id)?.setBusy(true);
        const adapter = getAdapter(id);
        const cache = new Cache(adapter.cacheId);
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
        this._vendorItems.get(id)?.setBusy(false);
        this._storeResult(id, res);
        this._maybeScanContext(id, res, config);
        const polled = this._pollIds.includes(id);
        if (all || polled)
            this._notifier.maybeNotify(adapter, cache, res, config);
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

    // The real fetch, reshaped by the dev overrides when set (see
    // _readDevOverrides). Without FAKE_PCT a failed vendor's real fetch runs
    // against an HTTP 503, so its own stale fallback and sidecars are exercised.
    async _runFetch(adapter, ctx) {
        if (this._fakeDelayMs !== null)
            await this._fakeDelay(this._fakeDelayMs);
        const failure = this._fakeErrors?.get(adapter.id) ?? null;
        if (this._fakePct !== null && typeof adapter.fakeSnapshot === 'function')
            return fakeResult(failure, () => adapter.fakeSnapshot(this._fakePct, new Date(), ctx.config));
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

    // Repaint every panel segment and every card from the results map.
    _reRenderFromCache() {
        if (this._destroyed)
            return;
        try {
            this._paintSegments();
            for (const id of this._vendorItems.keys())
                this._renderVendorSection(id);
        } catch (e) {
            console.warn(`ai-usagebar: re-render failed: ${e}`);
        }
    }

    _rebuildTheme() {
        this._theme = withOverrides(defaultTheme(), this._config.colors);
    }

    vfunc_scroll_event(event) {
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

        this._setActiveVendor(next);
        // Expand synchronously for instant feedback; the settings handler (fired by
        // the active-vendor write) re-resolves and fetches the new vendor.
        this._setActiveExpansion(next);
        return Clutter.EVENT_STOP;
    }

    _rebuildSegments(config) {
        this._segments.rebuild(config);
        this._paintSegments();
    }

    _paintSegments() {
        for (const id of this._segments.ids())
            this._paintSegment(id);
    }

    _paintSegment(id) {
        this._segments.paint(id, this._results.get(id), {config: this._config, theme: this._theme});
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
        const id = this._segments.nearest(x);
        if (id === null || id === this._activeId)
            return;
        this._activeId = id;
        this._setActiveVendor(id);
    }

    _onPopupOpen() {
        this._focusClickedSegment();
        this._setActiveExpansion(this._activeId);
        this._readPopupScheme();
        this._reRenderFromCache();
        if (this._renderTimeoutId)
            return;
        this._renderTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RERENDER_INTERVAL_S, () => {
            this._reRenderFromCache();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onPopupClose() {
        this._clearSource('_renderTimeoutId');
    }

    // Symbolic name (-symbolic.svg) so St recolors it to the menu foreground;
    // a plain icon would render its currentColor as black and vanish in dark.
    _vendorGicon(id = null) {
        const name = id !== null && this._config.showVendorIcons ? vendorIconName(id) : GENERIC_ICON;
        const f = Gio.File.new_for_path(GLib.build_filenamev([this._path, 'icons', `${name}.svg`]));
        return new Gio.FileIcon({file: f});
    }

    // Runs on any destroy, from JS or from the shell tearing the panel down,
    // so nothing here may outlive the actor.
    _onDestroy() {
        this._destroyed = true;

        this._clearSource('_timeoutId');
        this._clearSource('_renderTimeoutId');
        this._clearSource('_settingsIdleId');
        for (const id of this._fakeDelayIds)
            GLib.Source.remove(id);
        this._fakeDelayIds.clear();
        this.menu.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._cancellable.cancel();
        this._tooltip.destroy();
        this._update.destroy();
        this._segments.destroy();

        this._settings = null;
        this._notifier = null;
        this._vendorItems.clear();
        this._guards.clear();
        this._pendingAll.clear();
        this._results.clear();
        this._fetchedAt.clear();

        super._onDestroy();
    }
});
