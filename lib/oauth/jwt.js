const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_LOOKUP = (() => {
    const m = Object.create(null);
    for (let i = 0; i < B64_ALPHABET.length; i++)
        m[B64_ALPHABET[i]] = i;
    return m;
})();

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

export function jwtExpSecs(token) {
    const claims = parseJwtClaims(token);
    if (claims === null)
        return null;
    const exp = claims.exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp))
        return null;
    return Math.trunc(exp);
}

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
