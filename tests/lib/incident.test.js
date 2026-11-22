import system from 'system';

import {
    parseSummary, fetchIncident, incidentRow, incidentColor, parseFakeIncident, fakeIncident,
    statusPageFor, INCIDENT_TTL_MS, INCIDENT_TIMEOUT_MS, IncidentSeverity,
} from '../../lib/incident.js';
import {defaultTheme} from '../../lib/theme.js';
import {describe, it, assertEqual, assertDeepEqual, summary} from '../_assert.js';
import {runSync, httpStub, res, resTransport, withCacheHome, backdate, retryArmed} from '../_harness.js';

const json = v => JSON.stringify(v);

describe('parseSummary', () => {
    it('an empty page flags nothing', () => {
        assertEqual(parseSummary('anthropic', json({page: {id: '1'}, incidents: []})), null);
    });

    it('picks the worst incident and links to the page, not the incident', () => {
        const r = parseSummary('anthropic', json({incidents: [
            {name: 'Elevated latency on Claude API', status: 'investigating', impact: 'minor',
                shortlink: 'https://stspg.io/minor1', components: [{name: 'Claude API'}]},
            {name: 'Claude.ai and Claude Code outage', status: 'identified', impact: 'critical',
                shortlink: 'https://stspg.io/crit1', components: [{name: 'Claude Code'}]},
        ]}));
        assertDeepEqual(r, {severity: 'major_outage', title: 'Claude.ai and Claude Code outage', url: 'https://status.claude.com/'});
    });

    it('the affected component status wins over the declared impact', () => {
        const r = parseSummary('anthropic', json({incidents: [{
            name: 'Elevated errors affecting a connector', status: 'identified', impact: 'major',
            components: [{name: 'Claude Code', status: 'degraded_performance'}, {name: 'Claude Cowork', status: 'degraded_performance'}],
        }]}));
        assertEqual(r.severity, 'degraded_performance');
    });

    it("a neighbouring product's incident does not mark the vendor", () => {
        const page = json({
            components: [
                {name: 'claude.ai', status: 'degraded_performance'},
                {name: 'Claude API (api.anthropic.com)', status: 'operational'},
                {name: 'Claude Code', status: 'operational'},
                {name: 'Claude Cowork', status: 'degraded_performance'},
            ],
            incidents: [{
                name: 'Elevated errors affecting the Microsoft 365 connector', status: 'identified', impact: 'major',
                components: [{name: 'claude.ai', status: 'degraded_performance'}, {name: 'Claude Cowork', status: 'degraded_performance'}],
            }],
        });
        assertEqual(parseSummary('anthropic', page), null);
    });

    it('a component with a host suffix matches and names the mark with its status', () => {
        const r = parseSummary('anthropic', json({components: [{name: 'Claude API (api.anthropic.com)', status: 'partial_outage'}]}),
            s => `<${s}>`);
        assertDeepEqual(r, {severity: 'partial_outage', title: 'Claude API (api.anthropic.com): <partial_outage>', url: 'https://status.claude.com/'});
    });

    it('a component name that only starts with a wanted one does not match', () => {
        assertEqual(parseSummary('anthropic', json({components: [{name: 'Claude Code Web', status: 'major_outage'}]})), null);
    });

    it('an incident without components applies only when its title names the product', () => {
        const page = name => json({incidents: [{name, status: 'investigating', impact: 'minor', components: []}]});
        assertEqual(parseSummary('anthropic', page('Elevated errors affecting the Microsoft 365 connector')), null);
        assertEqual(parseSummary('anthropic', page('Rapid response team engaged')), null, '"api" is not in "rapid"');
        assertEqual(parseSummary('anthropic', page('Elevated API errors')).severity, 'degraded_performance');
        assertEqual(parseSummary('openai', page('Codex tasks failing')).severity, 'degraded_performance');
        assertEqual(parseSummary('openai', page('Elevated API errors')), null);
    });

    it('a resolved incident is ignored', () => {
        for (const status of ['resolved', 'postmortem', 'completed']) {
            const page = json({incidents: [{name: 'Claude Code down', status, impact: 'critical', components: [{name: 'Claude Code'}]}]});
            assertEqual(parseSummary('anthropic', page), null, status);
        }
    });

    it('maintenance is the lowest severity', () => {
        const r = parseSummary('openai', json({components: [{name: 'Login', status: 'under_maintenance'}]}));
        assertEqual(r.severity, 'under_maintenance');
        assertEqual(r.url, 'https://status.openai.com/');
    });

    it('an unknown component status flags nothing', () => {
        assertEqual(parseSummary('openai', json({components: [{name: 'Login', status: 'operational'}, {name: 'Login', status: 'weird'}]})), null);
    });

    it('a missing incidents list (the OpenAI page) still reads the components', () => {
        assertEqual(parseSummary('openai', json({components: [{name: 'Codex in ChatGPT Desktop', status: 'degraded_performance'}]})).severity,
            'degraded_performance');
    });

    it('a body that is not a summary flags nothing', () => {
        for (const body of ['', 'not json', 'null', '42', json({components: 'x', incidents: {}})])
            assertEqual(parseSummary('anthropic', body), null, body);
    });

    it('a vendor without a status page flags nothing', () => {
        assertEqual(statusPageFor('zai'), null);
        assertEqual(statusPageFor('toString'), null);
        assertEqual(parseSummary('zai', json({components: [{name: 'Claude Code', status: 'major_outage'}]})), null);
    });

    it('the title is one sanitized line, capped at 140 characters', () => {
        const long = `Claude Code‮\u0007 down\n${'x'.repeat(200)}`;
        const r = parseSummary('anthropic', json({incidents: [{name: long, status: 'investigating', impact: 'major', components: [{name: 'Claude Code'}]}]}));
        assertEqual(r.title.startsWith('Claude Code down x'), true, r.title);
        assertEqual(Array.from(r.title).length, 140);
        assertEqual(r.title.endsWith('…'), true);
    });
});

describe('fetchIncident', () => {
    const NOW = new Date();
    const DEGRADED = json({components: [{name: 'Claude Code', status: 'degraded_performance'}]});
    const withCache = fn => withCacheHome(statusPageFor('anthropic').cacheId, fn);

    it('asks the summary once and caches it for the TTL', withCache(({cache}) => {
        const http = httpStub(res(200, DEGRADED));
        const r = runSync(fetchIncident('anthropic', {http, cache, now: NOW}));
        assertEqual(r.severity, 'degraded_performance');
        assertEqual(http.calls.length, 1);
        assertEqual(http.calls[0].url, 'https://status.claude.com/api/v2/summary.json');
        assertEqual(http.calls[0].timeoutMs, INCIDENT_TIMEOUT_MS);
        assertEqual(http.calls[0].headers.Accept, 'application/json');
        assertEqual(runSync(fetchIncident('anthropic', {http, cache, now: NOW})).severity, 'degraded_performance');
        assertEqual(http.calls.length, 1, 'served from the cache');
    }));

    it('asks again once the cache is older than the TTL', withCache(({cache}) => {
        runSync(cache.writePayload(DEGRADED));
        backdate(cache, INCIDENT_TTL_MS / 1000 + 1);
        const http = httpStub(res(200, json({components: []})));
        assertEqual(runSync(fetchIncident('anthropic', {http, cache, now: NOW})), null);
        assertEqual(http.calls.length, 1);
    }));

    it('a failure is no mark, never the older body, and is not retried for the TTL', withCache(({cache}) => {
        runSync(cache.writePayload(DEGRADED));
        backdate(cache, INCIDENT_TTL_MS / 1000 + 1);
        for (const failure of [res(503, 'down'), resTransport(), res(200, '<html>')]) {
            runSync(cache.clearRetryAfter());
            const http = httpStub(failure);
            assertEqual(runSync(fetchIncident('anthropic', {http, cache, now: NOW})), null);
            assertEqual(retryArmed(cache), true);
            assertEqual(runSync(fetchIncident('anthropic', {http, cache, now: NOW})), null);
            assertEqual(http.calls.length, 1, 'held by the retry marker');
        }
    }));

    it('a lapsed retry marker asks again, and a success clears it', withCache(({cache}) => {
        runSync(cache.writeRetryAfter(NOW.getTime() - 1000));
        const http = httpStub(res(200, DEGRADED));
        assertEqual(runSync(fetchIncident('anthropic', {http, cache, now: NOW})).severity, 'degraded_performance');
        assertEqual(retryArmed(cache), false);
    }));

    it('a throwing http is no mark', withCache(({cache}) => {
        const http = () => Promise.reject(new Error('boom'));
        assertEqual(runSync(fetchIncident('anthropic', {http, cache, now: NOW})), null);
    }));

    it('a vendor without a page makes no request', withCache(({cache}) => {
        const http = httpStub(res(200, DEGRADED));
        assertEqual(runSync(fetchIncident('kimi', {http, cache, now: NOW})), null);
        assertEqual(http.calls.length, 0);
    }));
});

describe('incidentRow', () => {
    const theme = defaultTheme();

    it('a warning text row in the severity colour, labelled by status', () => {
        const row = incidentRow({severity: 'partial_outage', title: 'Claude Code down', url: 'u'}, theme, s => `T:${s}`);
        assertDeepEqual(row, {kind: 'text', icon: 'dialog-warning-symbolic', text: 'Claude Code down', color: theme.orange, subtitle: 'T:Partial outage'});
    });

    it('maps each severity to the status page colour', () => {
        assertEqual(incidentColor(IncidentSeverity.MAJOR, theme), theme.red);
        assertEqual(incidentColor(IncidentSeverity.PARTIAL, theme), theme.orange);
        assertEqual(incidentColor(IncidentSeverity.DEGRADED, theme), theme.yellow);
        assertEqual(incidentColor(IncidentSeverity.MAINTENANCE, theme), theme.blue);
    });
});

describe('fake incident', () => {
    it('parses a known severity only', () => {
        assertEqual(parseFakeIncident(' Partial_Outage '), 'partial_outage');
        assertEqual(parseFakeIncident('bad'), null);
        assertEqual(parseFakeIncident(null), null);
    });

    it('marks only vendors with a page', () => {
        assertEqual(fakeIncident('openai', 'major_outage').url, 'https://status.openai.com/');
        assertEqual(fakeIncident('zai', 'major_outage'), null);
    });
});

system.exit(summary());
