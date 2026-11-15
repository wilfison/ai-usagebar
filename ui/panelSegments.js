import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {panelVendors} from '../lib/config-resolve.js';
import {getAdapter} from '../lib/vendors/registry.js';
import {vendorIconName, GENERIC_ICON} from '../lib/vendors.js';
import {segmentModel, nearestSegment, Tone} from '../lib/panel-segments.js';
import {severityColor} from '../lib/severity.js';

// Panel badge for a vendor: its short code, upper-cased (e.g. "CLD", "GPT");
// a provider named by the user derives it from the configured name.
function vendorTag(id, config) {
    const adapter = getAdapter(id);
    return (adapter.shortCode ? adapter.shortCode(config) : adapter.vendorShort).toUpperCase();
}

// What the vendor badges (popup headers and panel segments) are drawn from.
export function badgeSignature(config) {
    return `${config.vendors.custom.name}|${config.showVendorIcons}`;
}

// One badge + label per panel vendor, inside the indicator's button.
export class PanelSegments {
    // `vendorGicon(id)` is the vendor's logo as a GIcon.
    constructor(vendorGicon) {
        this._vendorGicon = vendorGicon;
        this._segments = new Map();     // vendorId -> {box, label}
        this._signature = '';
        this.actor = new St.BoxLayout({style_class: 'panel-status-menu-box aiusagebar-segments'});
    }

    ids() {
        return [...this._segments.keys()];
    }

    // [id, {box, label}] pairs, for tools/headless.sh probe.
    entries() {
        return this._segments.entries();
    }

    // The segments are rebuilt only when what they are made of changes: which
    // vendors, their logos, or the custom provider's name (its short code).
    _signatureOf(config) {
        return `${panelVendors(config).join(',')}|${badgeSignature(config)}`;
    }

    maybeRebuild(config) {
        if (this._signatureOf(config) === this._signature)
            return false;
        this.rebuild(config);
        return true;
    }

    rebuild(config) {
        this.actor.destroy_all_children();
        this._segments.clear();
        for (const id of panelVendors(config)) {
            const box = new St.BoxLayout({style_class: 'aiusagebar-segment'});
            // The badge is the vendor's logo, or its short code with logos off or
            // for a vendor without a mark of its own.
            if (config.showVendorIcons && vendorIconName(id) !== GENERIC_ICON) {
                box.add_child(new St.Icon({
                    style_class: 'aiusagebar-vendor-icon',
                    gicon: this._vendorGicon(id),
                    icon_size: 16,
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            } else {
                box.add_child(new St.Label({
                    style_class: 'aiusagebar-panel-tag',
                    text: vendorTag(id, config),
                    y_align: Clutter.ActorAlign.CENTER,
                    y_expand: true,
                }));
            }
            const label = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER, y_expand: true});
            box.add_child(label);
            this.actor.add_child(box);
            this._segments.set(id, {box, label});
        }
        this._signature = this._signatureOf(config);
    }

    paint(id, result, {config, theme, now = new Date()}) {
        const segment = this._segments.get(id);
        if (!segment)
            return;
        const model = segmentModel(result, {
            adapter: getAdapter(id),
            barFormat: config.barFormat,
            paceArrows: config.showPaceArrows,
            alone: this._segments.size === 1,
            now,
        }, _, ngettext);
        const color = model.tone === Tone.SEVERITY ? severityColor(model.severity, theme) : theme.fg;
        segment.label.text = model.text;
        segment.label.set_style(`color: ${color};`);
    }

    // The vendor of the segment nearest to stage x, or null with none.
    nearest(x) {
        const spans = [...this._segments].map(([id, {box}]) => {
            const [sx] = box.get_transformed_position();
            const [width] = box.get_transformed_size();
            return {id, x: sx, width};
        });
        return nearestSegment(x, spans);
    }

    destroy() {
        this._segments.clear();
    }
}
