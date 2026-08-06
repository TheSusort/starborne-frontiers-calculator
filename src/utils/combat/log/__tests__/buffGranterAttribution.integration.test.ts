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
import {
    buildScenarioBattle,
    FILLER_HP,
    FILLER_NAMES,
    SEED,
} from '../../audit/kitFingerprintScenarios';
import { runSeededBattle } from '../../audit/seededBattle';
import type { CombatLogEntry } from '../types';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import { canonicalPlacement } from '../../audit/fixtures';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';
import type { BattlePlacement } from '../../../calculators/battleSimulator';

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
        // Each grant must have exactly one real (non-undefined) recipient — otherwise a set of
        // {undefined} would satisfy both assertions below vacuously.
        const rosterIds = new Set(result.roster.map((r) => r.actorId));
        for (const g of grants) {
            expect(g.targets.length).toBe(1);
            expect(g.targets[0].targetId).toBeDefined();
            expect(rosterIds.has(g.targets[0].targetId)).toBe(true);
        }
        const recipients = new Set(grants.map((g) => g.targets[0].targetId));
        expect(recipients.has('attacker')).toBe(false);
        expect(recipients.size).toBeGreaterThan(0);
    });

    it('attributes an ENEMY-side grant to the enemy granter, not the enemy receiver', () => {
        // Team symmetry: enemies run the same per-recipient application loop as the player side
        // (see playerTurn.ts's "covers BOTH sides" comment), so granter attribution must hold
        // there too.
        //
        // The standard scenario board CANNOT show this — its enemy side is inert filler that
        // grants nothing, so a loop over enemy buff entries would be vacuous. Put Purifier on the
        // ENEMY team instead: at M4 its Wings-Support-Not-Self-Range-2 active covers the enemy
        // allies at T4/B4 exactly as it does on the player side.
        const purifier = buildTraceShip('Purifier');
        expect(purifier).not.toBeNull();
        const filler = FILLER_NAMES.map((n) => buildTraceShip(n)!);
        // Named assertion instead of letting a resolution failure crash opaquely inside
        // canonicalPlacement below.
        expect(filler.every(Boolean)).toBe(true);
        const pl = (ship: Ship, position: Position): BattlePlacement => {
            const base = canonicalPlacement(ship, position);
            return {
                ...base,
                statOverrides: { ...base.statOverrides, hp: FILLER_HP, attack: 400 },
            };
        };
        const result = runSeededBattle(
            {
                playerTeam: [
                    pl(filler[0], 'M4'),
                    pl(filler[1], 'T4'),
                    pl(filler[2], 'T2'),
                    pl(filler[3], 'B4'),
                ],
                enemyTeam: [
                    canonicalPlacement(purifier!, 'M4'),
                    pl(filler[4], 'T4'),
                    pl(filler[5], 'T2'),
                    pl(filler[6], 'B4'),
                ],
                rounds: 5,
            },
            SEED
        );

        const all: CombatLogEntry[] = [];
        for (const round of result.combatLog) {
            collect(round.startOfRound, all);
            for (const turn of round.turns) collect(turn.entries, all);
            collect(round.endOfRound, all);
        }

        const enemyIds = new Set(
            result.roster.filter((r) => r.side === 'enemy').map((r) => r.actorId)
        );
        const enemyBuffs = all.filter(
            (e) => e.kind === 'buff' && e.targets.some((t) => enemyIds.has(t.targetId))
        );
        // Non-vacuity guard FIRST: an empty list would make every assertion below trivially true.
        // The verified baseline for this board is 20 entries; assert loosely so a kit/data
        // refresh does not churn the test, but never allow zero.
        expect(enemyBuffs.length).toBeGreaterThan(0);

        const purifierId = result.roster.find((r) => r.name === 'Purifier')!.actorId;
        for (const b of enemyBuffs) {
            // Pins the no-aggregation invariant itself (exactly one target per buff entry) rather
            // than merely tolerating it — `some`/`every` above are equivalent today only because
            // this holds.
            expect(b.targets.length).toBe(1);
            expect(enemyIds.has(b.actorId)).toBe(true);
            expect(b.actorId).toBe(purifierId);
        }
    });
});
