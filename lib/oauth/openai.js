import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {request as defaultRequest} from '../http.js';
import {atomicWrite, loadBytesAsync} from '../cache.js';
import {postTokenRefresh, decodeExpiresIn} from './refresh.js';

export {needsRefresh, REFRESH_BUFFER_SECS} from './refresh.js';
import {jwtExpSecs, chatgptPlanType} from './jwt.js';

export const TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const SCOPE = 'openid profile email';

export function defaultAuthPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), '.codex', 'auth.json']);
}

export async function readAuth(path) {
    const file = Gio.File.new_for_path(path);
    let contents;
    try {
        contents = await loadBytesAsync(file);
    } catch (e) {
        throw new Error(`could not read ${path}: ${e?.message ?? e}. Run \`codex login\` to re-authenticate.`);
    }
    if (contents === null)
        throw new Error(`could not read ${path}. Run \`codex login\` to re-authenticate.`);

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

// A persisted expires_at is the newest information after a refresh, so it wins
// over the id_token's claim, which a refresh without a new id_token leaves stale.
export function expiresAtSecs(tokens) {
    if (tokens.expiresAt) {
        const ms = Date.parse(tokens.expiresAt);
        if (!Number.isNaN(ms))
            return Math.trunc(ms / 1000);
    }
    return jwtExpSecs(tokens.accessToken) ?? jwtExpSecs(tokens.idToken) ?? 0;
}

export function planType(tokens) {
    return chatgptPlanType(tokens.idToken);
}

export async function refresh(http, refreshToken, opts = {}) {
    const rr = await postTokenRefresh(http ?? defaultRequest, {
        endpoint: opts.endpoint ?? TOKEN_URL,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPE}),
        timeoutMs: opts.timeoutMs,
        cancellable: opts.cancellable,
        label: 'openai token response',
    });
    if (!rr.ok)
        return rr;
    return {
        ok: true,
        accessToken: rr.accessToken,
        refreshToken: typeof rr.payload.refresh_token === 'string' ? rr.payload.refresh_token : null,
        idToken: typeof rr.payload.id_token === 'string' ? rr.payload.id_token : null,
        expiresIn: decodeExpiresIn(rr.payload.expires_in),
    };
}

// Folds a successful refresh into `tokens`; `rotated` means a new refresh
// token exists only in memory until writeBack persists it.
export function applyRefresh(tokens, rr, nowSecs) {
    tokens.accessToken = rr.accessToken;
    if (rr.refreshToken)
        tokens.refreshToken = rr.refreshToken;
    if (rr.idToken)
        tokens.idToken = rr.idToken;
    if (rr.expiresIn !== null && rr.expiresIn !== undefined)
        tokens.expiresAt = new Date((nowSecs + rr.expiresIn) * 1000).toISOString();
    return {rotated: Boolean(rr.refreshToken)};
}

export async function writeBack(path, auth) {
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
        await atomicWrite(file, bytes);
    } catch (e) {
        return {ok: false, kind: 'io', message: e?.message ?? String(e)};
    }
    return {ok: true};
}
