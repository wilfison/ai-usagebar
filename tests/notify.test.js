import system from 'system';

import {evaluateNotification, notificationText} from '../lib/notify.js';
import {Severity} from '../lib/severity.js';
import {describe, it, assertEqual, summary} from './_assert.js';

const W1 = new Date('2026-06-08T12:00:00.000Z');
const W2 = new Date('2026-06-08T17:00:00.000Z'); // next 5h window
const KEY1 = W1.toISOString();

function evalAt(overrides) {
    return evaluateNotification({
        enabled: true,
        peak: {percent: 95, resetsAt: W1},
        severity: Severity.CRITICAL,
        threshold: 90,
        last: null,
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
    });
    it('above threshold notifies on first crossing', () => {
        const r = evalAt({});
        assertEqual(r.notify, true);
        assertEqual(r.alerting, true);
    });
});

describe('evaluateNotification — once-only edge trigger', () => {
    it('does not re-fire while still alerting in the same window', () => {
        const r = evalAt({last: {alerting: true, windowKey: KEY1}});
        assertEqual(r.notify, false);
        assertEqual(r.alerting, true);
    });
    it('re-arms after dropping below, then re-notifies on re-crossing', () => {
        const dropped = evalAt({peak: {percent: 40, resetsAt: W1}, last: {alerting: true, windowKey: KEY1}});
        assertEqual(dropped.notify, false);
        assertEqual(dropped.alerting, false);
        const reCross = evalAt({last: {alerting: false, windowKey: KEY1}});
        assertEqual(reCross.notify, true);
    });
});

describe('evaluateNotification — window-roll re-arm (Anthropic 5h)', () => {
    it('a new window resets_at re-arms even while still over threshold', () => {
        // Was alerting in window 1; the 5h window rolled to window 2, still ≥ threshold.
        const r = evalAt({peak: {percent: 95, resetsAt: W2}, last: {alerting: true, windowKey: KEY1}});
        assertEqual(r.notify, true);
        assertEqual(r.windowKey, W2.toISOString());
    });
    it('weekly-driven peak does not re-fire when its window is unchanged', () => {
        // Weekly window (a week out) drives the peak; its key is stable across 5h polls.
        const weekly = new Date('2026-06-14T00:00:00.000Z');
        const r = evaluateNotification({
            enabled: true,
            peak: {percent: 92, resetsAt: weekly},
            severity: Severity.CRITICAL,
            threshold: 90,
            last: {alerting: true, windowKey: weekly.toISOString()},
        });
        assertEqual(r.notify, false);
    });
});

describe('evaluateNotification — no-percentage vendors (DeepSeek)', () => {
    it('null percent falls back to critical severity', () => {
        const r = evaluateNotification({
            enabled: true,
            peak: {percent: null, resetsAt: null},
            severity: Severity.CRITICAL,
            threshold: 90,
            last: null,
        });
        assertEqual(r.notify, true);
        assertEqual(r.alerting, true);
        assertEqual(r.windowKey, '');
    });
    it('null percent below critical does not alert', () => {
        const r = evaluateNotification({
            enabled: true,
            peak: {percent: null, resetsAt: null},
            severity: Severity.HIGH,
            threshold: 90,
            last: null,
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
