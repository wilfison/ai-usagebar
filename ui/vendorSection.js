import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {makeBar} from './bar.js';
import {iconButton} from './tooltip.js';

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
    if (opts?.color)
        l.set_style(`color: ${opts.color};`);
    return l;
}

function makeIcon(name, dim = false) {
    return new St.Icon({
        icon_name: name,
        style_class: dim ? 'popup-menu-icon aiusagebar-dim' : 'popup-menu-icon',
        y_align: Clutter.ActorAlign.CENTER,
    });
}

function row() {
    return new St.BoxLayout({style_class: 'aiusagebar-row', x_expand: true});
}

function metric() {
    return new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-metric'});
}

// The title on the left and, when there is one, a short value on the right.
function metricHead(title, trailing, trailingOpts) {
    const head = row();
    const name = label(title, {styleClass: 'aiusagebar-metric-title'});
    name.x_expand = true;
    head.add_child(name);
    if (trailing)
        head.add_child(label(trailing, trailingOpts));
    return head;
}

function buildWindowRow(model, showPace, textColor) {
    const m = metric();
    m.add_child(metricHead(model.title, model.paceAlert, {
        styleClass: 'aiusagebar-pace-alert',
        color: textColor(model.paceColor ?? model.color),
    }));

    const marker = showPace ? model.elapsedPct ?? null : null;
    const overColor = marker !== null ? model.paceColor ?? null : null;
    m.add_child(makeBar(model.pct, model.color, marker, overColor));

    const detail = row();
    detail.add_child(label(model.usedText, {styleClass: 'aiusagebar-metric-value', color: textColor(model.color)}));
    if (model.subtitle) {
        // Ellipsized rather than widening the popup: a custom metric's
        // footnote travels in the subtitle.
        const reset = label(model.subtitle, {styleClass: 'aiusagebar-dim aiusagebar-metric-detail'});
        reset.x_expand = true;
        reset.x_align = Clutter.ActorAlign.END;
        detail.add_child(reset);
    }
    m.add_child(detail);

    if (model.paceFootnote)
        m.add_child(label(model.paceFootnote, {styleClass: 'aiusagebar-dim aiusagebar-metric-detail'}));
    return m;
}

function buildGaugeRow(model, textColor) {
    const m = metric();
    m.add_child(metricHead(model.title, model.value, {
        styleClass: 'aiusagebar-metric-value',
        color: textColor(model.color),
    }));
    if (typeof model.pct === 'number')
        m.add_child(makeBar(model.pct, model.color));
    if (model.subLine)
        m.add_child(label(model.subLine, {styleClass: 'aiusagebar-dim aiusagebar-metric-detail', wrap: true}));
    return m;
}

// Wraps rather than widening the popup: text rows carry free-form strings
// (reset titles, user formats) that the popup's max-width must hold.
function buildTextLine(model, textColor) {
    const dim = model.tone === 'dim';
    const line = row();
    if (model.icon)
        line.add_child(makeIcon(model.icon, dim && !model.color));
    let text;
    if (model.color)
        text = label(model.text, {color: textColor(model.color), wrap: true});
    else
        text = label(model.text, {styleClass: dim ? 'aiusagebar-dim' : null, wrap: true});
    if (!model.subtitle) {
        line.add_child(text);
        return line;
    }
    const col = new St.BoxLayout({vertical: true, x_expand: true});
    col.add_child(text);
    col.add_child(label(model.subtitle, {styleClass: 'aiusagebar-dim aiusagebar-metric-detail', wrap: true}));
    line.add_child(col);
    return line;
}

function buildGroupedRow(model) {
    const r = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-grouped-row'});
    const head = row();
    const name = label(model.label, {styleClass: 'aiusagebar-dim'});
    name.x_expand = true;
    head.add_child(name);
    head.add_child(label(model.valueText));
    r.add_child(head);

    const bar = makeBar(model.pct, model.color);
    bar.add_style_class_name('aiusagebar-grouped-bar');
    bar.set_style(`background-color: ${model.trackColor};`);
    r.add_child(bar);

    if (model.detail)
        r.add_child(label(model.detail, {styleClass: 'aiusagebar-dim aiusagebar-grouped-detail', wrap: true}));
    return r;
}

function buildHttpError(model) {
    const block = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-metric'});
    const head = row();
    if (model.icon)
        head.add_child(makeIcon(model.icon));
    head.add_child(label(model.status, {wrap: true}));
    block.add_child(head);
    for (const line of model.lines)
        block.add_child(label(line, {styleClass: 'aiusagebar-dim'}));
    return block;
}

// One provider in the popup: an expandable header (logo, name, plan, refresh)
// over a rounded body repainted on every render. It owns no prose: every
// string comes from the caller or the section model.
export class VendorCard {
    // `refreshLabel` names the header button; `onRefresh` runs on its click.
    constructor({gicon, name, tooltip, refreshLabel, onRefresh}) {
        this._name = name;
        this._updated = '';

        this.item = new PopupMenu.PopupSubMenuMenuItem(name, true);
        this.item.icon.gicon = gicon;
        this.item.label.add_style_class_name('aiusagebar-vendor-name');

        this._plan = label('', {styleClass: 'aiusagebar-dim aiusagebar-vendor-plan'});
        this.item.insert_child_above(this._plan, this.item.label);
        this._refresh = iconButton(tooltip, {
            iconName: 'view-refresh-symbolic',
            label: refreshLabel,
            onClick: onRefresh,
            tooltipText: () => (this._updated ? `${refreshLabel}\n${this._updated}` : refreshLabel),
        });
        // Last but one: the expander arrow stays at the end of the header.
        this.item.insert_child_at_index(this._refresh, this.item.get_n_children() - 1);

        this._body = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-card'});
        const holder = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        holder.add_child(this._body);
        this.item.menu.addMenuItem(holder);
    }

    // A status page incident colours the name and marks it; null clears both.
    setIncident(incident, color) {
        this.item.label.text = incident ? `${this._name} ▲` : this._name;
        this.item.label.set_style(incident && color ? `color: ${color};` : null);
    }

    // The header button is held while this vendor's fetch is in flight.
    setBusy(busy) {
        this._refresh.reactive = !busy;
        this._refresh.can_focus = !busy;
        if (busy)
            this._refresh.add_style_class_name('aiusagebar-dim');
        else
            this._refresh.remove_style_class_name('aiusagebar-dim');
    }

    // A plan that only repeats the vendor name is left out.
    setPlan(plan) {
        const text = plan ?? '';
        this._plan.text = text.toLowerCase() === this._name.toLowerCase() ? '' : text;
    }

    // A one-line body (loading, no data, an error): `opts` takes a `color`,
    // `dim` and an `iconName`.
    setMessage(text, opts = {}) {
        this._body.destroy_all_children();
        const line = row();
        if (opts.iconName)
            line.add_child(makeIcon(opts.iconName, opts.dim));
        line.add_child(label(text, {
            color: opts.color,
            styleClass: !opts.color && opts.dim ? 'aiusagebar-dim' : null,
            wrap: true,
        }));
        this._body.add_child(line);
    }

    // `textColor` maps a palette colour to one legible as text on the popup.
    setModel(model, {showPace = false, textColor = c => c} = {}) {
        this._body.destroy_all_children();
        this.setPlan(model.title);
        this._updated = '';

        // A heading and the loose lines under it read as one block, set
        // tighter than the metrics around it.
        let block = null;
        const add = (widget, inBlock = false) => {
            if (!inBlock) {
                block = null;
                this._body.add_child(widget);
                return;
            }
            if (!block) {
                block = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'aiusagebar-block'});
                this._body.add_child(block);
            }
            block.add_child(widget);
        };

        let failed = false;
        for (const r of model.rows) {
            switch (r.kind) {
            case 'window':
                add(buildWindowRow(r, showPace, textColor));
                break;
            case 'gauge':
                add(buildGaugeRow(r, textColor));
                break;
            case 'text':
                add(buildTextLine(r, textColor), true);
                break;
            case 'spacer':
                block = null;
                break;
            case 'group-heading':
                block = null;
                add(label(r.label, {styleClass: 'aiusagebar-dim aiusagebar-group-heading'}), true);
                break;
            case 'grouped':
                add(buildGroupedRow(r), true);
                break;
            case 'http-error':
                failed = true;
                add(buildHttpError(r));
                break;
            case 'footer':
                this._updated = r.text;
                // After a failed refresh this card is older than the popup footer says.
                if (failed)
                    add(label(r.text, {styleClass: 'aiusagebar-dim aiusagebar-metric-detail'}));
                break;
            }
        }
    }
}
