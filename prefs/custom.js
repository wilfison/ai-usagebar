import Adw from 'gi://Adw';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {vformat} from '../lib/format.js';
import {parseExtraHeaders, validateMapping} from '../lib/vendors/custom/parser.js';
import {switchRow, entryRow, passwordRow, jsonEditor} from './widgets.js';

export function buildCustomPage(settings, cleanups) {
    const page = new Adw.PreferencesPage();

    const group = new Adw.PreferencesGroup({
        title: _('Custom provider'),
        description: _('Any HTTPS endpoint that answers a GET with JSON, mapped to usage rows by JSON Pointer. See the README for an example.'),
    });
    group.add(switchRow(settings, 'custom-enabled', _('Enabled')));
    group.add(entryRow(settings, 'custom-name', _('Name')));
    group.add(entryRow(settings, 'custom-url', _('URL')));
    group.add(switchRow(settings, 'custom-allow-http', _('Allow plain HTTP')));
    page.add(group);

    const auth = new Adw.PreferencesGroup({
        title: _('Authentication'),
        description: _('Without a key no auth header is sent. An empty scheme sends the key bare.'),
    });
    auth.add(entryRow(settings, 'custom-api-key-env', _('API key env var (optional)')));
    auth.add(passwordRow(settings, 'custom-api-key', _('API key (inline)')));
    auth.add(entryRow(settings, 'custom-auth-header', _('Auth header')));
    auth.add(entryRow(settings, 'custom-auth-scheme', _('Auth scheme')));
    page.add(auth);

    const headers = new Adw.PreferencesGroup({
        title: _('Extra headers'),
        description: _('A JSON object of header names to string values; it must not repeat the auth header.'),
    });
    headers.add(jsonEditor(settings, 'custom-extra-headers', text => {
        const authHeader = settings.get_string('custom-auth-header').trim() || 'Authorization';
        return parseExtraHeaders(text, authHeader) === null
            ? [_('Not a JSON object of string header values, or it repeats the auth header.')]
            : [];
    }, cleanups));
    page.add(headers);

    const mapping = new Adw.PreferencesGroup({
        title: _('Mapping'),
        description: _('Metrics (used + limit, or percent) and texts, each read from the response by JSON Pointer; an optional currency (e.g. "USD") shows used + limit or a text as money. Saved when the editor loses focus and the mapping is valid.'),
    });
    mapping.add(jsonEditor(settings, 'custom-mapping', text => {
        let obj;
        try {
            obj = JSON.parse(text);
        } catch (e) {
            return [vformat(_('Not valid JSON: %s'), e.message)];
        }
        return validateMapping(obj);
    }, cleanups));
    page.add(mapping);
    return page;
}
