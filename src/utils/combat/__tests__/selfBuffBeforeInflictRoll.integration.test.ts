/**
 * Written clause order covers a cast's own landing rolls: a self buff written before an infliction
 * in the same skill is held when that infliction rolls. Rys's charged: "This Unit gains Hacking Up
 * III for 1 turn, deals 180% damage, and inflicts Speed Down II for 2 turns." Hacking Up III is +60
 * hacking, so Speed Down II rolls against security with it.
 *
 * Real parsed Rys charged (buildTraceShip, refit 4), cast once per run on round 1, over 40 seeds.
 * Rys hacking 140 vs security 130: 10% without the buff, 70% with it. The control arm has a faster
 * ally grant Rys the same Hacking Up III before his turn; the landing draws are keyed by the
 * caster, so with the same chance both arms land on the same seeds.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const rysCharged = (): ShipSkills => {
    const built = buildTraceShip('Rys');
    if (!built) throw new Error('Rys missing from reference data');
    const charged = buildShipAbilities(built).slots.find((s) => s.slot === 'charged');
    if (!charged) throw new Error('Rys has no charged slot');
    return {
        slots: [
            { slot: 'active', abilities: [] },
            { slot: 'charged', abilities: charged.abilities },
        ],
    };
};
/** A support whose cast grants every ally Hacking Up III for 1 turn. */
const hackingGranter = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'grant-hacking',
                    type: 'buff',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Hacking Up III',
                        parsedEffects: { hacking: 60 },
                        stacks: 1,
                        isStackable: false,
                        duration: 1,
                    },
                } satisfies Ability,
            ],
        },
    ],
});
const NONE: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

/** Rys's charged with its clauses re-ordered: "deals 180% damage, inflicts Speed Down II, and gains
 *  Hacking Up III" (`withGain`), or without the gain at all. */
const reordered = (withGain: boolean): ShipSkills => {
    const abilities = rysCharged().slots[1].abilities;
    const gain = abilities.find((a) => a.type === 'buff');
    if (!gain) throw new Error("Rys's charged lost its Hacking Up III clause");
    const rest = abilities.filter((a) => a !== gain);
    return {
        slots: [
            { slot: 'active', abilities: [] },
            { slot: 'charged', abilities: withGain ? [...rest, gain] : rest },
        ],
    };
};

const SEEDS = 40;
const HACKING = 140;
const SECURITY = 130;
const HP = 1e9;

const enemyAt = (
    id: string,
    position: Position,
    over: Partial<EnemyAttacker> = {}
): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: HP,
        speed: 50,
        security: SECURITY,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: NONE,
    ...over,
});
const playerGranter = (): TeamActor => ({
    id: 'p-granter',
    speed: 300,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M3',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: hackingGranter(),
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: HP,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: NONE,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HP,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

/** Player Rys (focus) casting his charged skill at an enemy with security 130. */
const playerRys = (withGranter: boolean, skills: ShipSkills = rysCharged()): CombatEngineInput =>
    base({
        shipSkills: skills,
        hacking: HACKING,
        hasChargedSkill: true,
        startCharged: true,
        chargeCount: 99,
        teamActors: withGranter ? [playerGranter()] : [],
        enemyAttackers: [enemyAt('e-dummy', 'M4')],
    });

/** Enemy Rys casting his charged skill at the player focus (security 130). */
const enemyRys = (withGranter: boolean): CombatEngineInput =>
    base({
        attack: 0,
        security: SECURITY,
        enemyAttackers: [
            enemyAt('e-rys', 'M4', {
                stats: {
                    attack: 1000,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: HP,
                    speed: 100,
                    security: 0,
                    hacking: HACKING,
                },
                chargeCount: 99,
                startCharged: true,
                shipSkills: rysCharged(),
            }),
            ...(withGranter
                ? [
                      enemyAt('e-granter', 'M3', {
                          stats: {
                              attack: 0,
                              crit: 0,
                              critDamage: 0,
                              defence: 0,
                              hp: HP,
                              speed: 300,
                              security: 0,
                          },
                          shipSkills: hackingGranter(),
                      }),
                  ]
                : []),
        ],
    });

/** Seeds (1..SEEDS) on which `casterId`'s Speed Down II landed, and the resist count. */
const landings = (build: () => CombatEngineInput, casterId: string) => {
    const landedOn: number[] = [];
    let resisted = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
        setupKeyedRng(seed);
        const bus = createEventBus();
        let landed = false;
        bus.on('debuff-applied', (e) => {
            if (e.sourceId === casterId && e.buffName === 'Speed Down II') landed = true;
        });
        bus.on('debuff-resisted', (e) => {
            if (e.sourceId === casterId && e.buffName === 'Speed Down II') resisted++;
        });
        runCombat({ ...build(), bus });
        if (landed) landedOn.push(seed);
    }
    return { landedOn, resisted };
};

describe("Rys's own Hacking Up III counts for his charged skill's Speed Down II roll", () => {
    it('player Rys: lands as often, on the same seeds, as when the buff is already held', () => {
        const own = landings(() => playerRys(false), 'attacker');
        const held = landings(() => playerRys(true), 'attacker');
        // The control can report the opposite: with the buff held the chance is 70%.
        expect(held.landedOn.length).toBeGreaterThan(SEEDS / 2);
        expect(held.landedOn.length + held.resisted).toBe(SEEDS);
        expect(own.landedOn).toEqual(held.landedOn);
    });

    it('enemy Rys: lands as often, on the same seeds, as when the buff is already held', () => {
        const own = landings(() => enemyRys(false), 'e-rys');
        const held = landings(() => enemyRys(true), 'e-rys');
        expect(held.landedOn.length).toBeGreaterThan(SEEDS / 2);
        expect(held.landedOn.length + held.resisted).toBe(SEEDS);
        expect(own.landedOn).toEqual(held.landedOn);
    });
});

describe('a hacking gain written AFTER the infliction does not count for its roll', () => {
    it('player: lands on the same seeds as the skill without the gain', () => {
        const after = landings(() => playerRys(false, reordered(true)), 'attacker');
        const without = landings(() => playerRys(false, reordered(false)), 'attacker');
        expect(without.landedOn.length).toBeLessThan(SEEDS / 4);
        expect(after.landedOn).toEqual(without.landedOn);
    });
});
