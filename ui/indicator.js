/**
 * @file Top-panel indicator widget. Polls the Anthropic vendor on the
 * configured refresh interval (plus once immediately on construction),
 * renders the configured bar label `cld <pct>% · <reset>` colored by severity (with
 * a trailing `⏸` when the data is stale), and fills the popup with a detailed
 * usage section, a "Refresh now" action, and `Loading…`/`⚠` states. While the
 * popup is open a 60s timer re-renders the cached snapshot so countdowns tick
 * without hitting the network. Owns the shared cancellable, the refresh timeout
 * source, the live re-render source, the Soup session, and the popup signal
 * handler — all torn down in `destroy()`.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Cache} from '../lib/cache.js';
import {readConfig, anthropicCredsPath} from '../lib/config.js';
import {request, disposeSession} from '../lib/http.js';
import {fetchSnapshot} from '../lib/vendors/anthropic.js';
import {placeholders, anthropicSeverity} from '../lib/vendors/anthropic-parse.js';
import {buildSection} from '../lib/vendors/anthropic-section.js';
import {renderSection} from './vendorSection.js';
import {substitute} from '../lib/format.js';
import {severityColor, Severity} from '../lib/severity.js';
import {defaultTheme} from '../lib/theme.js';

/** @type {number} Live countdown re-render cadence while the popup is open. */
const RERENDER_INTERVAL_S = 60;
/** @type {string} Suffix appended to the label when the served data is stale. */
const STALE_MARK = ' ⏸';

/**
 * `PanelMenu.Button` subclass that shows Anthropic plan usage in the top panel.
 *
 * Construct via `new Indicator()`; `GObject.registerClass` rewires the
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
     * @returns {void}
     */
    _init(settings) {
        super._init(0.0, 'ai-usagebar');

        this._settings = settings;
        this._config = readConfig(settings);
        this._barFormat = this._config.barFormat;

        this._cancellable = new Gio.Cancellable();
        this._cache = Cache.forVendor('anthropic');
        this._theme = defaultTheme();
        this._timeoutId = null;
        this._renderTimeoutId = null;
        this._openStateId = null;
        this._destroyed = false;
        this._lastResult = null;
        this._fetchedAt = null;

        this._box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._label = new St.Label({text: 'cld —'});
        this._box.add_child(this._label);
        this.add_child(this._box);

        // Popup: vendor section, separator, "Refresh now". Seed the section with
        // a Loading… row so an immediately-opened popup is never empty.
        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._section);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._refreshItem = new PopupMenu.PopupMenuItem('Refresh now');
        this._refreshItem.connect('activate', () => {
            if (this._destroyed)
                return;
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
        });
        this.menu.addMenuItem(this._refreshItem);
        this._setSectionMessage('Loading…', this._theme.dim);

        // Live countdowns: re-render from cache only while the popup is open.
        this._openStateId = this.menu.connect('open-state-changed', (_m, open) => {
            if (this._destroyed)
                return;
            if (open)
                this._onPopupOpen();
            else
                this._onPopupClose();
        });

        // One immediate refresh, then poll. A rejected promise must never
        // escape into the timeout callback / event loop.
        this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._config.refreshIntervalSecs, () => {
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * Fetch the current snapshot and repaint the label + popup. Guards against a
     * post-destroy callback touching a freed widget. Never throws.
     * @returns {Promise<void>}
     */
    async _refresh() {
        // Re-read config each tick so a creds-path or bar-format change applied
        // via gsettings takes effect on the next refresh without a reactive
        // handler (reactive binding lands with the prefs dialog).
        this._config = readConfig(this._settings);
        this._barFormat = this._config.barFormat;
        const res = await fetchSnapshot({
            cache: this._cache,
            http: request,
            credsPath: anthropicCredsPath(this._config),
            signal: this._cancellable,
        });
        if (this._destroyed)
            return;
        this._render(res);
    }

    /**
     * Paint the label + popup for a {@link FetchResult} and remember it for live
     * re-renders.
     * @param {import('../lib/vendors/anthropic.js').FetchResult} res
     * @returns {void}
     */
    _render(res) {
        this._lastResult = res;
        if (res.ok) {
            this._fetchedAt = new Date(Date.now() - res.cacheAgeMs);
            const now = new Date();
            this._paintLabelOk(res.snapshot, res.stale, now);
            this._paintSection(res, now);
        } else if (res.kind === 'loading') {
            this._setLabel('Loading…', this._theme.fg);
            this._setSectionMessage('Loading…', this._theme.dim);
        } else {
            // kind: 'error' — message is retained on disk (.last_error) and in
            // the result; surface it in the popup and log it.
            console.warn(`ai-usagebar: ${res.message}`);
            const critical = severityColor(Severity.CRITICAL, this._theme);
            this._setLabel('⚠', critical);
            this._setSectionMessage(`⚠ ${res.message}`, critical);
        }
    }

    /**
     * Re-render the label + popup from the last successful result without
     * fetching. Uses a fresh clock for countdowns but keeps the footer pinned to
     * the original fetch instant. No-op (never throws) when there is no usable
     * cached result.
     * @returns {void}
     */
    _reRenderFromCache() {
        if (this._destroyed || !this._lastResult || !this._lastResult.ok)
            return;
        try {
            const now = new Date();
            this._paintLabelOk(this._lastResult.snapshot, this._lastResult.stale, now);
            this._paintSection(this._lastResult, now);
        } catch (e) {
            console.warn(`ai-usagebar: re-render failed: ${e}`);
        }
    }

    /**
     * Paint the panel label for a successful result, appending the stale marker
     * when the data came from cache after a failed fetch.
     * @param {import('../lib/vendors/anthropic-parse.js').AnthropicSnapshot} snapshot
     * @param {boolean} stale
     * @param {Date} now
     * @returns {void}
     */
    _paintLabelOk(snapshot, stale, now) {
        let text = substitute(this._barFormat, placeholders(snapshot, now));
        if (stale)
            text += STALE_MARK;
        this._setLabel(text, severityColor(anthropicSeverity(snapshot), this._theme));
    }

    /**
     * Rebuild the popup vendor section from a successful result.
     * @param {import('../lib/vendors/anthropic.js').FetchResult} res
     * @param {Date} now
     * @returns {void}
     */
    _paintSection(res, now) {
        const model = buildSection(
            res.snapshot,
            {stale: res.stale, lastError: res.lastError, fetchedAt: this._fetchedAt},
            now,
            this._theme,
        );
        renderSection(this._section, model, this._theme);
    }

    /**
     * On popup open: re-render immediately from cache, then start the 60s live
     * re-render timer.
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
     * Replace the popup section with a single dim/colored message row (used for
     * Loading… and error states).
     * @param {string} text
     * @param {string} color - hex color.
     * @returns {void}
     */
    _setSectionMessage(text, color) {
        this._section.removeAll();
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const l = new St.Label({text});
        l.set_style(`color: ${color};`);
        item.add_child(l);
        this._section.addMenuItem(item);
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
     * Tear down: stop the poll + live re-render timers, disconnect the popup
     * signal, cancel pending I/O, dispose the Soup session, clear the popup, and
     * chain to the GObject destructor. Idempotent.
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
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        disposeSession();
        this._settings = null;

        this.menu?.removeAll();

        super.destroy();
    }
});
