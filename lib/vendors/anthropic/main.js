import {readCreds, refresh, applyRefresh, writeBack, TOKEN_URL} from '../../oauth/anthropic.js';
import {sanitizeUntrusted} from '../../format.js';
import {vendorFetch, httpGet, runFetch, authorizeOAuth, errorResult, redactedRun} from '../fetch-common.js';
import {parseUsage, snapshotToCacheJson, parseCacheJson, credsPlanLabel} from './parser.js';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1';
export const USAGE_BETA_HEADER = 'oauth-2025-04-20';
// The usage endpoint 429s hard without a Claude Code User-Agent. The grants
// block also needs the CLI surface at >= 2.1.280: the old form is refused as
// `ineligible_reason: "surface"`, older versions as "cli_version".
export const USAGE_USER_AGENT = 'claude-cli/2.1.319 (external, cli)';

async function doFetch(deps) {
    const {http, credsPath} = deps;
    const endpoints = deps.endpoints ?? {usage: USAGE_URL, token: TOKEN_URL};
    const now = deps.now ?? new Date();
    const signal = deps.signal ?? undefined;

    let oauth;
    try {
        ({oauth} = await readCreds(credsPath));
    } catch (e) {
        return errorResult(e);
    }
    const plan = sanitizeUntrusted(credsPlanLabel(oauth), 64);
    // The plan comes from the credentials, not the response, so it is known
    // even when usage is not, and re-applied to a cached snapshot.
    const knownPlan = plan && !plan.startsWith('Unknown') ? {plan} : {};

    const secrets = [oauth.accessToken, oauth.refreshToken];
    return redactedRun(secrets, deps.cache, cache => runFetch({
        cache,
        now,
        cacheTtlMs: deps.cacheTtlMs,
        parseCached: bytes => ({...parseCacheJson(bytes), plan}),
        // Under a 429 backoff runFetch never gets here: no token refresh either.
        authorize: () => authorizeOAuth({
            tokens: oauth,
            expiresAtSecs: Math.trunc(oauth.expiresAtMs / 1000),
            nowSecs: Math.trunc(now.getTime() / 1000),
            cache,
            loginCommand: 'claude',
            refresh: token => refresh(http, token, {endpoint: endpoints.token, cancellable: signal}),
            apply: async rr => {
                secrets.push(rr.accessToken, rr.refreshToken);
                const {rotated} = applyRefresh(oauth, rr, now.getTime());
                return {rotated, saved: await writeBack(credsPath, oauth)};
            },
            extras: knownPlan,
        }),
        request: () => httpGet(deps, endpoints.usage, {
            Authorization: `Bearer ${oauth.accessToken}`,
            'anthropic-beta': USAGE_BETA_HEADER,
            'User-Agent': USAGE_USER_AGENT,
            'Content-Type': 'application/json',
        }),
        parse: res => parseUsage(res.bodyBytes, plan),
        toCache: snapshotToCacheJson,
        httpErrorMessage: status => `usage request failed (HTTP ${status})`,
        // A rejected token may need a new login (no refresh token to try).
        errorExtras: {...knownPlan, loginCommand: 'claude'},
    }));
}

// The tokens are redacted inside doFetch, once read from the credentials.
export const fetchSnapshot = vendorFetch('anthropic', () => [], doFetch);
