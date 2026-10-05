/**
 * Nourishment / Vivacious Repair on a PASSIVE (reactive) repair.
 *
 *   Nourishment:      "Increases repair by 30% when targeting an ally with lower HP."
 *   Vivacious Repair: "When repairing an ally with less than 25% HP, there is a 32% chance to
 *                      double the amount of repair."
 *
 * Neither text limits itself to skill casts, so a passive repair onto an ally is boosted the same
 * way a cast repair is. Subject: the REAL Cultivator kit (refit 4), whose refit-active passive
 * reads "when an ally is directly damaged within the active pattern, this Unit repairs that ally
 * for 8% of this Unit's max HP". Driven through `simulateBattle(input, getGearPiece)` with real
 * implant pieces resolved by `buildEquipmentAbilities`, with Cultivator as the player focus, as a
 * non-first player slot, and on the enemy side.
 *
 * Board: Cultivator (1,000,000 max HP → an 80,000 repair) at M3, a 10,000,000-HP ally at M4 in her
 * footprint, and a hitter whose single-target attack strikes the ally (front) each round. Repairs
 * are read GROSS (`amount + overheal`) from the combat log's heal rows onto the ally.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

const CULTIVATOR_HP = 1_000_000;
const BASE_REPAIR = CULTIVATOR_HP * 0.08; // 80,000
const ALLY_HP = 10_000_000;

/** The real Cultivator, refit 4. Throws rather than degrading: `docs/` is gitignored reference
 *  data, and a silent fallback kit would stop testing what this file claims to. */
function realCultivator(implant: string | undefined): Ship {
    const ship = buildTraceShip('Cultivator', { refitLevel: 4 });
    if (!ship) {
        throw new Error(
            'reactiveRepairHealAmp: Cultivator did not resolve — docs/ship-skills.csv / ' +
                'docs/ship-data.json are gitignored reference data expected on dev machines.'
        );
    }
    return { ...ship, id: 'cultivator', implants: implant ? { implant_major: implant } : {} };
}

const plainShip = (id: string, name: string, activeSkillText: string): Ship => ({
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
    activeSkillText,
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
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

const implantPiece = (id: string): GearPiece | undefined => {
    const [setBonus, rarity] = id.split('@');
    return setBonus && rarity ? ({ id, setBonus, rarity } as unknown as GearPiece) : undefined;
};

type Where = 'focus' | 'team' | 'enemy';

/** Gross repairs Cultivator landed on the ally, per round (rounds 1..3, one list per round). */
function allyRepairs(opts: {
    where: Where;
    implant?: string;
    hitPerRound: number;
    /** The hitter strikes the WHOLE opposing side, Cultivator included, instead of the ally. */
    hitEveryone?: boolean;
    seed?: number;
}): number[][] {
    if (opts.seed !== undefined) setupKeyedRng(opts.seed);
    const cultivator = placement(realCultivator(opts.implant), 'M3', {
        attack: 1,
        hp: CULTIVATOR_HP,
        speed: 50,
    });
    const ally = placement(
        plainShip('ally', 'Ally', 'This Unit deals <unit-damage>1% damage</unit-damage>.'),
        'M4',
        { attack: 1, hp: ALLY_HP, speed: 10 }
    );
    const hitterShip = plainShip(
        'hitter',
        'Hitter',
        'This Unit deals <unit-damage>100% damage</unit-damage>.'
    );
    const hitter = placement(
        opts.hitEveryone ? { ...hitterShip, activePattern: 'Pattern-All' } : hitterShip,
        'M4',
        { attack: opts.hitPerRound, hp: 1_000_000_000, speed: 1000 }
    );
    // A back-row filler that only exists to push Cultivator off the focus slot.
    const filler = placement(
        plainShip('filler', 'Filler', 'This Unit deals <unit-damage>1% damage</unit-damage>.'),
        'T1',
        { attack: 1, hp: 1_000_000, speed: 5 }
    );

    const input =
        opts.where === 'focus'
            ? { playerTeam: [cultivator, ally], enemyTeam: [hitter], rounds: 3 }
            : opts.where === 'team'
              ? { playerTeam: [filler, cultivator, ally], enemyTeam: [hitter], rounds: 3 }
              : { playerTeam: [hitter], enemyTeam: [cultivator, ally], rounds: 3 };
    const result = simulateBattle(input, implantPiece);

    const cultivatorId =
        opts.where === 'focus'
            ? 'attacker'
            : opts.where === 'team'
              ? 'p:cultivator:1'
              : 'e:cultivator:0';
    const allyId =
        opts.where === 'focus' ? 'p:ally:1' : opts.where === 'team' ? 'p:ally:2' : 'e:ally:1';
    expect(result.roster.map((r) => r.actorId)).toEqual(
        expect.arrayContaining([cultivatorId, allyId])
    );

    return [1, 2, 3].map((round) => {
        const r = result.combatLog.find((cr) => cr.round === round);
        if (!r) return [];
        return flattenCombatLog({ ...result, combatLog: [r] })
            .filter((e) => e.kind === 'heal' && e.actorId === cultivatorId)
            .flatMap((e) => e.targets)
            .filter((t) => t.targetId === allyId)
            .map((t) => (t.amount ?? 0) + (t.overheal ?? 0));
    });
}

const WHERE: Where[] = ['focus', 'team', 'enemy'];

describe('Nourishment boosts a passive repair onto a lower-HP ally', () => {
    for (const where of WHERE) {
        describe(`Cultivator as ${where}`, () => {
            it('control: no implant → each passive repair is the base 80,000', () => {
                const rounds = allyRepairs({ where, hitPerRound: 1_000_000 });
                expect(rounds).toEqual([[BASE_REPAIR], [BASE_REPAIR], [BASE_REPAIR]]);
            });

            it('legendary Nourishment → each passive repair is 80,000 × 1.30', () => {
                const rounds = allyRepairs({
                    where,
                    implant: 'NOURISHMENT@legendary',
                    hitPerRound: 1_000_000,
                });
                expect(rounds.flat()).toHaveLength(3);
                for (const amount of rounds.flat()) expect(amount).toBeCloseTo(BASE_REPAIR * 1.3);
            });

            it('condition control: the healer is lower on HP than the ally → no boost', () => {
                // 300,000 to everyone: Cultivator (1,000,000 HP) sits near 70% / 56% / 34% while
                // the 10,000,000-HP ally stays above 90%, so the ally never has the lower HP.
                const rounds = allyRepairs({
                    where,
                    implant: 'NOURISHMENT@legendary',
                    hitPerRound: 300_000,
                    hitEveryone: true,
                });
                expect(rounds).toEqual([[BASE_REPAIR], [BASE_REPAIR], [BASE_REPAIR]]);
            });
        });
    }
});

describe('Vivacious Repair can double a passive repair onto an ally below 25% HP', () => {
    // 2,800,000 a round on a 10,000,000 ally: ~72% after round 1, ~44% after round 2 (both at or
    // above 25% → never doubled), ~16% after round 3 (below 25% → the 32% roll applies).
    const HIT = 2_800_000;
    const SEEDS = 30;

    for (const where of WHERE) {
        it(`Cultivator as ${where}: only the below-25% round ever doubles, and it sometimes does`, () => {
            const seen = { early: new Set<number>(), late: new Set<number>() };
            let doubled = 0;
            for (let seed = 1; seed <= SEEDS; seed++) {
                const [r1, r2, r3] = allyRepairs({
                    where,
                    implant: 'VIVACIOUS_REPAIR@legendary',
                    hitPerRound: HIT,
                    seed,
                });
                expect(r3).toHaveLength(1);
                for (const a of [...r1, ...r2]) seen.early.add(Math.round(a));
                seen.late.add(Math.round(r3[0]));
                if (Math.round(r3[0]) === BASE_REPAIR * 2) doubled += 1;
            }
            // Rounds 1-2: the ally is at or above 25% HP, so the roll never applies.
            expect([...seen.early]).toEqual([BASE_REPAIR]);
            // Round 3: only the two legal outcomes, and the doubled one does occur.
            expect([...seen.late].sort((a, b) => a - b)).toEqual([BASE_REPAIR, BASE_REPAIR * 2]);
            expect(doubled).toBeGreaterThan(0);
            expect(doubled).toBeLessThan(SEEDS);
        });
    }
});
