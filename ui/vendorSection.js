import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {makeBar} from './bar.js';

function label(text, opts = null) {
    const props = {text, y_align: Clutter.ActorAlign.CENTER};
    if (opts?.styleClass)
        props.style_class = opts.styleClass;
    const l = new St.Label(props);
    if (opts?.wrap) {
        l.x_expand = true;
        l.clutter_text.line_wrap = true;
        l.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        l.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    }
    let css = '';
    if (opts?.color)
        css += `color: ${opts.color};`;
    if (opts?.bold)
        css += 'font-weight: bold;';
    if (css)
        l.set_style(css);
    return l;
}

function makeIcon(name, dim = false) {
    return new St.Icon({
        icon_name: name,
        style_class: dim ? 'popup-menu-icon aiusagebar-dim' : 'popup-menu-icon',
        y_align: Clutter.ActorAlign.CENTER,
    });
}

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
    if (opts.footnote)
        col.add_child(label(opts.footnote, {styleClass: 'aiusagebar-dim aiusagebar-row-subtitle'}));
    head.add_child(col);

    if (opts.trailing)
        head.add_child(label(opts.trailing, {bold: true, color: opts.trailingColor}));

    return head;
}

function cardRow() {
    return new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-card-row'});
}

function buildWindowRow(row, showPace) {
    const r = cardRow();
    const pctText = row.paceGlyph ? `${row.pct}% ${row.paceGlyph}` : `${row.pct}%`;
    r.add_child(rowHeader(row.icon, row.title, {
        subtitle: row.subtitle,
        footnote: row.paceFootnote,
        trailing: pctText,
        trailingColor: row.color,
    }));
    const marker = showPace ? row.elapsedPct ?? null : null;
    const overColor = marker !== null ? row.paceColor ?? null : null;
    r.add_child(makeBar(row.pct, row.color, marker, overColor));
    return r;
}

function buildGaugeRow(row) {
    const r = cardRow();
    r.add_child(rowHeader(row.icon, row.title, {
        subtitle: row.subLine,
        trailing: row.value,
        trailingColor: row.color,
    }));
    if (typeof row.pct === 'number')
        r.add_child(makeBar(row.pct, row.color));
    return r;
}

// Wraps rather than widening the popup: text rows carry free-form strings
// (reset titles, user formats) that the popup's max-width must hold.
function buildTextLine(row) {
    const dim = row.tone === 'dim';
    const line = new St.BoxLayout({style_class: 'aiusagebar-row', x_expand: true});
    if (row.icon)
        line.add_child(makeIcon(row.icon, dim && !row.color));
    let text;
    if (row.color)
        text = label(row.text, {color: row.color, wrap: true});
    else
        text = label(row.text, {styleClass: dim ? 'aiusagebar-dim' : null, wrap: true});
    if (!row.subtitle) {
        line.add_child(text);
        return line;
    }
    const col = new St.BoxLayout({vertical: true, x_expand: true});
    col.add_child(text);
    col.add_child(label(row.subtitle, {styleClass: 'aiusagebar-dim aiusagebar-row-subtitle', wrap: true}));
    line.add_child(col);
    return line;
}

function buildGroupedRow(row) {
    const r = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-grouped-row'});
    const head = new St.BoxLayout({style_class: 'aiusagebar-row', x_expand: true});
    const name = label(row.label, {styleClass: 'aiusagebar-dim'});
    name.x_expand = true;
    head.add_child(name);
    head.add_child(label(row.valueText));
    r.add_child(head);

    const bar = makeBar(row.pct, row.color);
    bar.add_style_class_name('aiusagebar-grouped-bar');
    bar.set_style(`background-color: ${row.trackColor};`);
    r.add_child(bar);

    if (row.detail)
        r.add_child(label(row.detail, {styleClass: 'aiusagebar-dim aiusagebar-grouped-detail'}));
    return r;
}

function buildHttpError(row) {
    const block = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-section'});
    block.add_child(new St.Widget({style_class: 'aiusagebar-rule', x_expand: true}));
    const head = new St.BoxLayout({style_class: 'aiusagebar-row', x_expand: true});
    if (row.icon)
        head.add_child(makeIcon(row.icon));
    head.add_child(label(row.status));
    block.add_child(head);
    for (const line of row.lines)
        block.add_child(label(line, {styleClass: 'aiusagebar-dim'}));
    return block;
}

function buildFooter(row) {
    const block = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-section'});
    block.add_child(new St.Widget({style_class: 'aiusagebar-rule', x_expand: true}));
    const line = new St.BoxLayout({style_class: 'aiusagebar-row', x_expand: true});
    if (row.icon)
        line.add_child(makeIcon(row.icon, true));
    line.add_child(label(row.text, {styleClass: 'aiusagebar-dim'}));
    block.add_child(line);
    return block;
}

// A one-line section (loading, no data, an error): `opts` takes a `color`,
// `dim`, an `iconName` and a `title` shown above the line.
export function renderMessage(menuSection, text, opts = {}) {
    menuSection.removeAll();
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const box = new St.BoxLayout({style_class: 'aiusagebar-row'});
    if (opts.iconName)
        box.add_child(makeIcon(opts.iconName, opts.dim));
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
    menuSection.addMenuItem(item);
}

export function renderSection(menuSection, model, showPace = false) {
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
            pushCardRow(buildWindowRow(row, showPace));
            break;
        case 'gauge':
            pushCardRow(buildGaugeRow(row));
            break;
        case 'text':
            card = null;
            container.add_child(buildTextLine(row));
            break;
        case 'spacer':
            card = null;
            container.add_child(new St.Widget({style_class: 'aiusagebar-spacer', x_expand: true}));
            break;
        case 'group-heading':
            card = null;
            container.add_child(label(row.label, {styleClass: 'aiusagebar-group-heading'}));
            break;
        case 'grouped':
            card = null;
            container.add_child(buildGroupedRow(row));
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
