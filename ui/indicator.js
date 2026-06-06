/**
 * @file Top-panel indicator widget. Polls the effective *active* vendor (the
 * scroll-selected one, falling back to the configured primary) on the refresh
 * interval (plus once immediately on construction), renders the configured bar
 * label colored by severity (with a trailing `⏸` when the data is stale), and
 * fills the popup with one collapsible sub-section per enabled vendor — the
 * active vendor's expanded — plus "Refresh now" / "Refresh all" actions.
 *
 * Scrolling the button cycles through enabled vendors (UP = next, DOWN = prev,
 * wrap-around): it writes `active-vendor`, mirrors it to disk best-effort, and
 * triggers an immediate re-resolve + fetch of the newly-active vendor. Only the
 * active vendor is fetched on the poll tick; other sub-sections render from an
 * in-memory results map (populated lazily on cycle or via "Refresh all") and
 * show a placeholder until they have data. While the popup is open a 60s timer
 * re-renders the active sub-section so countdowns tick without hitting the
 * network. Owns the shared cancellable, the refresh + live-render timeout
 * sources, the Soup session, the popup signal, and the scroll signal — all torn
 * down in `destroy()`.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Cache} from '../lib/cache.js';
import {readConfig} from '../lib/config.js';
import {normalizeActive, cycleVendor, enabledVendors} from '../lib/config-resolve.js';
import {writeActiveVendorMirror} from '../lib/active-vendor.js';
import {request, disposeSession} from '../lib/http.js';
import {getAdapter} from '../lib/vendors/registry.js';
import {renderSection} from './vendorSection.js';
import {substitute, tooltipRows} from '../lib/format.js';
import {severityColor, Severity} from '../lib/severity.js';
import {defaultTheme, withOverrides} from '../lib/theme.js';

/** @type {number} Live countdown re-render cadence while the popup is open. */
const RERENDER_INTERVAL_S = 60;
/** @type {string} Suffix appended to the label when the served data is stale. */
const STALE_MARK = ' ⏸';
/** @type {string} Placeholder row for an enabled vendor with no data yet. */
const NO_DATA_MSG = 'No data — use "Refresh all"';

/**
 * `PanelMenu.Button` subclass that shows multi-vendor AI plan usage in the top
 * panel and cycles vendors on scroll.
 *
 * Construct via `new Indicator(settings)`; `GObject.registerClass` rewires the
 * constructor to call `_init` for you.
 * @class Indicator
 * @extends PanelMenu.Button
 */
export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    /**
     * Build the panel widget and popup, kick off an immediate refresh, and start
     * the poll timer at the configured interval.
     * @param {object} settings - the extension's Gio.Settings store.
     * @param {() => void} [openPreferences] - opens the prefs window (bound
     *   `Extension.openPreferences`); wired to the "Preferences" popup item.
     * @returns {void}
     */
    _init(settings, openPreferences) {
        super._init(0.0, 'ai-usagebar');

        this._settings = settings;
        this._openPreferences = openPreferences;
        this._config = readConfig(settings);
        this._barFormat = this._config.barFormat;

        this._cancellable = new Gio.Cancellable();
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

        // D4 lazy data: only the active vendor is polled; other sub-sections
        // render from whatever is already here. `_fetchedAt` pins each vendor's
        // footer timestamp to its real fetch instant across live re-renders.
        this._results = new Map();      // vendorId -> FetchResult
        this._fetchedAt = new Map();    // vendorId -> Date
        this._vendorItems = new Map();  // vendorId -> PopupMenu.PopupSubMenuMenuItem
        this._enabledSig = '';

        this._box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._label = new St.Label({text: `${this._adapter.vendorShort} —`});
        this._box.add_child(this._label);
        this.add_child(this._box);

        // Footer items are created once (handlers connected once); per-vendor
        // sub-sections are inserted above the separator on (re)build.
        this._separator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._separator);
        this._refreshItem = new PopupMenu.PopupMenuItem('Refresh now');
        this._refreshItem.connect('activate', () => {
            if (this._destroyed)
                return;
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
        });
        this.menu.addMenuItem(this._refreshItem);
        this._refreshAllItem = new PopupMenu.PopupMenuItem('Refresh all');
        this._refreshAllItem.connect('activate', () => {
            if (this._destroyed)
                return;
            this._refreshAll().catch(e => console.warn(`ai-usagebar: refresh all failed: ${e}`));
        });
        this.menu.addMenuItem(this._refreshAllItem);
        this._prefsItem = new PopupMenu.PopupMenuItem('Preferences');
        this._prefsItem.connect('activate', () => {
            if (this._destroyed)
                return;
            this._openPreferences?.();
        });
        this.menu.addMenuItem(this._prefsItem);

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

        // Scroll to cycle enabled vendors.
        this._scrollId = this.connect('scroll-event', (actor, event) => this._onScroll(actor, event));

        // React to settings changes (prefs / gsettings / scroll write) immediately.
        this._settingsChangedId = this._settings.connect('changed', (s, key) => this._onSettingsChanged(s, key));

        // One immediate refresh, then poll. A rejected promise must never escape
        // into the timeout callback / event loop.
        this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
        this._rearmPollTimer(this._config.refreshIntervalSecs);
    }

    /**
     * (Re)arm the recurring poll timer at `secs`, removing any existing source
     * first so there is never a duplicate timer. The tick fetches the active
     * vendor only; a rejected promise never escapes into the event loop.
     * @param {number} secs - schema-clamped refresh interval (>= 300).
     * @returns {void}
     */
    _rearmPollTimer(secs) {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * React to a GSettings change: cheap repaint by default; a full re-resolve +
     * fetch only when the effective active vendor id actually changed; poll-timer
     * re-arm only on `refresh-interval`; and `active-vendor := primary-vendor`
     * sync (D2) on a `primary-vendor` change. Never fetches on a burst of
     * credential/format edits — those land on the next tick or "Refresh now".
     * @param {object} settings - the Gio.Settings store (same as this._settings).
     * @param {string} key - the changed key name.
     * @returns {void}
     */
    _onSettingsChanged(settings, key) {
        if (this._destroyed)
            return;

        // D2: a primary change forces active := primary. The set_string re-enters
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

        // Active vendor changed (scroll write, primary sync, or a disable that
        // bumped the fallback): _refresh swaps adapter + cache, rebuilds sub-menus,
        // and fetches — a cache-warm revisit skips the network via the 60s TTL.
        if (normalizeActive(config) !== this._adapter.id) {
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
            return;
        }

        // Same active vendor: reflect config in-process only (no fetch).
        this._config = config;
        this._barFormat = config.barFormat;
        this._maybeRebuildVendorSections(config);

        // Appearance-only keys (severity colors, popup format, pace marker) affect
        // every built section, not just the active one — rebuild the theme on a
        // color change and re-render all sub-sections. Everything else repaints
        // just the active section.
        if (key.startsWith('color-'))
            this._rebuildTheme();
        if (key.startsWith('color-') || key === 'tooltip-format' || key === 'show-pace-marker')
            this._reRenderAllSections();
        else
            this._reRenderFromCache();
    }

    /**
     * Signature of the enabled-vendor set in canonical order. Used to rebuild the
     * sub-sections only when the set changes, not on every tick.
     * @param {import('../lib/config.js').ConfigSnapshot} config
     * @returns {string}
     */
    _enabledSignature(config) {
        return enabledVendors(config).join(',');
    }

    /**
     * Rebuild the per-vendor sub-sections only when the enabled set changed.
     * @param {import('../lib/config.js').ConfigSnapshot} config
     * @returns {void}
     */
    _maybeRebuildVendorSections(config) {
        if (this._enabledSignature(config) !== this._enabledSig)
            this._rebuildVendorSections(config);
    }

    /**
     * Destroy the existing vendor sub-sections and recreate one
     * `PopupSubMenuMenuItem` per enabled vendor (canonical order), inserted above
     * the separator, each rendered from its current results-map entry. Expands
     * the active vendor's sub-section.
     * @param {import('../lib/config.js').ConfigSnapshot} config
     * @returns {void}
     */
    _rebuildVendorSections(config) {
        for (const item of this._vendorItems.values())
            item.destroy();
        this._vendorItems.clear();

        enabledVendors(config).forEach((id, idx) => {
            const adapter = getAdapter(id);
            const sub = new PopupMenu.PopupSubMenuMenuItem('', false);
            sub.label.text = `${adapter.icon}  ${adapter.vendorShort}`;
            this.menu.addMenuItem(sub, idx);
            this._vendorItems.set(id, sub);
            this._renderVendorSection(id);
        });

        this._enabledSig = this._enabledSignature(config);
        this._setActiveExpansion(this._activeId);
    }

    /**
     * Render a single vendor's sub-section from its results-map entry: the
     * adapter-built model when present and ok, a `Loading…`/placeholder/`⚠` row
     * otherwise. Always renders via the vendor's own adapter (never the active
     * one), so any entry paints correctly. No-op when the vendor has no item.
     * @param {string} id - vendor id.
     * @returns {void}
     */
    _renderVendorSection(id) {
        const item = this._vendorItems.get(id);
        if (!item)
            return;
        const section = item.menu;
        const res = this._results.get(id);
        if (!res) {
            this._setSubmenuMessage(section, NO_DATA_MSG, this._theme.dim);
            return;
        }
        if (res.ok) {
            const now = new Date();
            const fetchedAt = this._fetchedAt.get(id) ?? new Date(Date.now() - res.cacheAgeMs);
            const adapter = getAdapter(id);
            const model = adapter.buildSection(
                res.snapshot,
                {stale: res.stale, lastError: res.lastError, fetchedAt},
                now,
                this._theme,
            );
            // A non-empty tooltip-format prepends additive text rows built from
            // this vendor's placeholders, above the structured layout.
            if (this._config.tooltipFormat) {
                const extra = tooltipRows(this._config.tooltipFormat, adapter.placeholders(res.snapshot, now));
                if (extra.length)
                    model.rows = [...extra, ...model.rows];
            }
            renderSection(section, model, this._theme, {showMarker: this._config.showPaceMarker});
        } else if (res.kind === 'loading') {
            this._setSubmenuMessage(section, 'Loading…', this._theme.dim);
        } else {
            this._setSubmenuMessage(section, `⚠ ${res.message}`, severityColor(Severity.CRITICAL, this._theme));
        }
    }

    /**
     * Expand the active vendor's sub-section and collapse the rest. Skips
     * sub-sections already in the wanted state so it never fights an animation or
     * a user's manual expand/collapse on each tick.
     * @param {string} activeId - vendor id to expand.
     * @returns {void}
     */
    _setActiveExpansion(activeId) {
        for (const [id, item] of this._vendorItems) {
            const want = id === activeId;
            if (item.menu.isOpen !== want)
                item.setSubmenuShown(want);
        }
    }

    /**
     * Fetch the active vendor's snapshot and repaint the label + its sub-section.
     * Re-reads config each tick so a gsettings change (active/primary vendor,
     * creds path, bar format, interval) is picked up without a reactive handler.
     * Guards against a post-destroy callback touching a freed widget. Never throws.
     * @returns {Promise<void>}
     */
    async _refresh() {
        this._config = readConfig(this._settings);
        this._barFormat = this._config.barFormat;

        // Swap adapter + cache when the effective active vendor changed. Each
        // vendor's result is rendered through its own adapter, so no map entry
        // needs dropping — only the active fetch target changes.
        const activeId = normalizeActive(this._config);
        const activeChanged = activeId !== this._adapter.id;
        if (activeChanged) {
            this._adapter = getAdapter(activeId);
            this._cache = Cache.forVendor(this._adapter.cacheId);
        }
        this._activeId = activeId;

        this._maybeRebuildVendorSections(this._config);
        if (activeChanged)
            this._setActiveExpansion(activeId);

        const res = await this._adapter.fetchSnapshot({
            config: this._config,
            cache: this._cache,
            http: request,
            signal: this._cancellable,
        });
        if (this._destroyed)
            return;
        this._storeResult(activeId, res);
        this._render(res);
    }

    /**
     * Force-fetch every enabled vendor once, storing each `FetchResult` into the
     * map and repainting its sub-section. Per-vendor failures are isolated and
     * never throw into the caller. Repaints the active label/section at the end.
     * @returns {Promise<void>}
     */
    async _refreshAll() {
        const config = readConfig(this._settings);
        this._maybeRebuildVendorSections(config);

        for (const id of enabledVendors(config)) {
            const adapter = getAdapter(id);
            const cache = Cache.forVendor(adapter.cacheId);
            let res;
            try {
                res = await adapter.fetchSnapshot({
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
            this._renderVendorSection(id);
        }

        const activeRes = this._results.get(this._activeId);
        if (activeRes)
            this._render(activeRes);
    }

    /**
     * Store a vendor's fetch result and pin its footer timestamp (ok results
     * only) so live re-renders keep showing the real fetch instant.
     * @param {string} id - vendor id.
     * @param {import('../lib/vendors/types.js').FetchResult} res
     * @returns {void}
     */
    _storeResult(id, res) {
        this._results.set(id, res);
        if (res.ok)
            this._fetchedAt.set(id, new Date(Date.now() - res.cacheAgeMs));
    }

    /**
     * Paint the label for the active vendor's {@link FetchResult} and re-render
     * its sub-section. Expansion is managed separately (only on active change /
     * rebuild) so it does not fight a user's manual collapse.
     * @param {import('../lib/vendors/types.js').FetchResult} res
     * @returns {void}
     */
    _render(res) {
        if (res.ok) {
            const now = new Date();
            this._paintLabelOk(res.snapshot, res.stale, now);
        } else if (res.kind === 'loading') {
            this._setLabel('Loading…', this._theme.fg);
        } else {
            // kind: 'error' — message is retained on disk (.last_error) and in
            // the result; surface it in the popup and log it.
            console.warn(`ai-usagebar: ${res.message}`);
            this._setLabel('⚠', severityColor(Severity.CRITICAL, this._theme));
        }
        this._renderVendorSection(this._activeId);
    }

    /**
     * Re-render the active vendor's label + sub-section from cache without
     * fetching. Uses a fresh clock for countdowns but the pinned fetch instant
     * for the footer. No-op (never throws) when there is no usable cached result.
     * @returns {void}
     */
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

    /**
     * Rebuild the active palette from the One-Dark default plus the user's
     * severity-color overrides (empty/invalid entries fall back to the default).
     * Call after `this._config` is (re)read so the theme tracks the prefs.
     * @returns {void}
     */
    _rebuildTheme() {
        this._theme = withOverrides(defaultTheme(), this._config.colors);
    }

    /**
     * Re-render the active label + every built vendor sub-section from cache,
     * without fetching. Used by appearance-only changes (theme colors, popup
     * format, pace marker) that affect all sections, not just the active one.
     * @returns {void}
     */
    _reRenderAllSections() {
        if (this._destroyed)
            return;
        this._reRenderFromCache();
        for (const id of this._vendorItems.keys()) {
            if (id !== this._activeId)
                this._renderVendorSection(id);
        }
    }

    /**
     * Cycle to the next/previous enabled vendor on scroll. No-op (propagates the
     * event) for non vertical scroll or when fewer than two vendors are enabled.
     * On a real cycle it persists `active-vendor`, mirrors it to disk, expands the
     * new sub-section, and triggers an immediate re-resolve + fetch.
     * @param {Clutter.Actor} _actor
     * @param {Clutter.Event} event
     * @returns {number} `Clutter.EVENT_STOP` when consumed, else `EVENT_PROPAGATE`.
     */
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

    /**
     * Paint the panel label for a successful result, appending the stale marker
     * when the data came from cache after a failed fetch.
     * @param {*} snapshot - the active adapter's snapshot.
     * @param {boolean} stale
     * @param {Date} now
     * @returns {void}
     */
    _paintLabelOk(snapshot, stale, now) {
        let text = substitute(this._barFormat, this._adapter.placeholders(snapshot, now));
        if (stale)
            text += STALE_MARK;
        this._setLabel(text, severityColor(this._adapter.severity(snapshot), this._theme));
    }

    /**
     * On popup open: re-render immediately from cache, then start the 60s live
     * re-render timer (active sub-section only).
     * @returns {void}
     */
    _onPopupOpen() {
        this._reRenderFromCache();
        if (this._renderTimeoutId)
            return;
        this._renderTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RERENDER_INTERVAL_S, () => {
            this._reRenderFromCache();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * On popup close: stop the live re-render timer.
     * @returns {void}
     */
    _onPopupClose() {
        if (this._renderTimeoutId) {
            GLib.Source.remove(this._renderTimeoutId);
            this._renderTimeoutId = null;
        }
    }

    /**
     * Replace a (sub)menu section with a single dim/colored message row (used for
     * Loading…, placeholder, and error states).
     * @param {PopupMenu.PopupMenuBase} menu - the section/submenu to fill.
     * @param {string} text
     * @param {string} color - hex color.
     * @returns {void}
     */
    _setSubmenuMessage(menu, text, color) {
        menu.removeAll();
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const l = new St.Label({text});
        l.set_style(`color: ${color};`);
        item.add_child(l);
        menu.addMenuItem(item);
    }

    /**
     * Set the label text and inline foreground color.
     * @param {string} text
     * @param {string} color - hex color.
     * @returns {void}
     */
    _setLabel(text, color) {
        this._label.text = text;
        this._label.set_style(`color: ${color};`);
    }

    /**
     * Tear down: stop the poll + live re-render timers, disconnect the popup,
     * scroll, and settings-changed signals, cancel pending I/O, dispose the Soup
     * session, drop the in-memory maps, clear the popup, and chain to the GObject
     * destructor. Idempotent.
     * @returns {void}
     */
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
        this._settings = null;

        this._vendorItems.clear();
        this._results.clear();
        this._fetchedAt.clear();

        this.menu?.removeAll();

        super.destroy();
    }
});
