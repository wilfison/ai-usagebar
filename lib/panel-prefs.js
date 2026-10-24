export function bindPanelVendor(settings, id, toggle, cleanups) {
    const sync = () => {
        toggle.active = settings.get_strv('panel-vendors').includes(id);
    };
    const toggleId = toggle.connect('notify::active', () => {
        const ids = settings.get_strv('panel-vendors');
        if (toggle.active === ids.includes(id))
            return;
        if (toggle.active) {
            if (!settings.get_boolean(`${id}-enabled`))
                settings.set_boolean(`${id}-enabled`, true);
            settings.set_strv('panel-vendors', [...ids, id]);
        } else {
            settings.set_strv('panel-vendors', ids.filter(selected => selected !== id));
        }
    });
    const settingId = settings.connect('changed::panel-vendors', sync);
    cleanups.push(() => {
        toggle.disconnect(toggleId);
        settings.disconnect(settingId);
    });
    sync();
}

export function bindPanelLabelVisibility(settings, id, row, cleanups) {
    const sync = () => {
        row.visible = settings.get_strv('panel-vendors').includes(id);
    };
    const signalId = settings.connect('changed::panel-vendors', sync);
    cleanups.push(() => settings.disconnect(signalId));
    sync();
}
