/**
 * DoT damage composition, owner-measured in game (2026-10-14):
 *
 *  1. The dealer's DoT-damage buffs and the victim's are SEPARATE factors:
 *       tick = base × (1 + outgoing%) × (1 + incoming%).
 *     Ripper (attack 14,731 × Marauder Rage II) Inferno I ticked 2,652; with Out. DoT Damage Up II
 *     on Ripper and Inc. DoT Damage Up II on the Warden it ticked 3,818 = 2,652 × 1.2 × 1.2
 *     (a sum would give 3,712).
 *  2. A DoT tick gets no affinity bonus: electric Ripper's Inferno I on a thermal Warden ticked
 *     2,210 = 14,731 × 15%.
 *  3. A Bomb gets no affinity bonus: electric Lingshe (attack 12,897.18) Bomb I burst for 12,897
 *     on a thermal Warden.
 *  4. A detonated Inferno/Corrosion follows the tick: no affinity, and the same two factors.
 *
 * Every board below puts an ELECTRIC dealer against THERMAL victims (a real +25% matchup, which
 * still applies to direct hits), so a factor of 1.25 anywhere in a DoT, Bomb or detonation shows.
 * With attack 1000, one tier-15 Inferno stack ticks 150 at base.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, AbilityTarget, ShipSkills } from '../../../types/abilities';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack, CombatActor } from '../state';

beforeEach(() => {
    setupKeyedRng(20261014);
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type Slot = ShipSkills['slots'][number];

const HP = 1e9;
const ATTACK = 1000;
const BASE_TICK = 150; // 1 stack x tier 15 x attack 1000
const ADVANTAGE = 25;

let idc = 0;
const ab = (p: Pick<Ability, 'type' | 'config'> & { target?: AbilityTarget }): Ability => ({
    id: `dot-composition-${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const pick = (buffName: string, parsedEffects: SelectedGameBuff['parsedEffects']) =>
    ({
        id: buffName,
        buffName,
        stacks: 1,
        parsedEffects,
        isStackable: false,
    }) satisfies SelectedGameBuff;

/** Scheduled picks: Out. DoT Damage Up II on the dealer, Inc. DoT Damage Up II on the enemy. */
const OUT_DOT_UP_II = pick('Out. DoT Damage Up II', { dotDamage: 20 });
const INC_DOT_UP_II = pick('Inc. DoT Damage Up II', { incomingDotDamage: 20 });

/** A timed, ability-inflicted Inc. DoT Damage Up II (the per-victim live channel). */
const incDotUpTimed = (duration: number): Ability =>
    ab({
        type: 'debuff',
        config: {
            type: 'debuff',
            buffName: 'Inc. DoT Damage Up II',
            parsedEffects: { incomingDotDamage: 20 },
            stacks: 1,
            isStackable: false,
            application: 'inflict',
            duration,
        },
    });

/** A self-granted Out. DoT Damage Up II (the ability self-buff channel). */
const outDotUpSelf = (): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        config: {
            type: 'buff',
            buffName: 'Out. DoT Damage Up II',
            parsedEffects: { dotDamage: 20 },
            stacks: 1,
            isStackable: false,
            duration: 9,
        },
    });

const inferno = (): Ability =>
    ab({
        type: 'dot',
        config: { type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 5 },
    });

const bomb = (): Ability =>
    ab({
        type: 'dot',
        config: { type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 1 },
    });

const detonateInferno = (): Ability[] => [
    ab({ type: 'damage', config: { type: 'damage', multiplier: 1 } }),
    ab({
        type: 'detonate-dot',
        config: { type: 'detonate-dot', dotType: 'inferno', powerPct: 100 },
    }),
];

const EMPTY_ACTIVE: Slot = { slot: 'active', abilities: [] };
const chargedOnce = (abilities: Ability[]): ShipSkills => ({
    slots: [EMPTY_ACTIVE, { slot: 'charged', abilities }],
});

const offenceStats = {
    attack: ATTACK,
    crit: 0,
    critDamage: 0,
    defence: 0,
    hp: HP,
    security: 0,
    hacking: 1e6,
};

const enemyShip = (
    id: string,
    position: Position,
    speed: number,
    over: Partial<EnemyAttacker> = {}
): EnemyAttacker => ({
    id,
    stats: { ...offenceStats, speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [EMPTY_ACTIVE] },
    affinity: 'thermal',
    affinityDamageModifier: 0,
    ...over,
});

/** The focus: an electric dealer facing thermal enemies, its matchup pre-resolved at +25%. */
const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [enemyShip('enemy-a', 'M4', 50), enemyShip('enemy-b', 'M3', 50)],
    attack: ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 9,
    shipSkills: chargedOnce([inferno()]),
    numRounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: true,
    startCharged: true,
    affinity: 'electric',
    affinityDamageModifier: ADVANTAGE,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HP,
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const ticks: Record<string, Record<number, number>> = {};
    const detonations: Record<string, number> = {};
    const bombs: Record<string, number> = {};
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.dotType !== 'inferno') return;
        (ticks[e.targetId] ??= {})[e.round] = (ticks[e.targetId]?.[e.round] ?? 0) + e.damage;
    });
    bus.on('dot-detonated', (e: Extract<CombatEvent, { type: 'dot-detonated' }>) => {
        detonations[e.targetId] = (detonations[e.targetId] ?? 0) + e.damage;
    });
    bus.on('bomb-detonated', (e: Extract<CombatEvent, { type: 'bomb-detonated' }>) => {
        const victim = e.victimId ?? '?';
        bombs[victim] = (bombs[victim] ?? 0) + e.damage;
    });
    runCombat({ ...input, bus });
    return { ticks, detonations, bombs };
};

const seededInferno = (remainingRounds: number): ActiveDoTStack => ({
    tier: 15,
    stacks: 1,
    remainingRounds,
    sourceId: 'attacker',
});
const seedOnBothEnemies =
    (remainingRounds: number) =>
    (actors: CombatActor[]): void => {
        for (const id of ['enemy-a', 'enemy-b']) {
            actors.find((a) => a.id === id)?.infernoEntries.push(seededInferno(remainingRounds));
        }
    };

describe('DoT ticks: dealer and victim DoT buffs multiply; no affinity', () => {
    it('an electric dealer’s Inferno on a thermal victim ticks attack × tier, no affinity', () => {
        const { ticks } = run(base({}));
        expect(ticks['enemy-a'][1]).toBeCloseTo(BASE_TICK, 6);
        expect(ticks['enemy-a'][2]).toBeCloseTo(BASE_TICK, 6);
    });

    it('Out. DoT Damage Up II with a picked Inc. DoT Damage Up II ticks base × 1.2 × 1.2', () => {
        const { ticks } = run(base({ selfBuffs: [OUT_DOT_UP_II], enemyDebuffs: [INC_DOT_UP_II] }));
        expect(ticks['enemy-a'][1]).toBeCloseTo(BASE_TICK * 1.2 * 1.2, 6);
    });

    it('Out. DoT Damage Up II with an inflicted Inc. DoT Damage Up II ticks base × 1.2 × 1.2', () => {
        const { ticks } = run(
            base({
                selfBuffs: [OUT_DOT_UP_II],
                shipSkills: chargedOnce([incDotUpTimed(3), inferno()]),
            })
        );
        expect(ticks['enemy-a'][1]).toBeCloseTo(BASE_TICK * 1.2 * 1.2, 6);
    });

    it('the same holds for an enemy dealer’s Inferno on a player ship', () => {
        // Mirror board: an electric enemy grants itself Out. DoT Damage Up II, Infernos the thermal
        // focus and inflicts Inc. DoT Damage Up II on it.
        const { ticks } = run(
            base({
                attack: 0,
                speed: 50,
                affinity: 'thermal',
                affinityDamageModifier: 0,
                hasChargedSkill: false,
                startCharged: false,
                shipSkills: { slots: [EMPTY_ACTIVE] },
                enemyAttackers: [
                    enemyShip('enemy-caster', 'M4', 100, {
                        affinity: 'electric',
                        affinityDamageModifier: ADVANTAGE,
                        chargeCount: 9,
                        startCharged: true,
                        shipSkills: chargedOnce([outDotUpSelf(), incDotUpTimed(3), inferno()]),
                    }),
                ],
            })
        );
        expect(ticks['attacker'][1]).toBeCloseTo(BASE_TICK * 1.2 * 1.2, 6);
    });
});

describe('Bombs: no affinity', () => {
    it('an electric dealer’s Bomb bursts on a thermal victim for attack × tier', () => {
        const { bombs } = run(base({ shipSkills: chargedOnce([bomb()]) }));
        expect(bombs['enemy-a']).toBeCloseTo(ATTACK, 6);
    });

    it('the same holds for an enemy dealer’s Bomb on a player ship', () => {
        const { bombs } = run(
            base({
                attack: 0,
                speed: 50,
                affinity: 'thermal',
                affinityDamageModifier: 0,
                hasChargedSkill: false,
                startCharged: false,
                shipSkills: { slots: [EMPTY_ACTIVE] },
                enemyAttackers: [
                    enemyShip('enemy-caster', 'M4', 100, {
                        affinity: 'electric',
                        affinityDamageModifier: ADVANTAGE,
                        chargeCount: 9,
                        startCharged: true,
                        shipSkills: chargedOnce([bomb()]),
                    }),
                ],
            })
        );
        expect(bombs['attacker']).toBeCloseTo(ATTACK, 6);
    });
});

describe('Detonations: no affinity; dealer and victim DoT buffs multiply', () => {
    // A seeded Inferno with 2 rounds left detonates for 1 × 0.15 × 1000 × 2 = 300 at base.
    const DET_BASE = 300;

    it('a single-target detonation', () => {
        const { detonations } = run(
            base({
                numRounds: 1,
                selfBuffs: [OUT_DOT_UP_II],
                enemyDebuffs: [INC_DOT_UP_II],
                shipSkills: chargedOnce(detonateInferno()),
                __testTapActors: seedOnBothEnemies(2),
            })
        );
        expect(detonations['enemy-a']).toBeCloseTo(DET_BASE * 1.2 * 1.2, 6);
    });

    it('a footprint detonation: each victim’s inflicted Inc. DoT Damage Up multiplies', () => {
        const { detonations } = run(
            base({
                numRounds: 1,
                selfBuffs: [OUT_DOT_UP_II],
                shipSkills: chargedOnce([incDotUpTimed(3), ...detonateInferno()]),
                pattern: parsePattern('Pattern-Line-Range-1'),
                __testTapActors: seedOnBothEnemies(2),
            })
        );
        expect(detonations['enemy-a']).toBeCloseTo(DET_BASE * 1.2 * 1.2, 6);
        expect(detonations['enemy-b']).toBeCloseTo(DET_BASE * 1.2 * 1.2, 6);
    });
});
