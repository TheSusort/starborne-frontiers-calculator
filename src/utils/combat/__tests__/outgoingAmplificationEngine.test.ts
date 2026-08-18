import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability } from '../../../types/abilities';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
import { dealtBy } from '../__testutils__/perTargetDealt';

// ─────────────────────────────────────────────────────────────────────────────
// D-PR4 Task 7: engine wiring of outgoing amplification through buildTurnArgs.
// The engine supplies runPlayerTurn with `targetEffectiveAttack` and a
// `rollOutgoingProc` closure (a per-(owner,ability) rate gate). A passive-slot
// Menace `outgoing-amplification` ability (condition 'amplify-on-crit') therefore
// amplifies the firing direct hit. With no such ability the closure is never
// invoked → byte-identical with the pre-task baseline.
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `o${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const damageAb = (multiplier = 100): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier } });

// Menace-shape: amplify on crit, +45% per firing hit, high proc chance.
const menaceAmp = (): Ability =>
    ab({
        type: 'outgoing-amplification',
        target: 'self',
        config: {
            type: 'outgoing-amplification',
            condition: 'amplify-on-crit',
            ampPct: 45,
            procChance: 0.5,
        },
    });

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
    attack: 5000,
    crit: 100, // force crits so amplify-on-crit is eligible every hit
    critDamage: 50,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000, // survive every round
    numRounds: 6,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 2000,
    hp: 10000,
    ...overrides,
});

// SP-4b-2b (M3): the run now fights a real, positioned enemy, so the scalar
// `RoundData.directDamage` channel is 0 for the whole run and the focus's credit lands
// per-victim. Sum the focus's own per-victim payout instead — same quantity, live channel.
const sumDirect = (result: ReturnType<typeof runCombat>): number =>
    dealtBy(result.rounds, 'attacker');

describe('D-PR4 engine wiring — outgoing amplification via buildTurnArgs', () => {
    it('Menace passive amplifies total direct damage above the no-amp control', () => {
        idCounter = 0;
        const withAmp = runCombat(
            BASE({
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [damageAb(100)] },
                        { slot: 'passive', abilities: [menaceAmp()] },
                    ],
                },
            })
        );

        idCounter = 0;
        const control = runCombat(
            BASE({
                shipSkills: {
                    slots: [{ slot: 'active', abilities: [damageAb(100)] }],
                },
            })
        );

        // The amplified run credits strictly MORE direct damage than the no-amp control.
        // (FAILS before the engine passes rollOutgoingProc — both runs would be equal.)
        // Positive control: the un-amplified run must itself credit real damage, so the
        // strict inequality below cannot pass on a 0-vs-0 comparison (SP-4b-2b vacuity guard).
        expect(sumDirect(control)).toBeGreaterThan(0);
        expect(sumDirect(withAmp)).toBeGreaterThan(sumDirect(control));
    });
});
