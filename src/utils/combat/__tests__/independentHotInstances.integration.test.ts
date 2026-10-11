/**
 * Every heal-over-time grant is its own copy with its own timer, like Corrosion: nothing refreshes,
 * overwrites or shadows another copy, whether the same healer re-grants it or a different tier
 * lands beside it (owner ruling 2026-10-11, #670). Power Infused Nanobots is the one other buff
 * that stacks the same way. Every other buff keeps highest-tier-wins with same-tier refresh.
 *
 * The board: a 100,000-HP tank at M4 behind two healers whose active grants Repair Over Time to
 * all allies for 2 turns. Both healers act before the enemy, the enemy acts before the tank, so
 * each tank turn ticks every copy it holds against a fresh wound. A tick is the holder's max HP
 * times the tier's percentage (II: 15,000) and `hot-ticked` fires only for HP actually restored,
 * so the enemy's 40,000-damage hit leaves room for every live copy's tick (at most 30,000) to
 * land and be counted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CombatEvent } from '../events';
import { setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import { createStatusEngine, type RegisteredAbilityStatus } from '../statusEngine';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

const tap = vi.hoisted(() => ({ recorded: [] as CombatEvent[], buses: 0 }));
vi.mock('../events', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../events')>();
    return {
        ...mod,
        createEventBus: () => {
            const bus = mod.createEventBus();
            // simulateBattle builds a second bus for a duplicate run; only the first is counted.
            if (tap.buses++ > 0) return bus;
            const emit = bus.emit.bind(bus);
            bus.emit = (e) => {
                tap.recorded.push(e);
                emit(e);
            };
            return bus;
        },
    };
});

beforeEach(() => {
    setRateGateRng(() => 0.999999);
    tap.recorded = [];
    tap.buses = 0;
});
afterEach(() => resetRateGateRng());

const BASIC_ACTIVE = 'This Unit deals <unit-damage>100% damage</unit-damage>.';
const rot = (tier: 'I' | 'II' | 'III') =>
    `This Unit grants <unit-skill>Repair Over Time ${tier}</unit-skill> to all allies for 2 turns.`;

const ship = (
    id: string,
    o: { attack?: number; hp: number; speed: number; activeSkillText: string; target: string }
): Ship => ({
    id,
    name: id,
    rarity: 'legendary',
    faction: 'MPL',
    type: 'SUPPORTER',
    baseStats: {
        hp: o.hp,
        attack: o.attack ?? 1000,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: o.speed,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: o.activeSkillText,
    activeTarget: o.target,
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
});

const at = (s: Ship, position: Position): BattlePlacement => ({
    ship: s,
    position,
    statOverrides: {
        attack: s.baseStats.attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: s.baseStats.hacking,
        defence: s.baseStats.defence,
        hp: s.baseStats.hp,
        speed: s.baseStats.speed,
    },
});

const TANK = at(
    ship('tank', { hp: 100_000, speed: 50, activeSkillText: BASIC_ACTIVE, target: 'front' }),
    'M4'
);
const healer = (id: string, speed: number, tier: 'I' | 'II' | 'III', position: Position) =>
    at(ship(id, { hp: 100_000, speed, activeSkillText: rot(tier), target: 'self' }), position);
const ENEMY = at(
    ship('enemy', {
        attack: 40_000,
        hp: 1e7,
        speed: 80,
        activeSkillText: BASIC_ACTIVE,
        target: 'front',
    }),
    'T1'
);
const HEAL_A = 'p:healA:1';
const HEAL_B = 'p:healB:2';

type Tick = Extract<CombatEvent, { type: 'hot-ticked' }>;
const ticksOn = (holderId: string): Tick[] =>
    tap.recorded.filter((e): e is Tick => e.type === 'hot-ticked' && e.holderId === holderId);
const tankTicks = (placements: BattlePlacement[], rounds: number): Tick[] => {
    simulateBattle({ playerTeam: [TANK, ...placements], enemyTeam: [ENEMY], rounds });
    return ticksOn('attacker');
};
const inRound = (ticks: Tick[], r: number) => ticks.filter((t) => t.round === r);

describe('#670 Repair Over Time copies stack independently', () => {
    it('two healers: the tank ticks once per applier per turn, each credited to its own healer', () => {
        const ticks = tankTicks(
            [healer('healA', 120, 'II', 'M3'), healer('healB', 110, 'II', 'M2')],
            1
        );
        expect(ticks.map((t) => [t.applierId, t.amount]).sort()).toEqual(
            [
                [HEAL_A, 15_000],
                [HEAL_B, 15_000],
            ].sort()
        );
    });

    it('enemy side: an enemy tank ticks once per enemy healer per turn', () => {
        // The same board mirrored: the player's lone attacker wounds the enemy tank.
        simulateBattle({
            playerTeam: [ENEMY],
            enemyTeam: [TANK, healer('healA', 120, 'II', 'M3'), healer('healB', 110, 'II', 'M2')],
            rounds: 1,
        });
        expect(
            ticksOn('e:tank:0')
                .map((t) => t.applierId)
                .sort()
        ).toEqual(['e:healA:1', 'e:healB:2']);
    });

    it('one healer re-granting a 2-turn copy every turn holds two copies from round 2', () => {
        const ticks = tankTicks([healer('healA', 120, 'II', 'M3')], 3);
        expect(inRound(ticks, 1)).toHaveLength(1);
        expect(inRound(ticks, 2)).toHaveLength(2);
        expect(inRound(ticks, 3)).toHaveLength(2);
        expect(ticks.every((t) => t.applierId === HEAL_A)).toBe(true);
    });

    it('Repair Over Time I and III coexist on one holder', () => {
        const ticks = tankTicks(
            [healer('healA', 120, 'I', 'M3'), healer('healB', 110, 'III', 'M2')],
            1
        );
        // I is 10% of the tank's 100,000 max HP, III is 20%: both copies tick.
        expect(ticks.map((t) => [t.applierId, t.amount]).sort()).toEqual(
            [
                [HEAL_A, 10_000],
                [HEAL_B, 20_000],
            ].sort()
        );
    });
});

const timed = (
    buffName: string,
    duration: number,
    over: Partial<Extract<RegisteredAbilityStatus, { kind: 'timed' }>> = {}
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    payload: { buffName, stacks: 1, parsedEffects: {} },
    side: 'self',
    sourceSlot: 'active',
    conditions: [],
    kind: 'timed',
    duration,
    ...over,
});

describe('#670 the status store: independent instances versus the family rule', () => {
    it('two Power Infused Nanobots grants are two copies, each with its own value', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        const nanobots = (casterId: string, attackFlat: number) =>
            timed('Power Infused Nanobots', 2, {
                casterId,
                payload: {
                    buffName: 'Power Infused Nanobots',
                    stacks: 1,
                    parsedEffects: { attackFlat },
                },
            });
        eng.applyTimedAbilityStatus(1, nanobots('a', 300), 'x');
        eng.applyTimedAbilityStatus(1, nanobots('b', 500), 'x');
        const held = eng.timedAbilityStatuses('self', 'x');
        expect(held).toHaveLength(2);
        expect(held.map((s) => s.payload.parsedEffects.attackFlat).sort()).toEqual([300, 500]);
    });

    it('a stolen Repair Over Time lands beside the copy the thief already holds', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(
            1,
            timed('Repair Over Time II', 3, { casterId: 'a' }),
            'victim'
        );
        eng.applyTimedAbilityStatus(1, timed('Repair Over Time II', 3, { casterId: 'b' }), 'thief');
        expect(eng.steal('victim', ['thief'], 1)).toEqual(['Repair Over Time II']);
        expect(
            eng
                .timedAbilityStatuses('self', 'thief')
                .map((s) => s.casterId)
                .sort()
        ).toEqual(['a', 'b']);
    });

    it('removing Repair Over Time by name removes every copy of it', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed('Repair Over Time I', 2, { casterId: 'a' }), 'x');
        eng.applyTimedAbilityStatus(1, timed('Repair Over Time III', 2, { casterId: 'b' }), 'x');
        eng.applyTimedAbilityStatus(1, timed('Attack Up II', 2, { casterId: 'a' }), 'x');
        eng.removeSelfBuffByName('x', 'Repair Over Time II');
        expect(eng.timedAbilityStatuses('self', 'x').map((s) => s.active.buffName)).toEqual([
            'Attack Up II',
        ]);
    });

    it('a re-applied Attack Up II still refreshes (family rule unchanged for non-independent buffs)', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.beginRound(1);
        eng.applyTimedAbilityStatus(1, timed('Attack Up II', 2, { casterId: 'a' }), 'x');
        eng.applyTimedAbilityStatus(1, timed('Attack Up II', 2, { casterId: 'b' }), 'x');
        const held = eng.timedAbilityStatuses('self', 'x');
        expect(held).toHaveLength(1);
        expect(held[0].casterId).toBe('b');
    });
});
