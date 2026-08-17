import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../dpsEnemyPlacement';
import type { ShipSkills } from '../../../types/abilities';

/**
 * A real enemy with no kit still ACTS — the engine synthesizes one basic attack per turn when
 * `shipSkills` is absent. Positions on BOTH sides are what make `isPositional` resolve a real
 * target instead of falling back to the vestigial dummy.
 */
const realEnemy = () => [
    {
        id: 'enemy-1',
        stats: {
            attack: 5000,
            crit: 0,
            critDamage: 150,
            speed: 40,
            defence: 1000,
            hp: 400000,
        },
        chargeCount: 0,
        startCharged: false,
        position: DEFAULT_ENEMY_SLOT,
    },
];

const plainDamageKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'a1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});

const baseInput = (): DPSSimulationInput => ({
    attack: 20000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 10000,
    enemyHp: 500000,
    rounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    speed: 100,
    hp: 300000,
    shipSkills: plainDamageKit(),
});

describe('DPS calculator with a real positioned enemy', () => {
    beforeEach(() => {
        // `src/setupTests.ts` already seeds globally; re-seed explicitly so this file is
        // deterministic in isolation too. The rate gate keys on ownerId.
        setupKeyedTestRng(12345);
    });

    it('routes the focus attacker damage to the REAL enemy, not the dummy', () => {
        const result = simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            enemyAttackers: realEnemy(),
        });

        // perTargetDealt is attackerId -> victimId -> dealt. The focus actor id is 'attacker'.
        // Before positions were threaded, selectTurnTarget fell back to the dummy and this key
        // was absent entirely.
        const dealtToRealEnemy = result.rounds.reduce(
            (sum, r) => sum + (r.perTargetDealt?.['attacker']?.['enemy-1'] ?? 0),
            0
        );
        expect(dealtToRealEnemy).toBeGreaterThan(0);
    });

    it('drops the vestigial dummy from the turn order', () => {
        const actors: string[] = [];
        simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            enemyAttackers: realEnemy(),
            bus: {
                on: () => {},
                emit: (e) => {
                    if (e.type === 'turn-started') actors.push(e.actorId);
                },
            },
        });

        // `dummyEnemyIsVestigial` requires every player actor to have a position AND an
        // enemy-side parsed target; satisfied, the dummy 'enemy' leaves the turn order.
        expect(new Set(actors)).toEqual(new Set(['attacker', 'enemy-1']));
        expect(actors).not.toContain('enemy');
    });

    it('reports a damage total that reconciles with perTargetDealt', () => {
        const result = simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            enemyAttackers: realEnemy(),
        });

        const expected = result.rounds.reduce(
            (sum, r) =>
                sum +
                Object.values(r.perTargetDealt?.['attacker'] ?? {}).reduce((s, n) => s + n, 0),
            0
        );

        // Deliberately NOT asserted against any pre-change number: adding an actor shifts every
        // RNG draw (the rate gate keys on ownerId), so digit-parity with the scalar path is not a
        // valid acceptance test. Reconciliation against perTargetDealt is.
        expect(expected).toBeGreaterThan(0);
        expect(result.summary.totalDamage).toBe(Math.round(expected));
    });

    it('keeps each row consistent with the re-derived total', () => {
        const result = simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            enemyAttackers: realEnemy(),
        });

        // The charts read these row fields, so they must agree with the summary.
        let running = 0;
        result.rounds.forEach((r) => {
            const rowDealt = Object.values(r.perTargetDealt?.['attacker'] ?? {}).reduce(
                (s, n) => s + n,
                0
            );
            expect(r.totalRoundDamage).toBe(Math.round(rowDealt));
            running += rowDealt;
            expect(r.cumulativeDamage).toBe(Math.round(running));
        });
    });

    it('keeps the scalar path intact when no real enemy is supplied', () => {
        const result = simulateDPS(baseInput());
        expect(result.summary.totalDamage).toBeGreaterThan(0);
    });

    it('defaults the focus position, so an enemy roster alone never reports zero', () => {
        // CodeRabbit #317: `target` and `pattern` were defaulted but `position` was not, so a
        // caller supplying only `enemyAttackers` got isPositional=false → dummy → empty
        // perTargetDealt → a re-derived metric of ZERO, rather than a fallback to the scalar path.
        const result = simulateDPS({
            ...baseInput(),
            // position deliberately omitted
            enemyAttackers: realEnemy(),
        });

        expect(result.summary.totalDamage).toBeGreaterThan(0);
        const dealt = result.rounds.reduce(
            (sum, r) => sum + (r.perTargetDealt?.['attacker']?.['enemy-1'] ?? 0),
            0
        );
        expect(dealt).toBeGreaterThan(0);
    });

    it('honours an explicitly supplied target instead of the default', () => {
        const result = simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            target: { raw: 'back enemy', side: 'enemy', selection: 'back' },
            enemyAttackers: realEnemy(),
        });

        const dealt = result.rounds.reduce(
            (sum, r) => sum + (r.perTargetDealt?.['attacker']?.['enemy-1'] ?? 0),
            0
        );
        // Only one enemy exists, so front and back resolve to it either way — this asserts the
        // explicit target is threaded and does not break resolution, not that it changes victim.
        expect(dealt).toBeGreaterThan(0);
    });

    it('credits WALKED TEAM damage to teamDamage, reconciling with perTargetDealt', () => {
        // SP-4b-1 regression fence. `RoundData.teamDamage` is the ONLY channel the DPS chart reads
        // for non-focus damage (DPSRoundChart's `hasTeamDamage` / dashed "with team" overlay /
        // violet tooltip row / `killRoundFor`). The engine sums it from the scalar `roundDamage`
        // map, whose team writer is suppressed the moment the team actor resolves positionally —
        // which is now EVERY DPS-page run, since the page always supplies a positioned `enemy-1`
        // and the normalization boundary places + targets every actor. Left unre-derived, the
        // whole team feature silently disappears from the chart and `killRoundFor` reports a
        // LATER kill round than the sim produced. So teamDamage must come from the per-victim
        // channel here, exactly as `totalRoundDamage` already does for the focus.
        const result = simulateDPS({
            ...baseInput(),
            position: DEFAULT_ATTACKER_SLOT,
            enemyAttackers: realEnemy(),
            teamActors: [
                {
                    id: 'team-1',
                    speed: 90,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    shipSkills: plainDamageKit(),
                    stats: {
                        attack: 15000,
                        crit: 0,
                        critDamage: 150,
                        defensePenetration: 0,
                        hacking: 200,
                        security: 100,
                        defence: 1000,
                        hp: 300000,
                        healModifier: 0,
                    },
                    position: 'M3',
                },
            ],
        });

        const dealtBySource = (r: (typeof result.rounds)[number], id: string) =>
            Object.values(r.perTargetDealt?.[id] ?? {}).reduce((s, n) => s + n, 0);

        // The team actor really did hit the real enemy...
        const teamDealt = result.rounds.reduce((sum, r) => sum + dealtBySource(r, 'team-1'), 0);
        expect(teamDealt).toBeGreaterThan(0);

        // ...and that damage reaches the aggregate the display layer reads, per round and in total.
        expect(result.rounds.some((r) => (r.teamDamage ?? 0) > 0)).toBe(true);
        expect(result.summary.teamTotalDamage ?? 0).toBeGreaterThan(0);

        // Reconciliation (not a magic number — adding an actor shifts every RNG draw): each row's
        // teamDamage is exactly that round's per-victim channel summed over the walked team ids,
        // and the summary is the total of the same, mirroring the focus re-derivation.
        result.rounds.forEach((r) => {
            expect(r.teamDamage ?? 0).toBe(Math.round(dealtBySource(r, 'team-1')));
        });
        expect(result.summary.teamTotalDamage).toBe(Math.round(teamDealt));

        // The enemy's OWN output must never leak into the player-side team aggregate. The enemy
        // deals real damage in this fixture, so the per-round equality above is a LIVE exclusion
        // of every non-focus actor that is not a walked team member, not a vacuous one.
        const enemyDealt = result.rounds.reduce((sum, r) => sum + dealtBySource(r, 'enemy-1'), 0);
        expect(enemyDealt).toBeGreaterThan(0);
    });
});
