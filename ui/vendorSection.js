/**
 * @file Thin renderer that walks a {@link SectionModel} and populates a
 * `PopupMenu` section with St widgets, laid out as a libadwaita boxed list:
 * the whole section lives in one non-reactive item; usage windows/gauges are
 * grouped into a rounded card, each row showing a leading symbolic icon, a
 * title with a dim subtitle stacked under it, a trailing severity-colored value,
 * and a full-width progress bar. Holds no business logic — all severity colors,
 * countdowns, and text come pre-resolved on the model; this module only maps row
 * kinds to widgets. Foreground/dim/accent text inherits the live shell theme via
 * CSS classes, so the popup tracks the user's GNOME theme. The section is cleared
 * and rebuilt on every refresh.
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
 * Build the leading-icon + (title / dim subtitle) + trailing-value header shared
 * by every boxed card row. The title/subtitle column expands, pushing the
 * trailing value to the right edge (Adwaita row layout).
 * @param {?string} iconName - leading symbolic icon, or null for none.
 * @param {string} title
 * @param {{subtitle?: string, trailing?: string}} [opts]
 * @returns {St.BoxLayout}
 */
function rowHeader(iconName, title, opts = {}) {
    const head = new St.BoxLayout({style_class: 'aiusagebar-row', x_expand: true});
    if (iconName)
        head.add_child(makeIcon(iconName));

    const col = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    col.add_child(label(title, {styleClass: 'aiusagebar-row-title'}));
    if (opts.subtitle)
        col.add_child(label(opts.subtitle, {styleClass: 'aiusagebar-dim aiusagebar-row-subtitle'}));
    head.add_child(col);

    if (opts.trailing)
        head.add_child(label(opts.trailing, {bold: true}));

    return head;
}

/**
 * Build an empty vertical card-row container (header line + bar stacked).
 * @returns {St.BoxLayout}
 */
function cardRow() {
    return new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-card-row'});
}

/**
 * Build a `window` boxed row: icon + title, dim "Resets in …" subtitle, trailing
 * bold `pct% pace` value (themed foreground), and a full-width native accent bar.
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @returns {St.BoxLayout}
 */
function buildWindowRow(row) {
    const r = cardRow();
    const pctText = row.paceGlyph ? `${row.pct}% ${row.paceGlyph}` : `${row.pct}%`;
    r.add_child(rowHeader(row.icon, row.title, {
        subtitle: `Resets in ${row.reset}`,
        trailing: pctText,
    }));
    r.add_child(makeBar(row.pct));
    return r;
}

/**
 * Build a `gauge` boxed row: icon + title, optional dim subtitle, trailing bold
 * value (themed foreground), and a native accent bar (drawn only when `row.pct`
 * is a number).
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @returns {St.BoxLayout}
 */
function buildGaugeRow(row) {
    const r = cardRow();
    r.add_child(rowHeader(row.icon, row.title, {
        subtitle: row.subLine,
        trailing: row.value,
    }));
    if (typeof row.pct === 'number')
        r.add_child(makeBar(row.pct));
    return r;
}

/**
 * Build a standalone `text` line (lives outside the card). Color precedence is
 * explicit `row.color` hex, else `row.tone` ('dim' → dim class, else themed fg).
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @returns {St.BoxLayout}
 */
function buildTextLine(row) {
    const dim = row.tone === 'dim';
    const line = new St.BoxLayout({style_class: 'aiusagebar-row', x_expand: true});
    if (row.icon)
        line.add_child(makeIcon(row.icon, dim && !row.color));
    if (row.color)
        line.add_child(label(row.text, {color: row.color}));
    else
        line.add_child(label(row.text, dim ? {styleClass: 'aiusagebar-dim'} : null));
    return line;
}

/**
 * Build the `http-error` block: a thin rule, an icon + `HTTP <code>` status
 * line (themed foreground; the warning icon carries the error semantics), then
 * dim wrapped body lines.
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @returns {St.BoxLayout}
 */
function buildHttpError(row) {
    const block = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-section'});
    block.add_child(new St.Widget({style_class: 'aiusagebar-rule', x_expand: true}));
    const head = new St.BoxLayout({style_class: 'aiusagebar-row', x_expand: true});
    if (row.icon)
        head.add_child(makeIcon(row.icon));
    head.add_child(label(`HTTP ${row.code}`));
    block.add_child(head);
    for (const line of row.lines)
        block.add_child(label(line, {styleClass: 'aiusagebar-dim'}));
    return block;
}

/**
 * Build the dim `footer` line preceded by a thin rule.
 * @param {import('../lib/vendors/anthropic-section.js').Row} row
 * @returns {St.BoxLayout}
 */
function buildFooter(row) {
    const block = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-section'});
    block.add_child(new St.Widget({style_class: 'aiusagebar-rule', x_expand: true}));
    const line = new St.BoxLayout({style_class: 'aiusagebar-row', x_expand: true});
    if (row.icon)
        line.add_child(makeIcon(row.icon, true));
    line.add_child(label(`Updated ${row.updated}`, {styleClass: 'aiusagebar-dim'}));
    block.add_child(line);
    return block;
}

/**
 * Clear `menuSection` and repopulate it from `model` as a single non-reactive
 * boxed-list item: the accent header first, then usage windows/gauges grouped
 * into a rounded card (thin separators between rows), with text/error/footer
 * lines breaking out of the card at their model position.
 * @param {PopupMenu.PopupMenuBase} menuSection
 * @param {import('../lib/vendors/anthropic-section.js').SectionModel} model
 * @returns {void}
 */
export function renderSection(menuSection, model) {
    menuSection.removeAll();

    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const container = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style_class: 'aiusagebar-section',
    });
    item.add_child(container);
    menuSection.addMenuItem(item);

    container.add_child(label(model.title, {styleClass: 'aiusagebar-title'}));

    // Group consecutive window/gauge rows into one rounded card with thin
    // separators; any other row kind breaks the card and renders inline.
    let card = null;
    const pushCardRow = rowWidget => {
        if (!card) {
            card = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-card'});
            container.add_child(card);
        } else {
            card.add_child(new St.Widget({style_class: 'aiusagebar-card-sep', x_expand: true}));
        }
        card.add_child(rowWidget);
    };

    for (const row of model.rows) {
        switch (row.kind) {
        case 'window':
            pushCardRow(buildWindowRow(row));
            break;
        case 'gauge':
            pushCardRow(buildGaugeRow(row));
            break;
        case 'text':
            card = null;
            container.add_child(buildTextLine(row));
            break;
        case 'http-error':
            card = null;
            container.add_child(buildHttpError(row));
            break;
        case 'footer':
            card = null;
            container.add_child(buildFooter(row));
            break;
        }
    }
}
