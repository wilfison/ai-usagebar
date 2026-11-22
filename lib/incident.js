// What a provider's official status page (Statuspage `summary.json`) flags as
// abnormal for that provider. Pure: the HTTP call and the cache are injected.
import {bodyText, isSuccess} from './http-util.js';
import {sanitizeUntrusted} from './format.js';

export const INCIDENT_TTL_MS = 5 * 60 * 1000;
export const INCIDENT_TIMEOUT_MS = 4000;
const MAX_TITLE_CHARS = 140;

export const IncidentSeverity = Object.freeze({
    MAINTENANCE: 'under_maintenance',
    DEGRADED: 'degraded_performance',
    PARTIAL: 'partial_outage',
    MAJOR: 'major_outage',
});

// Components are named one by one: a page lists many products, and a
// neighbour's outage (claude.ai, Cowork) must not mark this vendor. The title
// needles only place an incident that names no component.
export const STATUS_PAGES = Object.freeze({
    anthropic: Object.freeze({
        cacheId: 'incidents/status.claude.com',
        apiUrl: 'https://status.claude.com/api/v2/summary.json',
        pageUrl: 'https://status.claude.com/',
        components: ['claude code', 'claude api'],
        titleNeedles: ['claude code', 'api'],
    }),
    openai: Object.freeze({
        cacheId: 'incidents/status.openai.com',
        apiUrl: 'https://status.openai.com/api/v2/summary.json',
        pageUrl: 'https://status.openai.com/',
        components: ['codex in chatgpt desktop', 'login'],
        titleNeedles: ['codex'],
    }),
});

export function statusPageFor(vendorId) {
    return Object.hasOwn(STATUS_PAGES, vendorId) ? STATUS_PAGES[vendorId] : null;
}

const STATUS_RANK = Object.freeze({
    major_outage: 4,
    partial_outage: 3,
    degraded_performance: 2,
    under_maintenance: 1,
});

const RANK_SEVERITY = [null, IncidentSeverity.MAINTENANCE, IncidentSeverity.DEGRADED, IncidentSeverity.PARTIAL, IncidentSeverity.MAJOR];

const lower = v => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);

// `Claude API (api.anthropic.com)` is `claude api`.
function componentIs(name, wanted) {
    const n = lower(name);
    return n === wanted || (n.startsWith(wanted) && n.slice(wanted.length).trimStart().startsWith('('));
}

const applies = (page, component) => page.components.some(w => componentIs(component.name, w));

// Whole words only: `api` is not in "rapid".
function titleNames(title, needle) {
    const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const wanted = needle.split(' ');
    for (let i = 0; i + wanted.length <= words.length; i++) {
        if (wanted.every((w, j) => words[i + j] === w))
            return true;
    }
    return false;
}

function incidentApplies(page, inc) {
    if (['resolved', 'postmortem', 'completed'].includes(lower(inc.status)))
        return false;
    const components = list(inc.components);
    if (components.length === 0) {
        const title = lower(inc.name);
        return page.titleNeedles.some(n => titleNames(title, n));
    }
    return components.some(c => applies(page, c));
}

function impactRank(impact) {
    switch (lower(impact)) {
    case 'critical': return 4;
    case 'major': return 3;
    case 'maintenance': return 1;
    default: return 2;
    }
}

// The worst status among the vendor's affected components (what the page
// colours), else the declared impact: a `major` incident often leaves its
// components at degraded.
function incidentRank(page, inc) {
    const ranks = list(inc.components).filter(c => applies(page, c)).map(c => STATUS_RANK[lower(c.status)]).filter(Boolean);
    return ranks.length ? Math.max(...ranks) : impactRank(inc.impact);
}

// Third-party text shown beside a name: one line, capped.
function headline(text) {
    const clean = sanitizeUntrusted(text).replace(/\s+/gu, ' ').trim();
    const chars = Array.from(clean);
    return chars.length <= MAX_TITLE_CHARS ? clean : `${chars.slice(0, MAX_TITLE_CHARS - 1).join('')}…`;
}

function worst(items) {
    return items.reduce((best, it) => (best === null || it.rank > best.rank ? it : best), null);
}

// `{severity, title, url}` when the page flags the vendor, else null (also
// for a body that does not parse). `title` is the open incident's name, or
// the flagged component with its status (`statusLabel(severity)`) when the
// page lists no incident for it. The url is the page itself, never a link
// from the response.
export function parseSummary(vendorId, text, statusLabel = s => s) {
    const page = statusPageFor(vendorId);
    if (!page)
        return null;
    let doc;
    try {
        doc = JSON.parse(text);
    } catch (_e) {
        return null;
    }
    if (!doc || typeof doc !== 'object')
        return null;

    const component = worst(list(doc.components)
        .filter(c => applies(page, c))
        .map(c => ({rank: STATUS_RANK[lower(c.status)] ?? 0, c}))
        .filter(x => x.rank > 0));
    const incident = worst(list(doc.incidents)
        .filter(inc => incidentApplies(page, inc))
        .map(inc => ({rank: incidentRank(page, inc), inc})));

    const rank = Math.max(component?.rank ?? 0, incident?.rank ?? 0);
    if (rank === 0)
        return null;
    const severity = RANK_SEVERITY[Math.min(rank, 4)];

    let title = incident ? headline(incident.inc.name) : '';
    if (!title && component)
        title = headline(`${sanitizeUntrusted(component.c.name)}: ${statusLabel(RANK_SEVERITY[component.rank])}`);
    if (!title)
        title = statusLabel(severity);
    return {severity, title, url: page.pageUrl};
}

// Never throws and never reads a failure as "no incident": a cached body
// younger than the TTL answers, a page that failed is not asked again for
// the TTL (the cache's retry marker), and both of those failures yield null.
export async function fetchIncident(vendorId, {http, cache, now = new Date(), signal = undefined, statusLabel}) {
    const page = statusPageFor(vendorId);
    if (!page)
        return null;
    try {
        const cached = await cache.freshPayload(INCIDENT_TTL_MS);
        if (cached !== null)
            return parseSummary(vendorId, new TextDecoder().decode(cached), statusLabel);
        const retryAt = await cache.readRetryAfter();
        if (retryAt !== null && retryAt > now.getTime())
            return null;

        const res = await http({
            method: 'GET',
            url: page.apiUrl,
            headers: {Accept: 'application/json'},
            timeoutMs: INCIDENT_TIMEOUT_MS,
            cancellable: signal,
        });
        const text = !res.error && isSuccess(res.status) ? bodyText(res) : null;
        if (text === null || !isJsonObject(text)) {
            await cache.writeRetryAfter(now.getTime() + INCIDENT_TTL_MS);
            return null;
        }
        // Also clears an earlier retry marker.
        await cache.writePayload(text);
        return parseSummary(vendorId, text, statusLabel);
    } catch (_e) {
        return null;
    }
}

function isJsonObject(text) {
    try {
        const v = JSON.parse(text);
        return v !== null && typeof v === 'object';
    } catch (_e) {
        return false;
    }
}

export function incidentColor(severity, theme) {
    switch (severity) {
    case IncidentSeverity.MAJOR: return theme.red;
    case IncidentSeverity.PARTIAL: return theme.orange;
    case IncidentSeverity.DEGRADED: return theme.yellow;
    default: return theme.blue;
    }
}

export function incidentStatusLabel(severity, _ = s => s) {
    switch (severity) {
    case IncidentSeverity.MAJOR: return _('Major outage');
    case IncidentSeverity.PARTIAL: return _('Partial outage');
    case IncidentSeverity.DEGRADED: return _('Degraded performance');
    default: return _('Under maintenance');
    }
}

// The popup row above a card's metrics.
export function incidentRow(incident, theme, _ = s => s) {
    return {
        kind: 'text',
        icon: 'dialog-warning-symbolic',
        text: incident.title,
        color: incidentColor(incident.severity, theme),
        subtitle: incidentStatusLabel(incident.severity, _),
    };
}

export const FAKE_INCIDENT_ENV = 'AI_USAGEBAR_FAKE_INCIDENT';

// AI_USAGEBAR_FAKE_INCIDENT names a severity; null when unset or unknown.
export function parseFakeIncident(raw) {
    const s = lower(raw ?? '');
    return Object.values(IncidentSeverity).includes(s) ? s : null;
}

export function fakeIncident(vendorId, severity) {
    const page = statusPageFor(vendorId);
    return page ? {severity, title: `${FAKE_INCIDENT_ENV}: simulated incident`, url: page.pageUrl} : null;
}
