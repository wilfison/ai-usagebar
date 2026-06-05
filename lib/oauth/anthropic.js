import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function defaultCredsPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
}

function isNotFound(e) {
    return e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) === true;
}

function toMsEpoch(v) {
    // Accept integer or float; floats truncate toward zero.
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new Error('expiresAt must be a number');
    return Math.trunc(v);
}

function normalize(raw) {
    const block = raw?.claudeAiOauth;
    if (block === null || typeof block !== 'object' || Array.isArray(block))
        throw new Error('claudeAiOauth missing or not an object');

    const accessToken = block.accessToken;
    const refreshToken = block.refreshToken;
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string')
        throw new Error('accessToken/refreshToken must be strings');

    return {
        accessToken,
        refreshToken,
        expiresAtMs: toMsEpoch(block.expiresAt),
        subscriptionType: typeof block.subscriptionType === 'string' ? block.subscriptionType : '',
        rateLimitTier: typeof block.rateLimitTier === 'string' ? block.rateLimitTier : '',
        scopes: block.scopes ?? null,
    };
}

export function readCreds(path) {
    const file = Gio.File.new_for_path(path);
    let contents;
    try {
        [, contents] = file.load_contents(null);
    } catch (e) {
        if (isNotFound(e)) {
            const err = new Error(`credentials file not found at ${path}. Run \`claude\` to re-authenticate.`);
            err.code = 'ENOENT';
            throw err;
        }
        throw e;
    }

    const text = new TextDecoder().decode(contents);
    let raw;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        throw new Error(`could not parse ${path}: ${e?.message ?? e}. Run \`claude\` to re-authenticate.`);
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error(`could not parse ${path}: top-level value is not an object. Run \`claude\` to re-authenticate.`);

    let oauth;
    try {
        oauth = normalize(raw);
    } catch (e) {
        throw new Error(`could not parse ${path}: ${e?.message ?? e}. Run \`claude\` to re-authenticate.`);
    }

    return {oauth, raw};
}

function capitalizeFirst(s) {
    if (!s)
        return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export function planLabel(oauth) {
    let name = capitalizeFirst(oauth?.subscriptionType ?? '');
    if (name === '')
        name = 'Unknown';
    const tier = oauth?.rateLimitTier ?? '';
    if (tier.includes('5x'))
        name += ' 5x';
    else if (tier.includes('20x'))
        name += ' 20x';
    return name;
}
