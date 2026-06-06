/**
 * @file Codex OAuth helpers — read/refresh/write-back of `~/.codex/auth.json`,
 * the OAuth state the OpenAI Codex CLI maintains. Reads the access/refresh/id
 * tokens, infers expiry from the `id_token` `exp` claim when no explicit
 * `expires_at` is present, refreshes against `auth.openai.com`, and writes the
 * file back atomically preserving every unknown field (so we never clobber state
 * the Codex CLI relies on).
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {request as defaultRequest} from '../http.js';
import {atomicWrite} from '../cache.js';
import {parseErrorBody} from './anthropic.js';
import {jwtExpSecs, chatgptPlanType} from './jwt.js';

/** @type {string} OAuth refresh endpoint. */
export const TOKEN_URL = 'https://auth.openai.com/oauth/token';
/** @type {string} Public client_id of the Codex CLI's OAuth client. */
export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
/** @type {string} Refresh scope the endpoint requires. */
export const SCOPE = 'openid profile email';
/** @type {number} Refresh this many seconds before the token actually expires. */
export const REFRESH_BUFFER_SECS = 300;

/**
 * Default auth path: `~/.codex/auth.json`.
 * @returns {string}
 */
export function defaultAuthPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), '.codex', 'auth.json']);
}

/**
 * @typedef {object} CodexTokens
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {string} idToken
 * @property {?string} accountId - `ChatGPT-Account-Id` header value when present.
 * @property {?string} expiresAt - explicit expiry from the OAuth server, if any.
 */

/**
 * Read and normalize the Codex auth file.
 * @param {string} path - absolute path to `auth.json`.
 * @returns {{tokens: CodexTokens, raw: object}} normalized tokens plus the raw
 *   document so write-back can preserve unknown keys.
 * @throws {Error} when the file is missing/unparseable or lacks a `tokens`
 *   object; the message ends with "Run `codex login` to re-authenticate."
 */
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

/**
 * Compute the token's Unix-seconds expiry: explicit `expires_at` (parsed as an
 * RFC-3339 instant) if present, else the `id_token`'s `exp` claim, else `0`
 * (forcing an immediate refresh).
 * @param {CodexTokens} tokens
 * @returns {number}
 */
export function expiresAtSecs(tokens) {
    if (tokens.expiresAt) {
        const ms = Date.parse(tokens.expiresAt);
        if (!Number.isNaN(ms))
            return Math.trunc(ms / 1000);
    }
    return jwtExpSecs(tokens.idToken) ?? 0;
}

/**
 * Plan tier from the `id_token`'s `chatgpt_plan_type` claim, or null.
 * @param {CodexTokens} tokens
 * @returns {?string}
 */
export function planType(tokens) {
    return chatgptPlanType(tokens.idToken);
}

/**
 * True if the access token expires inside the {@link REFRESH_BUFFER_SECS} window.
 * @param {number} expiresAtSecsValue - epoch seconds when the token expires.
 * @param {number} nowSecs - epoch seconds.
 * @returns {boolean}
 */
export function needsRefresh(expiresAtSecsValue, nowSecs) {
    return expiresAtSecsValue < nowSecs + REFRESH_BUFFER_SECS;
}

/**
 * Coerce `expires_in` to a truncated-integer seconds value.
 * @param {*} v
 * @returns {?number} null when not a finite number.
 */
function decodeExpiresIn(v) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        return null;
    return Math.trunc(v);
}

/**
 * @typedef {object} RefreshOk
 * @property {true} ok
 * @property {string} accessToken
 * @property {?string} refreshToken - non-null only if the server rotated it.
 * @property {?string} idToken - non-null only if the server returned a new one.
 * @property {?number} expiresIn - seconds until expiry, or null when absent.
 */

/**
 * @typedef {{ok: false, kind: 'transport', message: string}
 *   | {ok: false, kind: 'http', status: number, body: string}
 *   | {ok: false, kind: 'schema', message: string}} RefreshErr
 */

/**
 * @typedef {RefreshOk | RefreshErr} RefreshResult
 */

/**
 * POST a refresh request and translate the outcome into a discriminated result —
 * never throws. The vendor state machine decides whether to fall back to cache
 * based on `kind`.
 * @param {?(opts: import('../http.js').RequestOpts) => Promise<import('../http.js').HttpResult>} http
 *   - HTTP function; defaults to the built-in request when null/undefined.
 * @param {string} refreshToken
 * @param {{endpoint?: string, timeoutMs?: number, cancellable?: Gio.Cancellable}} [opts]
 * @returns {Promise<RefreshResult>}
 */
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

/**
 * Atomically write the auth document back to disk, preserving every unknown
 * top-level key and every unknown `tokens.*` key (e.g. `last_refresh`). Never
 * throws — IO failures surface as the `{ok: false, kind: 'io', message}` variant.
 * @param {string} path
 * @param {{raw: object, tokens: CodexTokens}} auth - the document read by
 *   {@link readAuth}, with possibly-updated `tokens`.
 * @returns {{ok: true} | {ok: false, kind: 'io', message: string}}
 */
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
