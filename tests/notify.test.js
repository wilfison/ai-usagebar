import system from 'system';

import {evaluateNotification, notificationText} from '../lib/notify.js';
import {Severity} from '../lib/severity.js';
import {describe, it, assertEqual, summary} from './_assert.js';

const W1 = new Date('2026-06-08T12:00:00.000Z');
const W2 = new Date('2026-06-08T17:00:00.000Z'); // next 5h window
const KEY1 = W1.toISOString();
const T0 = 1_000_000_000_000; // arbitrary "now" in ms
const MIN = 60_000;

function evalAt(overrides) {
    return evaluateNotification({
        enabled: true,
        peak: {percent: 95, resetsAt: W1},
        severity: Severity.CRITICAL,
        threshold: 90,
        last: null,
        now: T0,
        ...overrides,
    });
}

describe('evaluateNotification — threshold edges', () => {
    it('below threshold does not alert', () => {
        const r = evalAt({peak: {percent: 89, resetsAt: W1}});
        assertEqual(r.notify, false);
        assertEqual(r.alerting, false);
    });
    it('at threshold alerts and notifies (first crossing)', () => {
        const r = evalAt({peak: {percent: 90, resetsAt: W1}});
        assertEqual(r.notify, true);
        assertEqual(r.alerting, true);
        assertEqual(r.windowKey, KEY1);
        assertEqual(r.percent, 90);
        assertEqual(r.at, T0); // persists the moment we notified
    });
    it('above threshold notifies on first crossing', () => {
        const r = evalAt({});
        assertEqual(r.notify, true);
        assertEqual(r.alerting, true);
    });
});

describe('evaluateNotification — same vendor+percentage dedup', () => {
    it('does not re-fire at the identical percentage in the same window', () => {
        const r = evalAt({last: {percent: 95, at: T0, windowKey: KEY1}, now: T0 + 45 * MIN});
        assertEqual(r.notify, false);
        assertEqual(r.alerting, true);
        assertEqual(r.at, T0); // last-notified timestamp preserved
    });
    it('a different percentage past the cooldown re-notifies', () => {
        const r = evalAt({peak: {percent: 97, resetsAt: W1}, last: {percent: 95, at: T0, windowKey: KEY1}, now: T0 + 31 * MIN});
        assertEqual(r.notify, true);
        assertEqual(r.percent, 97);
        assertEqual(r.at, T0 + 31 * MIN);
    });
});

describe('evaluateNotification — 30-minute cooldown', () => {
    it('suppresses a different percentage within 30 minutes', () => {
        const r = evalAt({peak: {percent: 97, resetsAt: W1}, last: {percent: 95, at: T0, windowKey: KEY1}, now: T0 + 10 * MIN});
        assertEqual(r.notify, false);
        assertEqual(r.percent, 95); // unchanged until we actually re-notify
        assertEqual(r.at, T0);
    });
    it('fires once exactly at the 30-minute boundary', () => {
        const r = evalAt({peak: {percent: 97, resetsAt: W1}, last: {percent: 95, at: T0, windowKey: KEY1}, now: T0 + 30 * MIN});
        assertEqual(r.notify, true);
    });
});

describe('evaluateNotification — window-roll re-arm (Anthropic 5h)', () => {
    it('a new window resets_at re-arms immediately, even within the cooldown', () => {
        const r = evalAt({peak: {percent: 95, resetsAt: W2}, last: {percent: 95, at: T0, windowKey: KEY1}, now: T0 + 5 * MIN});
        assertEqual(r.notify, true);
        assertEqual(r.windowKey, W2.toISOString());
    });
    it('weekly-driven peak does not re-fire when its window is unchanged', () => {
        const weekly = new Date('2026-06-14T00:00:00.000Z');
        const r = evaluateNotification({
            enabled: true,
            peak: {percent: 92, resetsAt: weekly},
            severity: Severity.CRITICAL,
            threshold: 90,
            last: {percent: 92, at: T0, windowKey: weekly.toISOString()},
            now: T0 + 90 * MIN,
        });
        assertEqual(r.notify, false);
    });
});

describe('evaluateNotification — no-percentage vendors (DeepSeek)', () => {
    it('null percent falls back to critical severity on first alert', () => {
        const r = evaluateNotification({
            enabled: true,
            peak: {percent: null, resetsAt: null},
            severity: Severity.CRITICAL,
            threshold: 90,
            last: null,
            now: T0,
        });
        assertEqual(r.notify, true);
        assertEqual(r.alerting, true);
        assertEqual(r.windowKey, '');
    });
    it('null percent re-alerts only once per cooldown while critical', () => {
        const base = {percent: null, resetsAt: null};
        const within = evaluateNotification({enabled: true, peak: base, severity: Severity.CRITICAL,
            threshold: 90, last: {percent: null, at: T0, windowKey: ''}, now: T0 + 10 * MIN});
        assertEqual(within.notify, false);
        const after = evaluateNotification({enabled: true, peak: base, severity: Severity.CRITICAL,
            threshold: 90, last: {percent: null, at: T0, windowKey: ''}, now: T0 + 31 * MIN});
        assertEqual(after.notify, true);
    });
    it('null percent below critical does not alert', () => {
        const r = evaluateNotification({
            enabled: true,
            peak: {percent: null, resetsAt: null},
            severity: Severity.HIGH,
            threshold: 90,
            last: null,
            now: T0,
        });
        assertEqual(r.notify, false);
        assertEqual(r.alerting, false);
    });
});

describe('evaluateNotification — disabled', () => {
    it('never notifies and reports not-alerting', () => {
        const r = evalAt({enabled: false});
        assertEqual(r.notify, false);
        assertEqual(r.alerting, false);
        assertEqual(r.windowKey, KEY1); // still derived for persistence
    });
});

describe('notificationText', () => {
    it('formats a percentage', () =>
        assertEqual(notificationText({percent: 92, resetsAt: W1}), 'Usage at 92%'));
    it('uses the critical wording when there is no percentage', () =>
        assertEqual(notificationText({percent: null, resetsAt: null}), 'Usage is critical'));
    it('routes text through the injected translator', () =>
        assertEqual(notificationText({percent: 92, resetsAt: W1}, s => `<${s}>`), '<Usage at 92%>'));
});

system.exit(summary());
