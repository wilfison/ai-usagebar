import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {makeBar} from './bar.js';

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
