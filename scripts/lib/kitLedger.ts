export interface Finding {
    ship: string;
    slot: string;
    layer: 'parser' | 'executor' | 'both';
    verdict: 'WRONG-PARSE' | 'WRONG-EXEC' | 'MISSING';
    expected: string;
    observed: string;
    severity: 'high' | 'med' | 'low';
    fixPointer: string;
}
export interface LedgerInput {
    shipsAudited: number;
    clausesReviewed: number;
    findings: Finding[];
    refuted: number;
    untriggeredVerified: number;
}

const RANK: Record<Finding['severity'], number> = { high: 0, med: 1, low: 2 };

export function renderLedgerMarkdown(input: LedgerInput): string {
    // Severity first; then ship, then slot as deterministic tiebreakers so same-severity
    // ordering is stable regardless of input order (the ledger is a reproducible artifact).
    const sorted = [...input.findings].sort(
        (a, b) =>
            RANK[a.severity] - RANK[b.severity] ||
            a.ship.localeCompare(b.ship) ||
            a.slot.localeCompare(b.slot)
    );
    const bySev = (s: Finding['severity']) => input.findings.filter((f) => f.severity === s).length;
    const rows = sorted
        .map((f) => `| ${f.ship} | ${f.slot} | ${f.layer} | ${f.verdict} | ${f.severity} | ${f.expected} | ${f.observed} | ${f.fixPointer} |`)
        .join('\n');
    return [
        `# Ship Kit Correctness Ledger`,
        ``,
        `- Ships audited: **${input.shipsAudited}**`,
        `- Clauses reviewed: **${input.clausesReviewed}**`,
        `- Confirmed findings: **${input.findings.length}** (high ${bySev('high')} / med ${bySev('med')} / low ${bySev('low')})`,
        `- Candidates refuted in verify: **${input.refuted}**`,
        `- Untriggered clauses verified clean via escalation: **${input.untriggeredVerified}**`,
        ``,
        `| Ship | Slot | Layer | Verdict | Severity | Expected | Observed | Fix pointer |`,
        `| --- | --- | --- | --- | --- | --- | --- | --- |`,
        rows,
        ``,
    ].join('\n');
}

export function renderLedgerJson(input: LedgerInput): string {
    return JSON.stringify(input, null, 2);
}
