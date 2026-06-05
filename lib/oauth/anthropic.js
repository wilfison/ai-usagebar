import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {request as defaultRequest} from '../http.js';

export const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
export const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const BETA_HEADER = 'oauth-2025-04-20';
export const USER_AGENT = 'claude-cli/1.0';
export const REFRESH_BUFFER_SECS = 300;

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

export function needsRefresh(expiresAtSecs, nowSecs) {
    return expiresAtSecs < nowSecs + REFRESH_BUFFER_SECS;
}

// Tolerates three response shapes: {error_description}, {error: {message}},
// {error: 'msg'}. Returns null on unrecognized shape or invalid JSON.
export function parseErrorBody(text) {
    let v;
    try {
        v = JSON.parse(text);
    } catch (_) {
        return null;
    }
    if (v === null || typeof v !== 'object')
        return null;
    if (typeof v.error_description === 'string')
        return v.error_description;
    if (v.error !== null && typeof v.error === 'object' && typeof v.error.message === 'string')
        return v.error.message;
    if (typeof v.error === 'string')
        return v.error;
    return null;
}

function decodeExpiresIn(v) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        return null;
    return Math.trunc(v);
}

// POST a refresh request and translate the outcome into a discriminated
// result — never throws. The state machine in lib/vendors decides whether to
// silently fall back to cache based on `kind`.
export async function refresh(http, refreshToken, opts = {}) {
    const fn = http ?? defaultRequest;
    const endpoint = opts.endpoint ?? TOKEN_URL;
    const timeoutMs = opts.timeoutMs ?? 25_000;

    const body = JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
    });

    let res;
    try {
        res = await fn({
            method: 'POST',
            url: endpoint,
            headers: {
                'Content-Type': 'application/json',
                'anthropic-beta': BETA_HEADER,
                'User-Agent': USER_AGENT,
            },
            body,
            timeoutMs,
        });
    } catch (e) {
        return {ok: false, kind: 'transport', message: e?.message ?? String(e)};
    }

    if (res.error) {
        // Collapse timeout into transport — callers treat both as silent-fallback.
        return {ok: false, kind: 'transport', message: res.error.message};
    }

    const text = new TextDecoder().decode(res.bodyBytes ?? new Uint8Array(0));
    const status = res.status;

    if (status < 200 || status >= 300) {
        const parsed = parseErrorBody(text);
        const fallback = status < 500 ? 'Refresh failed' : 'Invalid refresh response';
        return {ok: false, kind: 'http', status, body: parsed ?? fallback};
    }

    let payload;
    try {
        payload = JSON.parse(text);
    } catch (e) {
        return {ok: false, kind: 'schema', message: `token refresh response: ${e?.message ?? e}`};
    }
    if (payload === null || typeof payload !== 'object')
        return {ok: false, kind: 'schema', message: 'token refresh response: not a JSON object'};

    const accessToken = payload.access_token;
    if (typeof accessToken !== 'string')
        return {ok: false, kind: 'schema', message: 'token refresh response: missing access_token'};

    const expiresIn = decodeExpiresIn(payload.expires_in);
    if (expiresIn === null)
        return {ok: false, kind: 'schema', message: 'token refresh response: missing or non-numeric expires_in'};

    const newRefresh = typeof payload.refresh_token === 'string' ? payload.refresh_token : null;

    return {ok: true, accessToken, refreshToken: newRefresh, expiresIn};
}
