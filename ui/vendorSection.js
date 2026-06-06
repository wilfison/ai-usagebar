/**
 * @file Thin renderer that walks a {@link SectionModel} and populates a
 * `PopupMenu` section with St widgets. Holds no business logic — all severity
 * colors, countdowns, and text come pre-resolved on the model; this module only
 * maps row kinds to widgets. Icons are system symbolic icons (`St.Icon`) and
 * foreground/dim/accent text inherits the live shell theme via CSS classes, so
 * the popup tracks the user's GNOME theme. The section is cleared and rebuilt on
 * every refresh.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {makeBar} from './bar.js';

/**
 * Build a styled `St.Label`. Pass `color` only for severity-driven values
 * (which must override the theme); foreground/dim/title text uses `styleClass`
 * so it inherits the live shell theme.
 * @param {string} text
 * @param {?{color?: string, bold?: boolean, styleClass?: string}} [opts]
 * @returns {St.Label}
 */
function label(text, opts = null) {
    const props = {text, y_align: Clutter.ActorAlign.CENTER};
    if (opts?.styleClass)
        props.style_class = opts.styleClass;
    const l = new St.Label(props);
    let css = '';
    if (opts?.color)
        css += `color: ${opts.color};`;
    if (opts?.bold)
        css += 'font-weight: bold;';
    if (css)
        l.set_style(css);
    return l;
}

/**
 * Build a system symbolic icon. Symbolic icons auto-recolor to the themed
 * foreground; `dim` applies the secondary-text opacity to match a dim label.
 * @param {string} name - symbolic icon name (e.g. `alarm-symbolic`).
 * @param {boolean} [dim] - render at secondary-text opacity.
 * @returns {St.Icon}
 */
function makeIcon(name, dim = false) {
    return new St.Icon({
        icon_name: name,
        style_class: dim ? 'popup-menu-icon aiusagebar-dim' : 'popup-menu-icon',
        y_align: Clutter.ActorAlign.CENTER,
    });
}

/**
 * Append one non-reactive display line to the section and return its horizontal
 * content box for children to be added to.
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @returns {St.BoxLayout}
 */
function addLine(menuSection) {
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const box = new St.BoxLayout({style_class: 'aiusagebar-row'});
    item.add_child(box);
    menuSection.addMenuItem(item);
    return box;
}

/**
 * Render a single `window` row: icon + title line, bar + pct + pace, dim reset
 * line. When `opts.showMarker` is set and the row carries a numeric `elapsedPct`,
 * the bar draws the elapsed-position marker.
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @param {import('../lib/theme.js').Theme} theme
 * @param {{showMarker?: boolean}} opts
 * @returns {void}
 */
function renderWindow(menuSection, row, theme, opts) {
    const titleLine = addLine(menuSection);
    if (row.icon)
        titleLine.add_child(makeIcon(row.icon));
    titleLine.add_child(label(row.title));

    const barLine = addLine(menuSection);
    const barOpts = opts.showMarker && typeof row.elapsedPct === 'number'
        ? {markerPct: row.elapsedPct}
        : null;
    barLine.add_child(makeBar(row.pct, row.color, theme, barOpts));
    const pctText = row.paceGlyph ? `${row.pct}% ${row.paceGlyph}` : `${row.pct}%`;
    barLine.add_child(label(pctText, {color: row.color, bold: true}));

    const resetLine = addLine(menuSection);
    resetLine.add_child(makeIcon('alarm-symbolic', true));
    resetLine.add_child(label(`Resets in ${row.reset}`, {styleClass: 'aiusagebar-dim'}));
}

/**
 * Render a `gauge` row: icon + title line, then a value line (bar drawn only
 * when `row.pct` is a number, omitted when `null`) with the bold colored value,
 * and an optional dim sub-line.
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @param {import('../lib/theme.js').Theme} theme
 * @returns {void}
 */
function renderGauge(menuSection, row, theme) {
    const titleLine = addLine(menuSection);
    if (row.icon)
        titleLine.add_child(makeIcon(row.icon));
    titleLine.add_child(label(row.title));

    const valLine = addLine(menuSection);
    if (typeof row.pct === 'number')
        valLine.add_child(makeBar(row.pct, row.color, theme));
    valLine.add_child(label(row.value, {color: row.color, bold: true}));

    if (row.subLine)
        addLine(menuSection).add_child(label(row.subLine, {styleClass: 'aiusagebar-dim'}));
}

/**
 * Render a `text` row: optional icon + text. Color precedence is explicit
 * `row.color` hex, else `row.tone` ('dim' → dim class, otherwise themed
 * foreground).
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @returns {void}
 */
function renderText(menuSection, row) {
    const dim = row.tone === 'dim';
    const line = addLine(menuSection);
    if (row.icon)
        line.add_child(makeIcon(row.icon, dim && !row.color));
    if (row.color)
        line.add_child(label(row.text, {color: row.color}));
    else
        line.add_child(label(row.text, dim ? {styleClass: 'aiusagebar-dim'} : null));
}

/**
 * Render the `http-error` block: separator, icon + status line, dim wrapped body
 * lines.
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @returns {void}
 */
function renderHttpError(menuSection, row) {
    menuSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    const head = addLine(menuSection);
    if (row.icon)
        head.add_child(makeIcon(row.icon));
    head.add_child(label(`HTTP ${row.code}`, {color: row.color}));
    for (const line of row.lines)
        addLine(menuSection).add_child(label(line, {styleClass: 'aiusagebar-dim'}));
}

/**
 * Clear `menuSection` and repopulate it from `model`. Always emits the accent
 * header first, then one or more lines per row in model order.
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').SectionModel} model
 * @param {import('../lib/theme.js').Theme} theme
 * @param {{showMarker?: boolean}} [opts] - render options; `showMarker` draws the
 *   elapsed-position marker on window bars.
 * @returns {void}
 */
export function renderSection(menuSection, model, theme, opts = {}) {
    menuSection.removeAll();

    addLine(menuSection).add_child(label(model.title, {styleClass: 'aiusagebar-title'}));

    for (const row of model.rows) {
        switch (row.kind) {
        case 'window':
            renderWindow(menuSection, row, theme, opts);
            break;
        case 'gauge':
            renderGauge(menuSection, row, theme);
            break;
        case 'text':
            renderText(menuSection, row);
            break;
        case 'http-error':
            renderHttpError(menuSection, row);
            break;
        case 'footer': {
            menuSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const footLine = addLine(menuSection);
            if (row.icon)
                footLine.add_child(makeIcon(row.icon, true));
            footLine.add_child(label(`Updated ${row.updated}`, {styleClass: 'aiusagebar-dim'}));
            break;
        }
        }
    }
}
