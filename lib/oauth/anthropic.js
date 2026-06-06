/**
 * @file Anthropic OAuth helpers — read/refresh/write-back of
 * `~/.claude/.credentials.json`. Same wire shape as the Claude CLI so we can
 * piggy-back on its credentials and refresh tokens, and the same atomic
 * write-back semantics so we never lose sibling keys (mcpOAuth, etc.).
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {request as defaultRequest} from '../http.js';
import {atomicWrite} from '../cache.js';

/** @type {string} OAuth refresh endpoint. */
export const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
/** @type {string} Public client_id shared with the Claude CLI. */
export const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
/** @type {string} Required `anthropic-beta` header value. */
export const BETA_HEADER = 'oauth-2025-04-20';
/** @type {string} User-Agent the upstream endpoint accepts. */
export const USER_AGENT = 'claude-cli/1.0';
/** @type {number} Refresh this many seconds before the token actually expires. */
export const REFRESH_BUFFER_SECS = 300;

/**
 * Default credentials path: `~/.claude/.credentials.json`.
 * @returns {string}
 */
export function defaultCredsPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
}

/**
 * True if `e` is a Gio NOT_FOUND error.
 * @param {*} e
 * @returns {boolean}
 */
function isNotFound(e) {
    return e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) === true;
}

/**
 * Coerce a numeric epoch (int or float) to a truncated ms-epoch integer.
 * @param {*} v
 * @returns {number}
 * @throws {Error} when v is not a finite number.
 */
function toMsEpoch(v) {
    // Accept integer or float; floats truncate toward zero.
    if (typeof v !== 'number' || !Number.isFinite(v))
        throw new Error('expiresAt must be a number');
    return Math.trunc(v);
}

/**
 * @typedef {object} OAuthCreds
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {number} expiresAtMs - epoch-ms when the access token expires.
 * @property {string} subscriptionType - e.g. 'pro', 'team'; '' when unknown.
 * @property {string} rateLimitTier - free-form tier string; '' when unknown.
 * @property {?(string | string[])} scopes - preserved through write-back.
 */

/**
 * Normalize the raw credentials JSON document into an {@link OAuthCreds}.
 * @param {*} raw - parsed JSON document.
 * @returns {OAuthCreds}
 * @throws {Error} on missing or malformed fields.
 */
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

/**
 * Read and normalize the credentials file.
 * @param {string} path - absolute path to a credentials JSON.
 * @returns {{oauth: OAuthCreds, raw: object}} normalized creds plus the raw
 *   document so callers can inspect sibling keys (mcpOAuth, etc.).
 * @throws {Error} with `.code === 'ENOENT'` when the file is missing; other
 *   parse/shape failures surface as plain Errors that already include the
 *   path and "Run `claude` to re-authenticate." hint.
 */
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

/**
 * Capitalize the first letter of `s` (ASCII only — matches the Rust port).
 * @param {string} s
 * @returns {string}
 */
function capitalizeFirst(s) {
    if (!s)
        return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Human-readable plan label, e.g. "Pro 5x" or "Team 20x".
 * @param {?OAuthCreds} oauth
 * @returns {string} "Unknown" when no subscriptionType is present.
 */
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

/**
 * True if the access token expires inside the {@link REFRESH_BUFFER_SECS}
 * window (so a refresh should be attempted now).
 * @param {number} expiresAtSecs - epoch seconds when the token expires.
 * @param {number} nowSecs - epoch seconds.
 * @returns {boolean}
 */
export function needsRefresh(expiresAtSecs, nowSecs) {
    return expiresAtSecs < nowSecs + REFRESH_BUFFER_SECS;
}

/**
 * Extract a human-readable error string from a JSON refresh error body.
 *
 * Tolerates three response shapes: `{error_description}`, `{error: {message}}`,
 * `{error: 'msg'}`.
 * @param {string} text - response body text.
 * @returns {?string} extracted message, or null on unrecognized shape /
 *   invalid JSON.
 */
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
 * @property {number} expiresIn - seconds until the new access token expires.
 */

/**
 * @typedef {object} RefreshErrTransport
 * @property {false} ok
 * @property {'transport'} kind
 * @property {string} message
 */

/**
 * @typedef {object} RefreshErrHttp
 * @property {false} ok
 * @property {'http'} kind
 * @property {number} status
 * @property {string} body
 */

/**
 * @typedef {object} RefreshErrSchema
 * @property {false} ok
 * @property {'schema'} kind
 * @property {string} message
 */

/**
 * @typedef {RefreshOk | RefreshErrTransport | RefreshErrHttp | RefreshErrSchema} RefreshResult
 */

/**
 * POST a refresh request and translate the outcome into a discriminated
 * result — never throws. The state machine in `lib/vendors` decides whether
 * to silently fall back to cache based on `kind`.
 * @param {?(opts: import('../http.js').RequestOpts) => Promise<import('../http.js').HttpResult>} http
 *   - HTTP function; defaults to {@link defaultRequest} when null/undefined.
 * @param {string} refreshToken
 * @param {{endpoint?: string, timeoutMs?: number, cancellable?: Gio.Cancellable}} [opts]
 *   - `cancellable`, when supplied, is forwarded to the HTTP call so a disable
 *     aborts the in-flight refresh.
 * @returns {Promise<RefreshResult>}
 */
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
            cancellable: opts.cancellable,
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

/**
 * Best-effort read of an existing credentials document. Returns `{}` when the
 * file is missing or unparseable so write-back can still proceed.
 * @param {Gio.File} file
 * @returns {object}
 */
function readExistingDoc(file) {
    let contents;
    try {
        [, contents] = file.load_contents(null);
    } catch (_) {
        return {};
    }
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder().decode(contents));
    } catch (_) {
        return {};
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        return {};
    return parsed;
}

/**
 * Atomically replace the credentials file with a document containing the new
 * tokens and every unknown top-level key the original file had (mcpOAuth,
 * etc.). The Claude CLI writes the same file; silently losing those keys
 * would break MCP integrations. Never throws — IO failures surface as the
 * `{ok: false, kind: 'io', message}` variant.
 * @param {string} path
 * @param {OAuthCreds} newOauth
 * @returns {{ok: true} | {ok: false, kind: 'io', message: string}}
 */
export function writeBack(path, newOauth) {
    const file = Gio.File.new_for_path(path);

    let merged;
    try {
        const existing = readExistingDoc(file);
        const oauthBlock = {
            accessToken: newOauth.accessToken,
            refreshToken: newOauth.refreshToken,
            expiresAt: Math.trunc(newOauth.expiresAtMs),
            subscriptionType: newOauth.subscriptionType ?? '',
            rateLimitTier: newOauth.rateLimitTier ?? '',
        };
        if (newOauth.scopes !== null && newOauth.scopes !== undefined)
            oauthBlock.scopes = newOauth.scopes;

        merged = Object.assign({}, existing);
        merged.claudeAiOauth = oauthBlock;
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
