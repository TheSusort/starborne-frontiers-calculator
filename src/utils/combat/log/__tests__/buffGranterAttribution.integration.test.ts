/**
 * End-to-end proof that an ally-directed grant is attributed to the CASTER in the combat log.
 *
 * Purifier is the worked example from the design: its active
 * ("This Unit grants Hacking Up II and Binderburg Resilience II for 1 turn") targets
 * `other-allies` through `Pattern-Wings-Support-Not-Self-Range-2`, which from the focus cell M4
 * covers {T3, T4, B3, B4} — so the allies at T4 and B4 receive it and the ally at T2 does not.
 * The kit was always correct; before granter attribution every one of these entries booked to the
 * RECEIVER, so Purifier's own fingerprint was empty but for `charge-changed`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildScenarioBattle, SEED } from '../../audit/kitFingerprintScenarios';
import { runSeededBattle } from '../../audit/seededBattle';
import type { CombatLogEntry } from '../types';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';

function collect(entries: CombatLogEntry[], acc: CombatLogEntry[]): void {
    for (const e of entries) {
        acc.push(e);
        if (e.reactions?.length) collect(e.reactions, acc);
    }
}

describe('buff granter attribution (integration)', () => {
    beforeAll(() => {
        if (!csvAvailable() || !shipDataAvailable()) {
            throw new Error(
                'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                    '(gitignored reference data).'
            );
        }
    });

    it("attributes Purifier's ally grants to Purifier, with the ally as the target", () => {
        const purifier = buildTraceShip('Purifier');
        expect(purifier).not.toBeNull();
        const result = runSeededBattle(buildScenarioBattle(purifier!, 'plain'), SEED);

        const all: CombatLogEntry[] = [];
        for (const round of result.combatLog) {
            collect(round.startOfRound, all);
            for (const turn of round.turns) collect(turn.entries, all);
            collect(round.endOfRound, all);
        }

        const grants = all.filter((e) => e.kind === 'buff' && e.note === 'Hacking Up II');
        expect(grants.length).toBeGreaterThan(0);

        // Every one books to the caster...
        for (const g of grants) expect(g.actorId).toBe('attacker');
        // ...and names an ally OTHER than the caster as its target (notSelf pattern).
        const recipients = new Set(grants.map((g) => g.targets[0]?.targetId));
        expect(recipients.has('attacker')).toBe(false);
        expect(recipients.size).toBeGreaterThan(0);
    });
});
