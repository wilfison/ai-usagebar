import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {request as defaultRequest} from '../http.js';
import {atomicWrite} from '../cache.js';
import {parseErrorBody} from './anthropic.js';
import {jwtExpSecs, chatgptPlanType} from './jwt.js';

export const TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const SCOPE = 'openid profile email';
export const REFRESH_BUFFER_SECS = 300;

export function defaultAuthPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), '.codex', 'auth.json']);
}

export function readAuth(path) {
    const file = Gio.File.new_for_path(path);
    let contents;
    try {
        [, contents] = file.load_contents(null);
    } catch (e) {
        throw new Error(`could not read ${path}: ${e?.message ?? e}. Run \`codex login\` to re-authenticate.`);
    }

    let raw;
    try {
        raw = JSON.parse(new TextDecoder().decode(contents));
    } catch (e) {
        throw new Error(`could not parse ${path}: ${e?.message ?? e}. Run \`codex login\` to re-authenticate.`);
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error(`could not parse ${path}: top-level value is not an object. Run \`codex login\` to re-authenticate.`);

    const t = raw.tokens;
    if (t === null || typeof t !== 'object' || Array.isArray(t))
        throw new Error(`could not parse ${path}: missing tokens object. Run \`codex login\` to re-authenticate.`);

    return {
        tokens: {
            accessToken: typeof t.access_token === 'string' ? t.access_token : '',
            refreshToken: typeof t.refresh_token === 'string' ? t.refresh_token : '',
            idToken: typeof t.id_token === 'string' ? t.id_token : '',
            accountId: typeof t.account_id === 'string' ? t.account_id : null,
            expiresAt: typeof t.expires_at === 'string' ? t.expires_at : null,
        },
        raw,
    };
}

export function expiresAtSecs(tokens) {
    if (tokens.expiresAt) {
        const ms = Date.parse(tokens.expiresAt);
        if (!Number.isNaN(ms))
            return Math.trunc(ms / 1000);
    }
    return jwtExpSecs(tokens.idToken) ?? 0;
}

export function planType(tokens) {
    return chatgptPlanType(tokens.idToken);
}

export function needsRefresh(expiresAtSecsValue, nowSecs) {
    return expiresAtSecsValue < nowSecs + REFRESH_BUFFER_SECS;
}

function decodeExpiresIn(v) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        return null;
    return Math.trunc(v);
}

export async function refresh(http, refreshToken, opts = {}) {
    const fn = http ?? defaultRequest;
    const endpoint = opts.endpoint ?? TOKEN_URL;
    const timeoutMs = opts.timeoutMs ?? 25_000;

    const body = JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: SCOPE,
    });

    let res;
    try {
        res = await fn({
            method: 'POST',
            url: endpoint,
            headers: {'Content-Type': 'application/json'},
            body,
            timeoutMs,
            cancellable: opts.cancellable,
        });
    } catch (e) {
        return {ok: false, kind: 'transport', message: e?.message ?? String(e)};
    }

    if (res.error)
        return {ok: false, kind: 'transport', message: res.error.message};

    const text = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    const status = res.status;

    if (status < 200 || status >= 300) {
        const parsed = parseErrorBody(text);
        return {ok: false, kind: 'http', status, body: parsed ?? 'Refresh failed'};
    }

    let payload;
    try {
        payload = JSON.parse(text);
    } catch (e) {
        return {ok: false, kind: 'schema', message: `openai token response: ${e?.message ?? e}`};
    }
    if (payload === null || typeof payload !== 'object')
        return {ok: false, kind: 'schema', message: 'openai token response: not a JSON object'};

    const accessToken = payload.access_token;
    if (typeof accessToken !== 'string')
        return {ok: false, kind: 'schema', message: 'openai token response: missing access_token'};

    return {
        ok: true,
        accessToken,
        refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
        idToken: typeof payload.id_token === 'string' ? payload.id_token : null,
        expiresIn: decodeExpiresIn(payload.expires_in),
    };
}

export function writeBack(path, auth) {
    const file = Gio.File.new_for_path(path);

    let merged;
    try {
        const raw = auth.raw && typeof auth.raw === 'object' ? auth.raw : {};
        const existingTokens = raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : {};
        const tokens = Object.assign({}, existingTokens, {
            access_token: auth.tokens.accessToken,
            refresh_token: auth.tokens.refreshToken,
            id_token: auth.tokens.idToken,
        });
        if (auth.tokens.accountId !== null && auth.tokens.accountId !== undefined)
            tokens.account_id = auth.tokens.accountId;
        if (auth.tokens.expiresAt !== null && auth.tokens.expiresAt !== undefined)
            tokens.expires_at = auth.tokens.expiresAt;

        merged = Object.assign({}, raw);
        merged.tokens = tokens;
    } catch (e) {
        return {ok: false, kind: 'io', message: `merge failed: ${e?.message ?? e}`};
    }

    const bytes = new TextEncoder().encode(JSON.stringify(merged, null, 2));
    try {
        atomicWrite(file, bytes);
    } catch (e) {
        return {ok: false, kind: 'io', message: e?.message ?? String(e)};
    }
    return {ok: true};
}
