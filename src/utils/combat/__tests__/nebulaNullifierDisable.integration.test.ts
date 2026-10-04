/**
 * Nebula Nullifier — "Decrease damage by 35% when directly damaged while under Stasis or Disable."
 *
 * Every rarity's text names BOTH control states, so the reduction must apply while the carrier is
 * Disabled exactly as it does while it is Stasised. Driven through the real placement path
 * (`simulateBattle(input, getGearPiece)` → `buildEquipmentAbilities`) with a real implant piece,
 * and measured with the carrier as the player focus, as a non-first player slot, and as an enemy.
 *
 * Board: one hitter (5,000 attack, no crit, hacking far above the carrier's security so every
 * control lands) whose active skill "deals 100% damage and inflicts <X> for 3 turns" on the front
 * enemy, against a carrier with zero defence. Round 1's hit lands BEFORE the control is inflicted,
 * so it is always the full 5,000; rounds 2 and 3 are taken while the control is up.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

const HIT = 5000;

const makeShip = (id: string, name: string, over: Partial<Ship> = {}): Ship => ({
    id,
    name,
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
    activeSkillText: 'This Unit deals <unit-damage>1% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    ...over,
});

const placement = (
    ship: Ship,
    position: BattlePlacement['position'],
    stats: { attack: number; hp: number; speed: number; hacking: number; security: number }
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: stats.attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: stats.hacking,
        security: stats.security,
        defence: 0,
        hp: stats.hp,
        speed: stats.speed,
    },
});

const nebulaPiece = (rarity: string): GearPiece =>
    ({ id: `nebula-${rarity}`, setBonus: 'NEBULA_NULLIFIER', rarity }) as unknown as GearPiece;
const getGearPiece = (id: string): GearPiece | undefined =>
    id.startsWith('nebula-') ? nebulaPiece(id.slice('nebula-'.length)) : undefined;

type Control = 'none' | 'Stasis' | 'Disable';
type Placement = 'focus' | 'team' | 'enemy';

const hitterText = (control: Control): string =>
    control === 'none'
        ? 'This Unit deals <unit-damage>100% damage</unit-damage>.'
        : `This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>${control}</unit-skill> for 3 turns.`;

/** HP damage the carrier took per round (rounds 1..3); the hitter is its only attacker. */
function carrierHits(control: Control, where: Placement, withImplant: boolean): number[] {
    const carrier = makeShip('carrier', 'Carrier', {
        implants: withImplant ? { implant_ultimate: 'nebula-legendary' } : {},
    });
    const hitter = makeShip('hitter', 'Hitter', { activeSkillText: hitterText(control) });
    // Back-row filler: never the hitter's `front` target, so the carrier always takes the hit.
    const filler = makeShip('filler', 'Filler');

    const carrierP = placement(carrier, 'M4', {
        attack: 1,
        hp: 1_000_000,
        speed: 10,
        hacking: 0,
        security: 0,
    });
    const hitterP = placement(hitter, 'M4', {
        attack: HIT,
        hp: 1_000_000_000,
        speed: 1000,
        hacking: 10_000,
        security: 0,
    });
    const fillerP = placement(filler, 'M1', {
        attack: 1,
        hp: 1_000_000,
        speed: 5,
        hacking: 0,
        security: 0,
    });

    const input =
        where === 'focus'
            ? { playerTeam: [carrierP], enemyTeam: [hitterP], rounds: 3 }
            : where === 'team'
              ? { playerTeam: [fillerP, carrierP], enemyTeam: [hitterP], rounds: 3 }
              : { playerTeam: [hitterP], enemyTeam: [carrierP], rounds: 3 };
    const result = simulateBattle(input, getGearPiece);

    const carrierId =
        where === 'focus' ? 'attacker' : where === 'team' ? 'p:carrier:1' : 'e:carrier:0';
    expect(result.roster.some((r) => r.actorId === carrierId)).toBe(true);

    // The HP damage that actually LANDED on the carrier each round (the engine's per-victim
    // intake bucket), so the reduction is read where it applies rather than off a log row.
    return [1, 2, 3].map((round) => {
        const row = result.rounds
            .find((r) => r.round === round)
            ?.ships.find((x) => x.actorId === carrierId);
        if (!row) throw new Error(`no round-${round} row for ${carrierId}`);
        return row.incomingDamage;
    });
}

describe('Nebula Nullifier — the reduction holds under Stasis OR Disable, both sides', () => {
    const placements: Placement[] = ['focus', 'team', 'enemy'];

    for (const where of placements) {
        describe(`carrier as ${where}`, () => {
            it('negative control: no control on the carrier → every hit lands at full', () => {
                expect(carrierHits('none', where, true)).toEqual([HIT, HIT, HIT]);
            });

            it('no implant: Stasis and Disable change nothing', () => {
                expect(carrierHits('Stasis', where, false)).toEqual([HIT, HIT, HIT]);
                expect(carrierHits('Disable', where, false)).toEqual([HIT, HIT, HIT]);
            });

            it('positive control: Stasised carrier takes 35% less from round 2 on', () => {
                expect(carrierHits('Stasis', where, true)).toEqual([HIT, HIT * 0.65, HIT * 0.65]);
            });

            it('Disabled carrier takes 35% less from round 2 on', () => {
                expect(carrierHits('Disable', where, true)).toEqual([HIT, HIT * 0.65, HIT * 0.65]);
            });
        });
    }
});
