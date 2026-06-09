import Clutter from 'gi://Clutter';
import St from 'gi://St';

function clamp(n, lo, hi) {
    return n < lo ? lo : (n > hi ? hi : n);
}

const MARKER_W = 2;

export function makeBar(pct, color = null, elapsedPct = null) {
    const fraction = clamp(pct, 0, 100) / 100;

    const bar = new St.Widget({
        style_class: 'aiusagebar-bar aiusagebar-bar-track',
        x_expand: true,
        layout_manager: new Clutter.FixedLayout(),
    });

    const fill = new St.Widget({style_class: 'aiusagebar-bar-fill'});
    if (color)
        fill.set_style(`background-color: ${color};`);
    bar.add_child(fill);

    // Optional pace marker: a thin rule at the fraction of the window that has
    // elapsed, so the fill (usage) can be read against pace at a glance. A
    // numeric 0 is a valid position (window just reset); only null/undefined
    // means "no marker".
    const markerFraction = typeof elapsedPct === 'number' ? clamp(elapsedPct, 0, 100) / 100 : null;
    let marker = null;
    if (markerFraction !== null) {
        marker = new St.Widget({style_class: 'aiusagebar-bar-marker'});
        bar.add_child(marker);
    }

    const apply = () => {
        fill.set_position(0, 0);
        fill.set_size(Math.round(fraction * bar.width), bar.height);
        if (marker) {
            marker.set_size(MARKER_W, bar.height);
            const x = Math.round(markerFraction * bar.width);
            marker.set_position(clamp(x, 0, Math.max(0, bar.width - MARKER_W)), 0);
        }
    };
    bar.connect('notify::width', apply);
    bar.connect('notify::height', apply);
    apply();

    return bar;
}
