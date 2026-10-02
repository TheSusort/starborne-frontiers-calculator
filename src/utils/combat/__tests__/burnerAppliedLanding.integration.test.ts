/**
 * An APPLIED DoT lands the way an applied timed debuff does (owner ruling, 2026-10-01: INFLICT is
 * gated by the hacking-vs-security roll, APPLY only by the affinity check). The Burner gear set's
 * "Applies Inferno 1 for 2 turns." is the one apply-worded DoT: it lands against any security, and
 * fails only when its wearer is at an affinity disadvantage against the target.
 *
 * Every board pairs Burner's Inferno with the cast's own INFLICTED debuff (Seed Down) on the same
 * target, so the board is shown to defeat — or to allow — a hacking roll in the same fight.
 * Real engine (runCombat), real 4-piece Burner (buildEquipmentAbilities).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { AffinityName, Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const burner = (): Ability[] => {
    const gear: Record<string, string> = {};
    const pieces: Record<string, GearPiece> = {};
    (['weapon', 'hull', 'generator', 'sensor'] as const).forEach((slot, i) => {
        gear[slot] = `burn-${i}`;
        pieces[`burn-${i}`] = {
            id: `burn-${i}`,
            slot,
            rarity: 'legendary',
            setBonus: 'BURNER',
        } as GearPiece;
    });
    const built = buildEquipmentAbilities(
        { implants: {}, equipment: gear } as unknown as Ship,
        (id) => pieces[id]
    );
    if (!built.some((a) => a.config.type === 'dot')) throw new Error('Burner missing');
    return built;
};

const kit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100, hits: 1 },
                },
                {
                    id: 'seed',
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Seed Down',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        application: 'inflict',
                        duration: 2,
                    },
                },
            ],
        },
        { slot: 'passive', abilities: burner() },
    ],
});

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** An enemy that never acts; `security` decides an inflict roll against it. */
const inert = (security: number, affinity?: AffinityName): EnemyAttacker => ({
    id: 'foe',
    stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1e12, speed: 1, security },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    ...(affinity ? { affinity } : {}),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [inert(0)],
    attack: 100,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: kit(),
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
    hp: 1e12,
    hacking: 200,
    speed: 100,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: frontTarget(),
    pattern: basePattern(),
    ...over,
});

/** The Burner wearer on the ENEMY side, acting first against the player. */
const enemyWearer = (affinity?: AffinityName): EnemyAttacker => ({
    id: 'wearer',
    stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 1e12, speed: 200, hacking: 200 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    ...(affinity ? { affinity } : {}),
    target: frontTarget(),
    pattern: basePattern(),
    shipSkills: kit(),
});
const enemyBoard = (security: number, wearer: AffinityName | undefined, player?: AffinityName) =>
    BASE({
        attack: 0,
        speed: 1,
        security,
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
        ...(player ? { affinity: player } : {}),
        enemyAttackers: [enemyWearer(wearer)],
    });

/** What the wearer (`sourceId`) landed: its inflicted Seed Down and Burner's Inferno. */
const run = (input: CombatEngineInput, sourceId = 'attacker') => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['debuff-applied', 'dot-applied'] as const)
        bus.on(type, (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return {
        seed: events.filter(
            (e) =>
                e.type === 'debuff-applied' && e.sourceId === sourceId && e.buffName === 'Seed Down'
        ).length,
        inferno: events.filter(
            (e) => e.type === 'dot-applied' && e.sourceId === sourceId && e.dotType === 'inferno'
        ).length,
    };
};

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Burner — its applied Inferno lands on the affinity check alone', () => {
    it('player side: security that resists the inflicted debuff does not stop the Inferno', () => {
        expect(run(BASE({ enemyAttackers: [inert(1e9)] }))).toEqual({ seed: 0, inferno: 1 });
        expect(run(BASE({ enemyAttackers: [inert(0)] }))).toEqual({ seed: 1, inferno: 1 });
    });

    it('player side: an affinity disadvantage stops the Inferno; the inflicted debuff still lands', () => {
        // Thermal holds the advantage over chemical: the chemical wearer is at a disadvantage.
        expect(run(BASE({ affinity: 'chemical', enemyAttackers: [inert(0, 'thermal')] }))).toEqual({
            seed: 1,
            inferno: 0,
        });
        expect(run(BASE({ affinity: 'thermal', enemyAttackers: [inert(0, 'chemical')] }))).toEqual({
            seed: 1,
            inferno: 1,
        });
    });

    it('enemy side: the same, against the player', () => {
        expect(run(enemyBoard(1e9, undefined), 'wearer')).toEqual({ seed: 0, inferno: 1 });
        expect(run(enemyBoard(0, undefined), 'wearer')).toEqual({ seed: 1, inferno: 1 });
        expect(run(enemyBoard(0, 'chemical', 'thermal'), 'wearer')).toEqual({
            seed: 1,
            inferno: 0,
        });
        expect(run(enemyBoard(0, 'thermal', 'chemical'), 'wearer')).toEqual({
            seed: 1,
            inferno: 1,
        });
    });
});
