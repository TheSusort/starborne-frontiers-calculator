import type { Placement, PlacementDiff } from '../../src/utils/combat/audit/types';

const DEFAULT_SEEDS = 5;

/** Pure: parses `--seeds <K>` / `--base-seed <N>`. `--seeds` is the number of consecutive seeds to
 *  union over, not a seed value. Unrecognized tokens are ignored (no positional args). */
export function parsePlacementArgs(argv: string[]): { seeds: number; baseSeed: number } {
    const out = { seeds: DEFAULT_SEEDS, baseSeed: Number.NaN };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--seeds') out.seeds = Number(argv[++i]);
        else if (argv[i] === '--base-seed') out.baseSeed = Number(argv[++i]);
    }
    return out;
}

/** Numbers that make a zero-finding sweep auditable instead of merely reassuring. */
export interface PlacementHealth {
    shipsSwept: number;
    seeds: number[];
    /** Ships that produced NO kinds at all, per placement. Must be 0 — a nonzero count means the
     *  sweep observed nothing and every "missing" finding is an artifact. */
    emptyByPlacement: Record<Placement, number>;
    /** Distinct kinds observed across the corpus, per placement. */
    kindsByPlacement: Record<Placement, number>;
    /** Ships whose three placements agreed exactly. */
    symmetricShips: number;
}

export function buildPlacementLedgerJson(diffs: PlacementDiff[], health: PlacementHealth) {
    return { health, findingCount: diffs.length, findings: diffs };
}

function hasVacuity(health: PlacementHealth): boolean {
    return Object.values(health.emptyByPlacement).some((n) => n > 0);
}

export function renderPlacementLedgerMarkdown(
    diffs: PlacementDiff[],
    health: PlacementHealth
): string {
    const lines: string[] = [
        '# Placement Symmetry Ledger',
        '',
        'Each corpus ship run by all three engine actor paths (`attacker` / `team` / `enemy`) on',
        'byte-identical cells. A finding is a log-entry kind produced in one placement and never in',
        'another. **Findings are CANDIDATES** — confirm with direct engine instrumentation before',
        'recording any of them as a real bug.',
        '',
        `- Ships swept: **${health.shipsSwept}**`,
        `- Seeds unioned: **${health.seeds.length}** (${health.seeds.join(', ')})`,
        `- Ships symmetric across all three placements: **${health.symmetricShips}**`,
        `- Findings: **${diffs.length}**`,
        '',
        '## Suite health',
        '',
        '| placement | distinct kinds | ships observing nothing |',
        '| --- | --- | --- |',
    ];
    for (const placement of ['focus', 'team', 'enemy'] as Placement[]) {
        lines.push(
            `| ${placement} | ${health.kindsByPlacement[placement]} | ${health.emptyByPlacement[placement]} |`
        );
    }
    lines.push('');
    if (hasVacuity(health)) {
        lines.push(
            '> **VACUITY WARNING:** at least one placement observed nothing for some ships. Every',
            '> "missing" finding below is suspect until that is explained — an unresolved subject id',
            '> fingerprints an empty set and looks exactly like a total behaviour loss.',
            ''
        );
    }
    lines.push(
        '**Calibration is narrower than it sounds.** The calibration subjects (`CALIBRATION_SUBJECT_NAMES`)',
        'have no passives, no charge skill, and only a bare damage-dealing active, so their fingerprint is',
        'structurally bounded to `{}` or `{attack}` — none of the other 17 `CombatLogEntryKind` values can',
        'EVER appear for them, in any placement, at any seed count. A clean calibration therefore proves the',
        "subject's actor id resolves correctly in all three placements for the `attack` pathway. It does NOT",
        'rule out an asymmetry in heal, shield, buff, death, or charge-changed attribution — those pathways',
        'are simply **not exercised** by the calibration gate at all.',
        ''
    );
    lines.push('## Findings', '');
    if (diffs.length === 0) {
        lines.push('No placement asymmetries observed.', '');
    } else {
        for (const d of diffs) {
            lines.push(
                `- **${d.shipName}** — fires as \`${d.from}\` but never as \`${d.to}\`: ` +
                    `${d.missing.map((k) => `\`${k}\``).join(', ')}`
            );
        }
        lines.push('');
    }
    return lines.join('\n');
}
