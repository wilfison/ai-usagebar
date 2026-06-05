import system from 'system';

import {severityFor, severityColor, Severity} from '../lib/severity.js';
import {describe, it, assertEqual, summary} from './_assert.js';

// Local fixture palette. lib/theme.js (US-008) will provide defaultTheme();
// severityColor is theme-agnostic — it just reads the four keys.
const palette = {
    green: '#98c379',
    yellow: '#e5c07b',
    orange: '#d19a66',
    red: '#e06c75',
    fg: '#abb2bf',
};

describe('severityFor — bucket thresholds', () => {
    it('0 → low', () => assertEqual(severityFor(0), Severity.LOW));
    it('49 → low (upper edge of low band)', () => assertEqual(severityFor(49), Severity.LOW));
    it('50 → mid (lower edge of mid band)', () => assertEqual(severityFor(50), Severity.MID));
    it('74 → mid (upper edge of mid band)', () => assertEqual(severityFor(74), Severity.MID));
    it('75 → high (lower edge of high band)', () => assertEqual(severityFor(75), Severity.HIGH));
    it('89 → high (upper edge of high band)', () => assertEqual(severityFor(89), Severity.HIGH));
    it('90 → critical (lower edge of critical band)', () => assertEqual(severityFor(90), Severity.CRITICAL));
    it('100 → critical (range end)', () => assertEqual(severityFor(100), Severity.CRITICAL));
});

describe('severityColor — palette mapping', () => {
    it('low → green', () => assertEqual(severityColor(Severity.LOW, palette), palette.green));
    it('mid → yellow', () => assertEqual(severityColor(Severity.MID, palette), palette.yellow));
    it('high → orange', () => assertEqual(severityColor(Severity.HIGH, palette), palette.orange));
    it('critical → red', () => assertEqual(severityColor(Severity.CRITICAL, palette), palette.red));
});

system.exit(summary());
