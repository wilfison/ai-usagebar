// Human-readable countdown between two instants. Mirrors
// `tmp/ai-usagebar-rust/src/countdown.rs`:
//   - null reset            → "—"
//   - reset <= now          → "now"
//   - >= 1 day remaining    → "{d}d {h}h"
//   - < 1 day remaining     → "{h}h {mm:02d}m"

function pad2(n) {
    return n < 10 ? `0${n}` : `${n}`;
}

export function format(reset, now) {
    if (reset === null || reset === undefined)
        return '—';

    const secs = Math.floor((reset.getTime() - now.getTime()) / 1000);
    if (secs <= 0)
        return 'now';

    const days = Math.floor(secs / 86400);
    const hours = Math.floor((secs % 86400) / 3600);
    const mins = Math.floor((secs % 3600) / 60);

    if (days > 0)
        return `${days}d ${hours}h`;
    return `${hours}h ${pad2(mins)}m`;
}
