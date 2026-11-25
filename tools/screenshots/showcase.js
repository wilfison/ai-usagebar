// Evaluated in the headless shell by capture.sh: trims the fake Anthropic
// snapshot to what the README shows (no "(fake)" labels, no Sonnet window,
// credits or resets) and repaints. Dev only; reaches into indicator privates.
/* global Main */
(() => {
    const i = Main.panel.statusArea['ai-usagebar@wilfison'];
    const s = i?._poller._results.get('anthropic')?.snapshot;
    if (!s)
        throw new Error('no Anthropic snapshot (is it faked?)');
    s.plan = 'Max 5x';
    s.sonnet = null;
    s.cloudCredits = null;
    s.usageCredits = null;
    s.resets = [];
    i._paintSegment('anthropic');
    i._renderVendorSection('anthropic');
    return 'ok';
})();
