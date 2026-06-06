/**
 * @file Pure JWT claim reader for the Codex `id_token`. Decodes the payload
 * segment (base64url, tolerant of standard and no-pad variants) and reads the
 * `exp` and `chatgpt_plan_type` claims. No signature verification — the claims
 * are display-only, never trusted for auth.
 *
 * A tiny hand-rolled base64url decoder is used rather than `GLib.base64_decode`
 * so the module has no `gi://` import and runs under plain `gjs -m`/node.
 */

/** @type {string} Standard base64 alphabet (url-safe chars normalized in first). */
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** @type {Record<string, number>} char → 6-bit value lookup. */
const B64_LOOKUP = (() => {
    const m = Object.create(null);
    for (let i = 0; i < B64_ALPHABET.length; i++)
        m[B64_ALPHABET[i]] = i;
    return m;
})();

/**
 * Decode a base64url (or base64) segment into bytes, tolerating url-safe chars
 * (`-`/`_`), missing padding, and embedded whitespace. Non-alphabet characters
 * are skipped; `=` ends the stream.
 * @param {string} seg
 * @returns {Uint8Array}
 */
function base64UrlToBytes(seg) {
    const s = String(seg).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const ch of s) {
        if (ch === '=')
            break;
        const val = B64_LOOKUP[ch];
        if (val === undefined)
            continue;
        buffer = (buffer << 6) | val;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
    }
    return new Uint8Array(bytes);
}

/**
 * Parse a JWT's payload claims. Returns null for any malformed token (missing
 * payload segment, undecodable base64, or non-JSON-object payload). Never throws.
 * @param {string} token
 * @returns {?object} the decoded claims object, or null.
 */
export function parseJwtClaims(token) {
    if (typeof token !== 'string')
        return null;
    const parts = token.split('.');
    if (parts.length < 2)
        return null;
    let claims;
    try {
        const text = new TextDecoder().decode(base64UrlToBytes(parts[1]));
        claims = JSON.parse(text);
    } catch (_) {
        return null;
    }
    if (claims === null || typeof claims !== 'object' || Array.isArray(claims))
        return null;
    return claims;
}

/**
 * The token's `exp` claim as truncated Unix seconds, or null when the token is
 * malformed or carries no numeric `exp`.
 * @param {string} token
 * @returns {?number}
 */
export function jwtExpSecs(token) {
    const claims = parseJwtClaims(token);
    if (claims === null)
        return null;
    const exp = claims.exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp))
        return null;
    return Math.trunc(exp);
}

/**
 * The ChatGPT plan tier from the nested claim
 * `claims['https://api.openai.com/auth'].chatgpt_plan_type`, or null when absent.
 * @param {string} token
 * @returns {?string}
 */
export function chatgptPlanType(token) {
    const claims = parseJwtClaims(token);
    if (claims === null)
        return null;
    const auth = claims['https://api.openai.com/auth'];
    if (auth === null || typeof auth !== 'object')
        return null;
    const plan = auth.chatgpt_plan_type;
    return typeof plan === 'string' ? plan : null;
}
