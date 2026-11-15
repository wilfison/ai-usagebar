import GLib from 'gi://GLib';

import {request as defaultRequest} from '../http.js';
import {readJsonCredentials, updateJsonCredentials} from './creds-file.js';
import {postTokenRefresh, decodeExpiresIn} from './refresh.js';

export {needsRefresh, parseErrorBody, REFRESH_BUFFER_SECS} from './refresh.js';

export const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
export const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const BETA_HEADER = 'oauth-2025-04-20';
export const USER_AGENT = 'claude-cli/1.0';

export function defaultCredsPath() {
    return GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
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

export async function readCreds(path) {
    const raw = await readJsonCredentials(path, 'claude');
    try {
        return {oauth: normalize(raw), raw};
    } catch (e) {
        throw new Error(`could not parse ${path}: ${e?.message ?? e}. Run \`claude\` to re-authenticate.`);
    }
}

export async function refresh(http, refreshToken, opts = {}) {
    const rr = await postTokenRefresh(http ?? defaultRequest, {
        endpoint: opts.endpoint ?? TOKEN_URL,
        headers: {
            'Content-Type': 'application/json',
            'anthropic-beta': BETA_HEADER,
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken}),
        timeoutMs: opts.timeoutMs,
        cancellable: opts.cancellable,
        label: 'token refresh response',
        httpFallback: status => (status < 500 ? 'Refresh failed' : 'Invalid refresh response'),
    });
    if (!rr.ok)
        return rr;
    const expiresIn = decodeExpiresIn(rr.payload.expires_in);
    if (expiresIn === null)
        return {ok: false, kind: 'schema', message: 'token refresh response: missing or non-numeric expires_in'};
    const newRefresh = typeof rr.payload.refresh_token === 'string' ? rr.payload.refresh_token : null;
    return {ok: true, accessToken: rr.accessToken, refreshToken: newRefresh, expiresIn};
}

// Folds a successful refresh into `oauth`; `rotated` means a new refresh
// token exists only in memory until writeBack persists it.
export function applyRefresh(oauth, rr, nowMs) {
    oauth.accessToken = rr.accessToken;
    if (rr.refreshToken)
        oauth.refreshToken = rr.refreshToken;
    oauth.expiresAtMs = nowMs + rr.expiresIn * 1000;
    return {rotated: Boolean(rr.refreshToken)};
}

export function writeBack(path, newOauth) {
    return updateJsonCredentials(path, existing => {
        const oauthBlock = {
            accessToken: newOauth.accessToken,
            refreshToken: newOauth.refreshToken,
            expiresAt: Math.trunc(newOauth.expiresAtMs),
            subscriptionType: newOauth.subscriptionType ?? '',
            rateLimitTier: newOauth.rateLimitTier ?? '',
        };
        if (newOauth.scopes !== null && newOauth.scopes !== undefined)
            oauthBlock.scopes = newOauth.scopes;
        return {...existing, claudeAiOauth: oauthBlock};
    });
}
