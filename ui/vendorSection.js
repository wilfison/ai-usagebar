/**
 * @file Thin renderer that walks a {@link SectionModel} and populates a
 * `PopupMenu` section with St widgets. Holds no business logic — all colors,
 * countdowns, and text come pre-resolved on the model; this module only maps row
 * kinds to widgets. The section is cleared and rebuilt on every refresh.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {makeBar} from './bar.js';

/**
 * Build a styled `St.Label`.
 * @param {string} text
 * @param {?{color?: string, bold?: boolean}} [style]
 * @returns {St.Label}
 */
function label(text, style = null) {
    const l = new St.Label({text, y_align: Clutter.ActorAlign.CENTER});
    let css = '';
    if (style?.color)
        css += `color: ${style.color};`;
    if (style?.bold)
        css += 'font-weight: bold;';
    if (css)
        l.set_style(css);
    return l;
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
 * Render a single `window` row: title line, bar + pct + pace, dim reset line.
 * When `opts.showMarker` is set and the row carries a numeric `elapsedPct`, the
 * bar draws the elapsed-position marker.
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @param {import('../lib/theme.js').Theme} theme
 * @param {{showMarker?: boolean}} opts
 * @returns {void}
 */
function renderWindow(menuSection, row, theme, opts) {
    addLine(menuSection).add_child(label(`${row.icon}  ${row.title}`, {color: theme.fg}));

    const barLine = addLine(menuSection);
    const barOpts = opts.showMarker && typeof row.elapsedPct === 'number'
        ? {markerPct: row.elapsedPct}
        : null;
    barLine.add_child(makeBar(row.pct, row.color, theme, barOpts));
    const pctText = row.paceGlyph ? `${row.pct}% ${row.paceGlyph}` : `${row.pct}%`;
    barLine.add_child(label(pctText, {color: row.color, bold: true}));

    addLine(menuSection).add_child(label(`⏱  Resets in ${row.reset}`, {color: theme.dim}));
}

/**
 * Render a `gauge` row: title line, then a value line (bar drawn only when
 * `row.pct` is a number, omitted when `null`) with the bold colored value, and an
 * optional dim sub-line.
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @param {import('../lib/theme.js').Theme} theme
 * @returns {void}
 */
function renderGauge(menuSection, row, theme) {
    addLine(menuSection).add_child(label(`${row.icon}  ${row.title}`, {color: theme.fg}));

    const valLine = addLine(menuSection);
    if (typeof row.pct === 'number')
        valLine.add_child(makeBar(row.pct, row.color, theme));
    valLine.add_child(label(row.value, {color: row.color, bold: true}));

    if (row.subLine)
        addLine(menuSection).add_child(label(row.subLine, {color: theme.dim}));
}

/**
 * Render a `text` row: optional icon + text. Color precedence is explicit
 * `row.color` hex, else `row.tone` ('dim' → dim, otherwise foreground).
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @param {import('../lib/theme.js').Theme} theme
 * @returns {void}
 */
function renderText(menuSection, row, theme) {
    const color = row.color ?? (row.tone === 'dim' ? theme.dim : theme.fg);
    const text = row.icon ? `${row.icon}  ${row.text}` : row.text;
    addLine(menuSection).add_child(label(text, {color}));
}

/**
 * Render the `http-error` block: separator, status line, wrapped body lines.
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @param {import('../lib/theme.js').Theme} theme
 * @returns {void}
 */
function renderHttpError(menuSection, row, theme) {
    menuSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    addLine(menuSection).add_child(label(`${row.icon}  HTTP ${row.code}`, {color: row.color}));
    for (const line of row.lines)
        addLine(menuSection).add_child(label(line, {color: theme.dim}));
}

/**
 * Clear `menuSection` and repopulate it from `model`. Always emits the header
 * first, then one or more lines per row in model order.
 * @param {PopupMenu.PopupMenuSection} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').SectionModel} model
 * @param {import('../lib/theme.js').Theme} theme
 * @param {{showMarker?: boolean}} [opts] - render options; `showMarker` draws the
 *   elapsed-position marker on window bars.
 * @returns {void}
 */
export function renderSection(menuSection, model, theme, opts = {}) {
    menuSection.removeAll();

    addLine(menuSection).add_child(label(model.title, {color: theme.blue, bold: true}));

    for (const row of model.rows) {
        switch (row.kind) {
        case 'window':
            renderWindow(menuSection, row, theme, opts);
            break;
        case 'gauge':
            renderGauge(menuSection, row, theme);
            break;
        case 'text':
            renderText(menuSection, row, theme);
            break;
        case 'http-error':
            renderHttpError(menuSection, row, theme);
            break;
        case 'footer':
            menuSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            addLine(menuSection).add_child(label(`󰅐  Updated ${row.updated}`, {color: theme.dim}));
            break;
        }
    }
}
