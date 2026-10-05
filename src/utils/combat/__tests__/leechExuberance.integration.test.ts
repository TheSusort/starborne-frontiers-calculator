/**
 * Exuberance on a LEECH repair.
 *
 *   Exuberance (legendary): "When repaired, there is a 30% chance to increase that repair by 15%."
 *
 * A leech self-repair IS a repair (heal-channel ruling 4: incoming-repair modifiers apply; #447: a
 * leech is a full heal), so the Leech gear set's repair must roll Exuberance exactly as a cast
 * repair does. Driven through the real placement path (`simulateBattle(input, getGearPiece)` →
 * `buildEquipmentAbilities`) with a real 2-piece Leech set and a real Exuberance implant, with the
 * carrier as the player focus, as a non-first player slot, and on the enemy side.
 *
 * Board: the carrier hits a zero-defence dummy for exactly 10,000 a round (crit 0), so every leech
 * is 15% of that = 1,500, and an Exuberance proc makes it 1,725. Repairs are read GROSS
 * (`amount + overheal`) from the combat log's heal rows onto the carrier, over many seeds.
 *
 * The positive control is a hand-built CAST repair of the same size ("deals 100% damage and
 * repairs 15% of the damage dealt"), which already rolled Exuberance — it proves this board can
 * observe a 1,725 at all.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

const HIT = 10_000;
const LEECH = HIT * 0.15; // 1,500
const BOOSTED = Math.round(LEECH * 1.15); // 1,725
const SEEDS = 30;

const makeShip = (id: string, activeSkillText: string, over: Partial<Ship> = {}): Ship => ({
    id,
    name: id,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'ATTACKER',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText,
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    ...over,
});

const placement = (
    ship: Ship,
    position: BattlePlacement['position'],
    stats: { attack: number; hp: number; speed: number }
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: stats.attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 0,
        security: 0,
        defence: 0,
        hp: stats.hp,
        speed: stats.speed,
    },
});

const PIECES: Record<string, { setBonus: string; rarity: string }> = {
    'leech-a': { setBonus: 'LEECH', rarity: 'legendary' },
    'leech-b': { setBonus: 'LEECH', rarity: 'legendary' },
    exuberance: { setBonus: 'EXUBERANCE', rarity: 'legendary' },
};
const getGearPiece = (id: string): GearPiece | undefined =>
    PIECES[id] ? ({ id, ...PIECES[id] } as unknown as GearPiece) : undefined;

type Where = 'focus' | 'team' | 'enemy';
type Source = 'leech-set' | 'cast-repair';

const PLAIN_HIT = 'This Unit deals <unit-damage>100% damage</unit-damage>.';
const CAST_REPAIR =
    'This Unit deals <unit-damage>100% damage</unit-damage> and <unit-damage>repairs 15%</unit-damage> of the damage dealt.';

/** Every distinct gross repair the carrier landed on itself, across SEEDS seeded 3-round fights. */
function carrierRepairs(where: Where, source: Source, withExuberance: boolean): number[] {
    const seen = new Set<number>();
    let count = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
        setupKeyedRng(seed);
        const carrier = makeShip('carrier', source === 'leech-set' ? PLAIN_HIT : CAST_REPAIR, {
            equipment: source === 'leech-set' ? { weapon: 'leech-a', hull: 'leech-b' } : {},
            implants: withExuberance ? { implant_major: 'exuberance' } : {},
        });
        // Nothing hits the carrier, so every repair over-heals; that is why it is read GROSS.
        const carrierP = placement(carrier, 'M4', { attack: HIT, hp: 1_000_000, speed: 100 });
        const dummyP = placement(makeShip('dummy', PLAIN_HIT), 'M4', {
            attack: 0,
            hp: 1_000_000_000,
            speed: 10,
        });
        const fillerP = placement(makeShip('filler', PLAIN_HIT), 'M1', {
            attack: 0,
            hp: 1_000_000,
            speed: 5,
        });

        const input =
            where === 'focus'
                ? { playerTeam: [carrierP], enemyTeam: [dummyP], rounds: 3 }
                : where === 'team'
                  ? { playerTeam: [fillerP, carrierP], enemyTeam: [dummyP], rounds: 3 }
                  : { playerTeam: [dummyP], enemyTeam: [carrierP], rounds: 3 };
        const result = simulateBattle(input, getGearPiece);

        const carrierId =
            where === 'focus' ? 'attacker' : where === 'team' ? 'p:carrier:1' : 'e:carrier:0';
        const repairs = flattenCombatLog(result)
            .filter((e) => e.kind === 'heal' && e.actorId === carrierId)
            .flatMap((e) => e.targets)
            .filter((t) => t.targetId === carrierId)
            .map((t) => Math.round((t.amount ?? 0) + (t.overheal ?? 0)));
        // One repair per round: the board really leeched (or cast-repaired) every round.
        expect(repairs).toHaveLength(3);
        count += repairs.length;
        for (const r of repairs) seen.add(r);
    }
    expect(count).toBe(SEEDS * 3);
    return [...seen].sort((a, b) => a - b);
}

describe('Exuberance raises a leech repair (heal ruling 4)', () => {
    for (const where of ['focus', 'team', 'enemy'] as const) {
        describe(`carrier as ${where}`, () => {
            it('positive control: a cast repair already rolls Exuberance (1,500 or 1,725)', () => {
                expect(carrierRepairs(where, 'cast-repair', true)).toEqual([LEECH, BOOSTED]);
            });

            it('negative control: the Leech set without Exuberance always repairs 1,500', () => {
                expect(carrierRepairs(where, 'leech-set', false)).toEqual([LEECH]);
            });

            it('the Leech set with Exuberance repairs 1,500 or 1,725', () => {
                expect(carrierRepairs(where, 'leech-set', true)).toEqual([LEECH, BOOSTED]);
            });
        });
    }
});
