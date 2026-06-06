/**
 * @file Top-panel indicator widget. Polls the Anthropic vendor every
 * {@link REFRESH_INTERVAL_S} seconds (plus once immediately on construction),
 * renders the default bar label `cld <pct>% · <reset>` colored by severity, and
 * shows `Loading…`/`⚠` placeholder states. Owns the shared cancellable, the
 * refresh timeout source, and the Soup session — all torn down in `destroy()`.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {Cache} from '../lib/cache.js';
import {request, disposeSession} from '../lib/http.js';
import {defaultCredsPath} from '../lib/oauth/anthropic.js';
import {fetchSnapshot} from '../lib/vendors/anthropic.js';
import {placeholders, anthropicSeverity} from '../lib/vendors/anthropic-parse.js';
import {substitute} from '../lib/format.js';
import {severityColor, Severity} from '../lib/severity.js';
import {defaultTheme} from '../lib/theme.js';

/** @type {string} Default panel bar format. */
const DEFAULT_FORMAT = '{vendor_short} {session_pct}% · {session_reset}';
/** @type {number} Poll interval — upstream rate-limits below 300s. */
const REFRESH_INTERVAL_S = 300;

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
     * Build the panel widget, kick off an immediate refresh, and start the
     * 300s poll timer.
     * @returns {void}
     */
    _init() {
        super._init(0.0, 'ai-usagebar');

        this._cancellable = new Gio.Cancellable();
        this._cache = Cache.forVendor('anthropic');
        this._theme = defaultTheme();
        this._timeoutId = null;
        this._destroyed = false;

        this._box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._label = new St.Label({text: 'cld —'});
        this._box.add_child(this._label);
        this.add_child(this._box);

        // One immediate refresh, then poll. A rejected promise must never
        // escape into the timeout callback / event loop.
        this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_S, () => {
            this._refresh().catch(e => console.warn(`ai-usagebar: refresh failed: ${e}`));
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * Fetch the current snapshot and repaint the label. Guards against a
     * post-destroy callback touching a freed widget. Never throws.
     * @returns {Promise<void>}
     */
    async _refresh() {
        const res = await fetchSnapshot({
            cache: this._cache,
            http: request,
            credsPath: defaultCredsPath(),
            signal: this._cancellable,
        });
        if (this._destroyed)
            return;
        this._render(res);
    }

    /**
     * Paint the label text + inline color for a {@link FetchResult}.
     * @param {import('../lib/vendors/anthropic.js').FetchResult} res
     * @returns {void}
     */
    _render(res) {
        if (res.ok) {
            const text = substitute(DEFAULT_FORMAT, placeholders(res.snapshot, new Date()));
            this._setLabel(text, severityColor(anthropicSeverity(res.snapshot), this._theme));
        } else if (res.kind === 'loading') {
            this._setLabel('Loading…', this._theme.fg);
        } else {
            // kind: 'error' — message is retained on disk (.last_error) and in
            // the result for Step 4's popup; log it here.
            console.warn(`ai-usagebar: ${res.message}`);
            this._setLabel('⚠', severityColor(Severity.CRITICAL, this._theme));
        }
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
     * Tear down: stop the poll timer, cancel pending I/O, dispose the Soup
     * session, clear the popup, and chain to the GObject destructor. Idempotent.
     * @returns {void}
     */
    destroy() {
        this._destroyed = true;

        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        disposeSession();

        this.menu?.removeAll();

        super.destroy();
    }
});
