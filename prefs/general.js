import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {vformat} from '../lib/format.js';
import {defaultTheme} from '../lib/theme.js';
import {prefsNav} from '../lib/prefs-nav.js';
import {VENDOR_LABELS} from '../lib/vendors.js';
import {schemaRange, schemaChoices} from '../lib/prefs-pages.js';
import {withPinned} from '../lib/config-resolve.js';
import {providerName} from '../lib/vendors/custom/mapping.js';
import {
    switchRow, entryRow, boundSpinRow, comboRow, colorRow, shortcutRow, onSetting,
} from './widgets.js';


// User-facing strings are wrapped in `_()` inside the builders, never at
// module top level: the gettext domain is not yet bound when this module is
// first evaluated.

export function buildPanelPage(settings, cleanups) {
    const page = new Adw.PreferencesPage();
    // The combo follows the schema's choice order.
    const boxes = schemaChoices(settings.settings_schema, 'panel-box');

    const positionGroup = new Adw.PreferencesGroup({
        title: _('Panel position'),
        description: _('Changes apply immediately.'),
    });
    positionGroup.add(comboRow(settings, 'panel-box', {
        title: _('Area'),
        labels: [_('Left'), _('Center (beside the clock)'), _('Right (beside the system menu)')],
        read: () => boxes.indexOf(settings.get_string('panel-box')),
        write: i => settings.set_string('panel-box', boxes[i]),
    }, cleanups));
    positionGroup.add(boundSpinRow(settings, 'panel-index', {
        title: _('Position within the area'),
        subtitle: _('0 is leftmost; in the center, 0 is left of the clock and 1 right of it'),
        step: 1,
        page: 1,
    }));
    page.add(positionGroup);

    const labelGroup = new Adw.PreferencesGroup({
        title: _('Panel label'),
        // Translators: the {token} names are literal placeholders the user
        // types: keep them verbatim, only translate the surrounding prose.
        description: _('Placeholders: {vendor_short} {session_pct}% {session_reset} {plan} {weekly_pct} {weekly_reset}'),
    });
    labelGroup.add(entryRow(settings, 'bar-format', _('Bar format')));
    labelGroup.add(switchRow(settings, 'show-pace-arrows', _('Pace arrows'),
        _('Ends the label with the session pace: ↑ ahead of pace, → on track, ↓ under. Skipped when the format already has a pace placeholder.')));
    page.add(labelGroup);

    page.add(buildPinnedGroup(settings, cleanups));
    return page;
}

function buildPinnedGroup(settings, cleanups) {
    const group = new Adw.PreferencesGroup({
        title: _('Vendors on the panel'),
        description: _('Each vendor switched on gets its own logo and label, side by side; clicking one opens the popup on it. With none on, the panel shows one vendor and scrolling cycles them. In the center area, extra vendors move the clock off center.'),
    });
    const vendors = prefsNav(_).find(section => section.id === 'vendors').items;
    const rows = vendors.map(({id, title}) => {
        const row = new Adw.SwitchRow({title, active: settings.get_strv('panel-vendors').includes(id)});
        settings.bind(`${id}-enabled`, row, 'sensitive', Gio.SettingsBindFlags.GET);
        row.connect('notify::active', () => {
            const current = settings.get_strv('panel-vendors');
            const next = withPinned(current, id, row.active);
            if (next.join(',') !== current.join(','))
                settings.set_strv('panel-vendors', next);
        });
        group.add(row);
        return {id, row};
    });
    // The custom provider is pinned under the name the panel and popup show.
    const customRow = rows.find(({id}) => id === 'custom').row;
    const syncCustomTitle = () => {
        const raw = settings.get_string('custom-name');
        customRow.title = raw.trim() === '' ? _('Custom') : providerName(raw);
    };
    syncCustomTitle();
    onSetting(settings, 'custom-name', syncCustomTitle, cleanups);
    onSetting(settings, 'panel-vendors', () => {
        const pinned = settings.get_strv('panel-vendors');
        for (const {id, row} of rows) {
            if (row.active !== pinned.includes(id))
                row.active = pinned.includes(id);
        }
    }, cleanups);
    return group;
}

export function buildPopupPage(settings, cleanups) {
    const page = new Adw.PreferencesPage();
    const popupGroup = new Adw.PreferencesGroup({
        title: _('Popup'),
        // Translators: the {token} names are literal placeholders the user
        // types: keep them verbatim, only translate the surrounding prose.
        description: _('Optional extra lines shown above the popup. Empty uses the built-in layout. Placeholders: {plan} {session_pct} {session_reset} {weekly_pct} {weekly_reset}'),
    });
    popupGroup.add(entryRow(settings, 'tooltip-format', _('Popup format')));
    popupGroup.add(switchRow(settings, 'show-pace-marker', _('Show pace marker'),
        _('A tick at how much of the window has passed. Usage past it turns orange or red when it would run out before the reset.')));
    popupGroup.add(shortcutRow(settings, 'toggle-menu', _('Shortcut to open'), cleanups));
    page.add(popupGroup);
    return page;
}

export function buildDisplayPage(settings, cleanups) {
    const page = new Adw.PreferencesPage();

    const displayGroup = new Adw.PreferencesGroup({title: _('Display')});
    // The schema enum nicks are ordered like VENDOR_IDS / VENDOR_LABELS, so the
    // combo index IS the enum value. Vendor labels are brand names, kept verbatim.
    displayGroup.add(comboRow(settings, 'primary-vendor', {
        title: _('Primary vendor'),
        subtitle: _('Shown on the panel when no vendor is pinned, opened first in the popup, and the scroll-cycle reset target'),
        labels: VENDOR_LABELS,
        read: () => settings.get_enum('primary-vendor'),
        write: i => settings.set_enum('primary-vendor', i),
    }, cleanups));
    displayGroup.add(switchRow(settings, 'show-vendor-icons', _('Show vendor logos')));
    page.add(displayGroup);

    const colorGroup = new Adw.PreferencesGroup({
        title: _('Severity colors'),
        description: _('Pick a color per severity tier. Reset returns a tier to its built-in default.'),
    });
    const theme = defaultTheme();
    // Translators: Low/Mid/High/Critical are usage-severity tier names.
    colorGroup.add(colorRow(settings, 'color-low', _('Low'), theme.green, cleanups));
    colorGroup.add(colorRow(settings, 'color-mid', _('Mid'), theme.yellow, cleanups));
    colorGroup.add(colorRow(settings, 'color-high', _('High'), theme.orange, cleanups));
    colorGroup.add(colorRow(settings, 'color-critical', _('Critical'), theme.red, cleanups));
    page.add(colorGroup);
    return page;
}

export function buildBehaviorPage(settings) {
    const page = new Adw.PreferencesPage();

    const cadenceGroup = new Adw.PreferencesGroup({
        title: _('Refresh'),
        // Translators: %d is the minimum refresh interval in seconds.
        description: vformat(_('Minimum %d s: the upstream endpoints rate-limit below that.'),
            schemaRange(settings.settings_schema, 'refresh-interval').lower),
    });
    cadenceGroup.add(boundSpinRow(settings, 'refresh-interval', {
        title: _('Refresh interval (seconds)'),
        step: 60,
        page: 300,
    }));
    page.add(cadenceGroup);

    const notifyGroup = new Adw.PreferencesGroup({
        title: _('Notifications'),
        description: _('Show a desktop notification the first time a usage window reaches the threshold. It re-arms when usage drops 7 points below it or the window resets, and warns 48 hours before a reset credit expires.'),
    });
    notifyGroup.add(switchRow(settings, 'notify-enabled', _('Notify on high usage')));
    notifyGroup.add(boundSpinRow(settings, 'notify-threshold', {
        title: _('Notification threshold (%)'),
        step: 5,
        page: 10,
    }));
    page.add(notifyGroup);

    const updateGroup = new Adw.PreferencesGroup({title: _('Updates')});
    updateGroup.add(switchRow(settings, 'update-check-enabled', _('Check for updates'),
        _('Once a day, ask GitHub whether a newer release exists')));
    page.add(updateGroup);

    const statusGroup = new Adw.PreferencesGroup({title: _('Service status')});
    statusGroup.add(switchRow(settings, 'provider-status', _('Show provider status'),
        _('Mark Claude and Codex when their official status page reports a problem')));
    page.add(statusGroup);

    const resetGroup = new Adw.PreferencesGroup({
        title: _('Reset'),
        description: _('Restore every setting (vendor toggles, paths, keys, formats, and colors) to its built-in default.'),
    });
    const resetRow = new Adw.ButtonRow({title: _('Reset all settings')});
    resetRow.add_css_class('destructive-action');
    resetRow.connect('activated', () => confirmResetAll(settings, resetRow.get_root()));
    resetGroup.add(resetRow);
    page.add(resetGroup);
    return page;
}

function confirmResetAll(settings, parent) {
    const dialog = new Adw.AlertDialog({
        heading: _('Reset all settings?'),
        body: _('This restores every setting to its built-in default and cannot be undone.'),
    });
    dialog.add_response('cancel', _('Cancel'));
    dialog.add_response('reset', _('Reset'));
    dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_default_response('cancel');
    dialog.set_close_response('cancel');
    dialog.connect('response', (_d, response) => {
        if (response === 'reset') {
            for (const key of settings.settings_schema.list_keys())
                settings.reset(key);
        }
    });
    dialog.present(parent);
}
