/**
 * SP-E, Task E2 — engine-level integration: an `unremovable`, `family`-tagged DoT stack (the
 * shape E4's Acidic Decay conversion will produce — this task does NOT wire that conversion,
 * it only makes the survival + counting mechanism work) survives the Cheat-Death wipe, while a
 * plain (untagged, removable) stack in the SAME array is still wiped as before. It also proves
 * the live entries are countable by `dotFamilyCounts` under the EXACT key
 * (`'Acidic Decay'`) a named `enemy-dot-count` gate reads via `enemyDotFamilyCounts`.
 *
 * Team-symmetry: the Cheat-Death intercept lives in the ONE shared `applyVictimDamage` core
 * (engine.ts) that both `applyIncomingToTarget` (enemy→player) and `applyOutgoingToEnemy`
 * (player→enemy) call — there is no player/enemy branch to duplicate-test for correctness, but
 * this file still exercises BOTH directions to lock the symmetry as a regression guard.
 *
 *  - Enemy-side: mirrors `applyOutgoingToEnemy.test.ts`'s hand-built-victim harness (the
 *    `__testTapApplyOutgoingToEnemy` tap hands out the REAL closure so a hand-built enemy
 *    `CombatActor` can be seeded and hit directly).
 *  - Player-side: mirrors `hpCrossing.test.ts`'s healing-mode harness (`healTargetId: 'attacker'`
 *    + a Cheat-Death self-buff + a lethal manual enemy attacker), using `__testTapActors` to grab
 *    the live `attacker` CombatActor and seed its `corrosionEntries`/`genericDoTEntries` BEFORE
 *    round 1 runs (the tap fires at roster construction, before the round loop).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createActor, CombatActor, ActiveDoTStack } from '../state';
import { createEventBus, CombatEvent } from '../events';
import { ShipSkills } from '../../../types/abilities';
import { dotFamilyCounts } from '../../abilities/roundContext';

const acidicDecay = (overrides: Partial<ActiveDoTStack> = {}): ActiveDoTStack => ({
    stacks: 1,
    tier: 15,
    remainingRounds: 3,
    sourceId: 'caster',
    family: 'Acidic Decay',
    unremovable: true,
    ...overrides,
});

const plainCorrosion = (): ActiveDoTStack => ({
    stacks: 1,
    tier: 15,
    remainingRounds: 3,
    sourceId: 'caster',
});

// ---------------------------------------------------------------------------
// Enemy-side: hand-built enemy victim, real applyOutgoingToEnemy wrapper.
// ---------------------------------------------------------------------------

type ApplyOutgoing = (
    damage: number,
    enemyVictim: CombatActor
) => { shieldBefore: number; hpDamage: number; barriered: boolean };

const enemyVictim = (id: string, hp: number): CombatActor =>
    createActor({
        id,
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp,
            speed: 50,
        },
    });

const selfBuffSkills = (buffName: string): ShipSkills => ({
    slots: [
        {
            slot: 'passive',
            abilities: [
                {
                    id: `${buffName}-self`,
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName,
                        stacks: 1,
                        isStackable: false,
                        duration: 'recurring',
                        parsedEffects: {},
                    },
                },
            ],
        },
    ],
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyAttacker = (id: string, shipSkills?: ShipSkills): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    ...(shipSkills ? { shipSkills } : {}),
});

const enemyHealBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 10_000,
    healTargetId: 'attacker',
    ...overrides,
});

describe('Cheat-Death unremovable survival + family counting — enemy-side victim', () => {
    it('two Acidic Decay stacks survive the wipe; a plain corrosion + generic stack in the same arrays do not', () => {
        let wrapper: ApplyOutgoing | undefined;
        runCombat({
            ...enemyHealBase({
                enemyAttackers: [enemyAttacker('cdEnemy', selfBuffSkills('Cheat Death'))],
            }),
            __testTapApplyOutgoingToEnemy: (fn) => {
                wrapper ??= fn;
            },
        } as CombatEngineInput);
        if (!wrapper) throw new Error('test tap was never invoked');

        const victim = enemyVictim('cdEnemy', 2000);
        victim.corrosionEntries = [acidicDecay(), acidicDecay(), plainCorrosion()];
        victim.genericDoTEntries = [
            { stacks: 1, tier: 0, remainingRounds: 2, sourceId: 'caster', perTickAmount: 50 },
        ];

        wrapper(3000, victim); // lethal (2000 hp) → Cheat Death intercepts at 1 HP

        expect(victim.currentHp).toBe(1);
        expect(victim.destroyedRound).toBeUndefined();

        // The plain corrosion stack and the plain generic stack are wiped; the two
        // unremovable Acidic Decay stacks survive.
        expect(victim.corrosionEntries).toHaveLength(2);
        expect(victim.corrosionEntries.every((e) => e.family === 'Acidic Decay')).toBe(true);
        expect(victim.corrosionEntries.every((e) => e.unremovable)).toBe(true);
        expect(victim.genericDoTEntries).toHaveLength(0);

        // Countable under the exact key a named enemy-dot-count gate reads.
        expect(
            dotFamilyCounts(
                victim.corrosionEntries,
                victim.infernoEntries,
                victim.genericDoTEntries
            )
        ).toEqual({ 'Acidic Decay': 2 });
    });
});

// ---------------------------------------------------------------------------
// Player-side: live `attacker` CombatActor, seeded via __testTapActors, hit by a
// lethal manual enemy attacker in a real runCombat round.
// ---------------------------------------------------------------------------

type PlayerEnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const manualEnemy = (id: string, attack: number, speed = 50): PlayerEnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed },
    chargeCount: 0,
    startCharged: false,
});

const cheatDeathBuff = () => ({
    id: 'cheat-death',
    buffName: 'Cheat Death',
    stacks: 1,
    isStackable: false,
    parsedEffects: {},
});

const playerHealBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 2000, // enemy hits for 3000 → lethal in one hit → intercepted at 1 HP
    healTargetId: 'attacker',
    ...overrides,
});

describe('Cheat-Death unremovable survival + family counting — player-side victim (team symmetry)', () => {
    it('two Acidic Decay stacks on the tank survive the wipe; a plain corrosion stack does not', () => {
        const bus = createEventBus();
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        bus.on('cheat-death-activated', (e) => cheated.push(e));

        let tank: CombatActor | undefined;
        runCombat(
            playerHealBase({
                bus,
                selfBuffs: [cheatDeathBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
                __testTapActors: (actors) => {
                    tank = actors.find((a) => a.id === 'attacker');
                    if (tank) {
                        tank.corrosionEntries = [acidicDecay(), acidicDecay(), plainCorrosion()];
                    }
                },
            })
        );

        if (!tank) throw new Error('__testTapActors never handed out the attacker actor');

        expect(cheated).toHaveLength(1);
        expect(tank.currentHp).toBe(1);
        expect(tank.destroyedRound).toBeUndefined();

        expect(tank.corrosionEntries).toHaveLength(2);
        expect(tank.corrosionEntries.every((e) => e.family === 'Acidic Decay')).toBe(true);
        expect(tank.corrosionEntries.every((e) => e.unremovable)).toBe(true);

        expect(
            dotFamilyCounts(tank.corrosionEntries, tank.infernoEntries, tank.genericDoTEntries)
        ).toEqual({ 'Acidic Decay': 2 });
    });
});
