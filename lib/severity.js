export const Severity = Object.freeze({
    LOW: 'low',
    MID: 'mid',
    HIGH: 'high',
    CRITICAL: 'critical',
});

export function severityFor(pct) {
    if (pct >= 90)
        return Severity.CRITICAL;
    if (pct >= 75)
        return Severity.HIGH;
    if (pct >= 50)
        return Severity.MID;
    return Severity.LOW;
}

export function severityColor(sev, theme) {
    switch (sev) {
    case Severity.CRITICAL: return theme.red;
    case Severity.HIGH:     return theme.orange;
    case Severity.MID:      return theme.yellow;
    case Severity.LOW:      return theme.green;
    default:                return theme.fg;
    }
}
