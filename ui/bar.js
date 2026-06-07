import Clutter from 'gi://Clutter';
import St from 'gi://St';

function clamp(n, lo, hi) {
    return n < lo ? lo : (n > hi ? hi : n);
}

export function makeBar(pct, color = null) {
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

    const apply = () => {
        fill.set_position(0, 0);
        fill.set_size(Math.round(fraction * bar.width), bar.height);
    };
    bar.connect('notify::width', apply);
    bar.connect('notify::height', apply);
    apply();

    return bar;
}
