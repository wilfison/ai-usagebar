import {fakeWindow} from '../fake.js';
import {withCurrency, sanitizeUntrusted, checkedResetTitle, resetsAvailableText, vformat} from '../../format.js';
import {encodeSnapshot, decodeSnapshot} from '../snapshot-cache.js';
import {
    SchemaError, isObject, isFiniteNumber, isCurrencyCode, decodeJsonObject, parseInstant, capitalize, SESSION_MS, WEEKLY_MS,
} from '../parse-common.js';
import {windowFields, setWindowPlaceholders, NO_WINDOW, EMPTY_FIELDS, peakOf} from '../placeholder-common.js';

export {SchemaError, SESSION_MS, WEEKLY_MS};

export const ICON = '󰚩';
export const VENDOR_SHORT = 'cld';
// Verified Ultra accounts have no five-hour limit; the endpoint says so with
// `five_hour: null`.
export const ULTRA = 'Ultra';

// Anthropic renamed Max 20x to Ultra and Max 5x to Max (October 2026), but the
// credentials keep the old ids, so the tier is what tells Ultra apart. Ultra is
// claimed only for a `max` subscription: the label decides what a missing
// `five_hour` means (see parseUsage).
export function credsPlanLabel(oauth) {
    const type = oauth?.subscriptionType ?? '';
    if (type.toLowerCase() === 'max' && (oauth?.rateLimitTier ?? '').includes('20x'))
        return ULTRA;
    return capitalize(type) || 'Unknown';
}

function roundUtil(v) {
    if (v === undefined || v === null)
        return 0;
    if (!isFiniteNumber(v))
        throw new SchemaError(`utilization: expected number, got ${typeof v}`);
    return Math.round(v);
}

// Minor units; absent stays null so an incomplete block never shows a made-up zero.
function optCents(v, field) {
    if (v === undefined || v === null)
        return null;
    if (!isFiniteNumber(v))
        throw new SchemaError(`${field}: expected number or null, got ${typeof v}`);
    if (v < 0)
        throw new SchemaError(`${field}: cents cannot be negative`);
    return Math.trunc(v);
}

// Embedded verbatim in the label, so only a plausible ISO 4217 alpha code passes.
function optCurrency(v) {
    if (v === undefined || v === null)
        return null;
    if (!isCurrencyCode(v))
        throw new SchemaError(`extra_usage.currency ${JSON.stringify(v)} is not an ISO 4217 alpha code`);
    return v;
}

function optDecimalPlaces(v) {
    if (v === undefined || v === null)
        return null;
    if (!Number.isInteger(v) || v < 0 || v > 6)
        throw new SchemaError('extra_usage.decimal_places must be an integer in 0..=6');
    return v;
}

// Exact decimal walk over the number's own digits, ties rounded up: 1.005
// dollars is 101 cents, which float multiplication would get wrong. Negative,
// non-finite or past 1e13 dollars is not a figure the meter can use.
export function dollarsToCents(v) {
    if (!isFiniteNumber(v) || v < 0 || v > 1e13)
        return null;
    if (v === 0)
        return 0;
    const text = String(v);
    if (/e/iu.test(text))
        return Math.round(v * 100);
    const [intPart, frac = ''] = text.split('.');
    const digit = i => (i < frac.length ? frac.charCodeAt(i) - 48 : 0);
    const halfUp = frac.length > 2 && digit(2) >= 5 ? 1 : 0;
    return Number(intPart) * 100 + digit(0) * 10 + digit(1) + halfUp;
}

// An integral JSON number (`500.0` included) within the exact-integer range.
function jsonInt(v) {
    return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 2 ** 53 ? v : null;
}

// `iguana_necktie`: the credit Claude Code's cloud sessions draw from. Each
// field is read leniently; a block that does not add up is dropped alone, and
// `locked_reason` is reduced to a flag so its text never leaves the parser.
function parseCloudCredits(block) {
    if (!isObject(block))
        return null;
    const limitCents = dollarsToCents(block.limit_dollars);
    const remainingCents = dollarsToCents(block.remaining_dollars);
    if (limitCents === null || remainingCents === null || limitCents <= 0)
        return null;
    return {
        limitCents,
        remainingCents,
        expiresAt: parseInstant(block.resets_at),
        locked: typeof block.locked_reason === 'string' && block.locked_reason !== '',
    };
}


// `spend.balance` in one of the two shapes seen: `{amount_minor, exponent,
// currency}`, or `{amount, currency: "USD"}` in cents. Anything else is a
// balance we cannot state, so it is absent rather than $0.
function parseUsageCredits(spend) {
    if (!isObject(spend) || !isObject(spend.balance))
        return null;
    const balance = spend.balance;
    const currency = isCurrencyCode(balance.currency) ? balance.currency : null;
    let amount = null, decimalPlaces = null;
    const exponent = jsonInt(balance.exponent);
    if (jsonInt(balance.amount_minor) !== null && exponent !== null && exponent >= 0 && exponent <= 4 && currency !== null) {
        amount = balance.amount_minor;
        decimalPlaces = exponent;
    } else if (jsonInt(balance.amount) !== null && currency === 'USD') {
        amount = balance.amount;
        decimalPlaces = 2;
    } else {
        return null;
    }
    let autoReload = null;
    if (typeof spend.auto_reload?.enabled === 'boolean')
        autoReload = spend.auto_reload.enabled;
    else if (typeof balance.auto_reload_settings?.enabled === 'boolean')
        autoReload = balance.auto_reload_settings.enabled;
    return {amountMinor: amount, decimalPlaces, currency, autoReload};
}

export const ExtraStatus = Object.freeze({
    ACTIVE: 'active',
    OUT_OF_CREDITS: 'out-of-credits',
    MONTHLY_LIMIT_REACHED: 'monthly-limit-reached',
    UNAVAILABLE: 'unavailable',
});

// Extra usage switched off by the provider is still worth showing: that is
// when its spend matters most. Switched off by the user, it is hidden.
function extraStatus(eu, spentCents) {
    if (eu.is_enabled === true)
        return ExtraStatus.ACTIVE;
    if (eu.user_disabled === true)
        return null;
    if (eu.disabled_reason === 'out_of_credits')
        return ExtraStatus.OUT_OF_CREDITS;
    if (eu.disabled_reason === 'monthly_limit_reached' || eu.disabled_reason === 'spend_limit_reached' || eu.spend_limit_reached === true)
        return ExtraStatus.MONTHLY_LIMIT_REACHED;
    if (eu.credits_ever_enabled === true && (spentCents ?? 0) > 0)
        return ExtraStatus.UNAVAILABLE;
    return null;
}

function toWindow(w) {
    if (w === undefined || w === null)
        return {utilizationPct: 0, resetsAt: null};
    if (!isObject(w))
        throw new SchemaError('usage window: expected object');
    return {utilizationPct: roundUtil(w.utilization), resetsAt: parseInstant(w.resets_at)};
}

// Model-scoped weekly caps (e.g. Fable) live only inside `limits[]` as
// `weekly_scoped` entries labelled by `scope.model.display_name`; there is no
// dedicated `seven_day_<model>` field. Everything else in the array duplicates
// five_hour/seven_day, so we lift only labelled weekly_scoped entries.
function parseScopedLimits(limits) {
    if (!Array.isArray(limits))
        return [];
    const scoped = [];
    for (const l of limits) {
        if (!isObject(l))
            continue;
        if (l.kind !== 'weekly_scoped')
            continue;
        const label = l.scope?.model?.display_name;
        if (typeof label !== 'string' || label.length === 0)
            continue;
        scoped.push({
            label: sanitizeUntrusted(label, 64),
            utilizationPct: roundUtil(l.percent),
            resetsAt: parseInstant(l.resets_at),
        });
    }
    return scoped;
}

// Banked "launch resets". Only grants redeemable right now count; the grant
// `id` is the handle that spends a reset, so it is never read.
function parseResetGrants(block) {
    if (!isObject(block) || block.eligible !== true)
        return [];
    if (!Array.isArray(block.grants))
        return [];
    const resets = [];
    for (const g of block.grants) {
        if (!isObject(g))
            continue;
        if (g.usable_now !== true || g.paused === true)
            continue;
        if (!Number.isInteger(g.resets_left) || g.resets_left <= 0)
            continue;
        resets.push({label: checkedResetTitle(g.label), resetsLeft: g.resets_left, endsAt: parseInstant(g.ends_at)});
    }
    return resets;
}

export function parseUsage(bytesOrText, planLabel) {
    const obj = decodeJsonObject(bytesOrText, 'usage response');

    const eu = obj.extra_usage;
    let extra = null;
    if (eu !== undefined && eu !== null) {
        if (!isObject(eu))
            throw new SchemaError('extra_usage: expected object');
        const limitCents = optCents(eu.monthly_limit, 'extra_usage.monthly_limit');
        const spentCents = optCents(eu.used_credits, 'extra_usage.used_credits');
        const currency = optCurrency(eu.currency);
        const decimalPlaces = optDecimalPlaces(eu.decimal_places);
        // `monthly_limit: null` means no spending cap (e.g. Pro), not drift;
        // without the spend there is nothing to show.
        const status = extraStatus(eu, spentCents);
        if (status !== null && spentCents !== null)
            extra = {limitCents, spentCents, currency, decimalPlaces, status};
    }

    const noSessionLimit = planLabel === ULTRA && (obj.five_hour === undefined || obj.five_hour === null);
    return {
        plan: planLabel,
        session: noSessionLimit ? null : toWindow(obj.five_hour),
        weekly: toWindow(obj.seven_day),
        sonnet: obj.seven_day_sonnet === undefined || obj.seven_day_sonnet === null
            ? null
            : toWindow(obj.seven_day_sonnet),
        scoped: parseScopedLimits(obj.limits),
        extra,
        resets: parseResetGrants(obj.cedar_ember),
        cloudCredits: parseCloudCredits(obj.iguana_necktie),
        usageCredits: parseUsageCredits(obj.spend),
    };
}

// Dev-only synthetic snapshot at a fixed percentage (AI_USAGEBAR_FAKE_PCT),
// used to verify rendering without a live fetch. Every window shows `pct`.
export function fakeSnapshot(pct, now = new Date()) {
    return {
        plan: 'Max (fake)',
        session: fakeWindow(pct, SESSION_MS, now),
        weekly: fakeWindow(pct, WEEKLY_MS, now),
        sonnet: fakeWindow(pct, WEEKLY_MS, now),
        scoped: [{label: 'Fable', ...fakeWindow(pct, WEEKLY_MS, now)}],
        extra: null,
        resets: [{label: 'Launch reset (fake)', resetsLeft: 1, endsAt: new Date(now.getTime() + WEEKLY_MS)}],
        cloudCredits: {limitCents: 25000, remainingCents: Math.round(25000 * (100 - pct) / 100), expiresAt: new Date(now.getTime() + WEEKLY_MS), locked: false},
        usageCredits: {amountMinor: 750, decimalPlaces: 2, currency: 'USD', autoReload: true},
    };
}

export function extraPercent(extra) {
    if (extra.limitCents === null || extra.limitCents <= 0)
        return 0;
    return Math.trunc((extra.spentCents * 100) / extra.limitCents);
}

// Peak utilization and the resets_at of the window that produced it.
export function anthropicPeakUsage(snapshot) {
    const windows = [snapshot.session, snapshot.weekly, snapshot.sonnet, ...(snapshot.scoped ?? [])].filter(Boolean);
    const peak = peakOf(windows.map(w => ({percent: w.utilizationPct, resetsAt: w.resetsAt})));
    // Extra usage only counts once a window is capped; it is a monthly credit
    // limit, with no reset window.
    if (snapshot.extra && windows.some(w => w.utilizationPct >= 100)) {
        const p = extraPercent(snapshot.extra);
        if (p > peak.percent)
            return {percent: p, resetsAt: null};
    }
    return peak;
}

// Integer minor units at the currency's own scale; `currency` null is legacy USD.
export function formatMinor(minor, decimalPlaces, currency = null) {
    const sign = minor < 0 ? '-' : '';
    const abs = Math.abs(minor);
    const scale = 10 ** decimalPlaces;
    const number = decimalPlaces === 0
        ? String(abs)
        : `${Math.trunc(abs / scale)}.${String(abs % scale).padStart(decimalPlaces, '0')}`;
    return withCurrency(sign, number, currency);
}

// A currency code alone does not fix its minor-unit exponent, so the amount
// is shown as raw minor units rather than divided by a guessed scale.
export function formatExtraAmount(extra, minor, _ = s => s) {
    const currency = extra.currency ?? null;
    const decimalPlaces = extra.decimalPlaces ?? null;
    if (decimalPlaces !== null)
        return formatMinor(minor, decimalPlaces, currency);
    if (currency !== null)
        // Translators: "14157 minor units BRL": an amount in the currency's smallest unit.
        return vformat(_('%s minor units %s'), `${minor < 0 ? '-' : ''}${Math.abs(minor)}`, currency);
    return formatMinor(minor, 2);
}

const PACE_LABEL_SUFFIXES = ['pace_pct', 'pace_pts', 'pace_delta', 'pace_abs_delta'];

function emptyWindowPlaceholders(m, prefix) {
    for (const suffix of PACE_LABEL_SUFFIXES)
        m.set(`${prefix}_${suffix}`, '');
}

// A missing window reads as 0%, no reset, and a neutral pace.
function windowPlaceholders(m, prefix, win, windowMs, now) {
    const f = windowFields(win ?? NO_WINDOW, now, windowMs);
    setWindowPlaceholders(m, prefix, f);
    m.set(`${prefix}_pace_pct`, f.calc.ratioLabel);
    m.set(`${prefix}_pace_pts`, f.calc.pointLabel);
    m.set(`${prefix}_pace_delta`, String(f.calc.delta));
    m.set(`${prefix}_pace_abs_delta`, String(Math.abs(f.calc.delta)));
}

export function resetsAvailable(snapshot) {
    return (snapshot.resets ?? []).reduce((n, r) => n + r.resetsLeft, 0);
}

export function placeholders(snapshot, now, ngettext) {
    const m = new Map();
    m.set('icon', ICON);
    m.set('vendor_short', VENDOR_SHORT);
    m.set('plan', snapshot.plan);

    // Ultra has no five-hour window: its placeholders are blank, not 0%.
    if (snapshot.session) {
        windowPlaceholders(m, 'session', snapshot.session, SESSION_MS, now);
    } else {
        setWindowPlaceholders(m, 'session', EMPTY_FIELDS);
        emptyWindowPlaceholders(m, 'session');
    }
    windowPlaceholders(m, 'weekly', snapshot.weekly, WEEKLY_MS, now);
    windowPlaceholders(m, 'sonnet', snapshot.sonnet, WEEKLY_MS, now);

    const extra = snapshot.extra;
    m.set('extra_spent', extra ? formatExtraAmount(extra, extra.spentCents) : '');
    let extraLimit = '';
    if (extra)
        extraLimit = extra.limitCents === null ? '-' : formatExtraAmount(extra, extra.limitCents);
    m.set('extra_limit', extraLimit);
    m.set('extra_pct', snapshot.extra ? String(extraPercent(snapshot.extra)) : '0');

    const resets = resetsAvailable(snapshot);
    m.set('resets_available', String(resets));
    m.set('resets', resetsAvailableText(resets, ngettext));

    return m;
}

// One notification row per usage window; labels match the popup titles.
export function notifyRows(snapshot, _ = (s) => s) {
    const rows = [];
    if (snapshot.session)
        rows.push({key: 'session', label: _('Session'), percent: snapshot.session.utilizationPct, resetsAt: snapshot.session.resetsAt});
    rows.push({key: 'weekly', label: _('Weekly'), percent: snapshot.weekly.utilizationPct, resetsAt: snapshot.weekly.resetsAt});
    if (snapshot.sonnet)
        rows.push({key: 'sonnet', label: _('Sonnet only'), percent: snapshot.sonnet.utilizationPct, resetsAt: snapshot.sonnet.resetsAt});
    for (const sw of snapshot.scoped ?? [])
        rows.push({key: `scoped:${sw.label}`, label: sw.label, percent: sw.utilizationPct, resetsAt: sw.resetsAt});
    return rows;
}

export function resetCredits(snapshot) {
    return (snapshot.resets ?? []).map(r => ({title: r.label, expiresAt: r.endsAt}));
}

export const CACHE_VERSION = 3;

export function snapshotToCacheJson(snapshot) {
    return encodeSnapshot(snapshot, CACHE_VERSION);
}

export function parseCacheJson(bytesOrText) {
    return decodeSnapshot(bytesOrText, CACHE_VERSION);
}
