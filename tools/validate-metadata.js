import GLib from 'gi://GLib';
import system from 'system';

const REQUIRED = ['uuid', 'name', 'description', 'url', 'shell-version', 'settings-schema'];

const PATH = 'metadata.json';

const [ok, bytes] = GLib.file_get_contents(PATH);
if (!ok) {
    printerr(`validate: cannot read ${PATH}`);
    system.exit(1);
}

let meta;
try {
    meta = JSON.parse(new TextDecoder().decode(bytes));
} catch (e) {
    printerr(`validate: ${PATH} is not valid JSON: ${e}`);
    system.exit(1);
}

const missing = REQUIRED.filter(k => !Object.hasOwn(meta, k));
if (missing.length) {
    printerr(`validate: ${PATH} missing required keys: ${missing.join(', ')}`);
    system.exit(1);
}

if (!Array.isArray(meta['shell-version']) || meta['shell-version'].length === 0) {
    printerr('validate: shell-version must be a non-empty array');
    system.exit(1);
}

print('validate: metadata.json OK');
