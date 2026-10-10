/**
 * "This Unit's attacks always critically hit" (Tormenter at every refit, Asphodel from refit 2) means
 * a 100% crit rate on every attack, whatever lowers crit — owner ruling 57, 2026-10-05:
 *   - an affinity disadvantage (normally −25 crit rate and a 75% cap);
 *   - an enemy's Crit Rate Down debuff.
 *
 * Observable: the `didCrit` of every `attacked` event the caster's own casts raise. The negative is
 * Asphodel at refit 0, whose rows do not yet carry the clause: the same crit 100 at the same
 * disadvantage crits only ~75% of the time.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parseAlwaysCrits } from '../../skillTextParser';
import { boardInput, NO_KIT, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import { applyGuaranteedCrit } from '../../ship/perShipRules';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { AffinityName } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { RefitLevel } from '../../../../scripts/lib/traceShipFactory';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data)'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const kitAt = (ship: string, refitLevel: RefitLevel): ShipSkills => {
    const built = buildTraceShip(ship, { refitLevel });
    if (!built) throw new Error(`${ship} missing from reference data`);
    return buildShipAbilities(built);
};

/** The kit's cast slots only (active + charged), plus its ship-level flags. */
const castKit = (ship: string, refitLevel: RefitLevel): ShipSkills => {
    const full = kitAt(ship, refitLevel);
    return { ...full, slots: full.slots.filter((s) => s.slot !== 'passive') };
};

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

const target = (id: string, position: Position, affinity: AffinityName): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e12, speed: 10, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    affinity,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

/** Real Nayra active: inflicts Crit Rate Down III (−30%) for 2 turns on the ship she hits. */
const nayra = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1e12,
        speed: 400,
        security: 0,
        hacking: 1e6,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    affinity: 'antimatter',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: {
        slots: castKit('Nayra', 4).slots.filter((s) => s.slot === 'active'),
    },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 100,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1e12,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

/** The player caster (focus 'attacker') hitting one enemy of `victimAffinity`. */
const playerBoard = (
    kit: ShipSkills,
    casterAffinity: AffinityName,
    victimAffinity: AffinityName,
    withNayra = false
): CombatEngineInput =>
    base({
        shipSkills: kit,
        affinity: casterAffinity,
        enemyAttackers: [
            target('victim', 'M4', victimAffinity),
            ...(withNayra ? [nayra('nayra', 'M3')] : []),
        ],
    });

/** The mirror: an enemy caster hitting the player focus of `victimAffinity`. */
const enemyBoard = (
    kit: ShipSkills,
    casterAffinity: AffinityName,
    victimAffinity: AffinityName,
    withNayra = false
): CombatEngineInput =>
    base({
        attack: 0,
        crit: 0,
        affinity: victimAffinity,
        // A Nayra on the PLAYER side lands Crit Rate Down III on the enemy caster.
        ...(withNayra
            ? {
                  attack: 1,
                  hacking: 1e6,
                  speed: 400,
                  shipSkills: {
                      slots: castKit('Nayra', 4).slots.filter((s) => s.slot === 'active'),
                  },
              }
            : {}),
        enemyAttackers: [
            {
                id: 'caster',
                stats: {
                    attack: 1000,
                    crit: 100,
                    critDamage: 0,
                    defence: 0,
                    hp: 1e12,
                    speed: 50,
                    security: 0,
                    hacking: 0,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                affinity: casterAffinity,
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                shipSkills: kit,
            },
        ],
    });

/** Every `attacked` the caster raised, across the seeds: [crits, hits]. */
const critTally = (input: CombatEngineInput, casterId: string): [number, number] => {
    let crits = 0;
    let hits = 0;
    for (const seed of SEEDS) {
        setupKeyedRng(seed);
        const bus = createEventBus();
        bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
            if (e.attackerId !== casterId) return;
            hits += 1;
            if (e.didCrit) crits += 1;
        });
        runCombat({ ...input, bus });
    }
    return [crits, hits];
};

/** Did the caster carry Crit Rate Down III on at least one of its casts? (Instrument check.) */
const casterWasDebuffed = (input: CombatEngineInput, casterId: string): boolean => {
    setupKeyedRng(1);
    const bus = createEventBus();
    let seen = false;
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.targetId === casterId && e.buffName === 'Crit Rate Down III') seen = true;
    });
    runCombat({ ...input, bus });
    return seen;
};

describe('the parsed flag follows the refit-active rows', () => {
    it('Tormenter carries it from refit 0; Asphodel only from refit 2', () => {
        expect(kitAt('Tormenter', 0).alwaysCrits).toBe(true);
        expect(kitAt('Tormenter', 4).alwaysCrits).toBe(true);
        expect(kitAt('Asphodel', 0).alwaysCrits).toBeFalsy();
        expect(kitAt('Asphodel', 2).alwaysCrits).toBe(true);
        expect(kitAt('Bedrock', 4).alwaysCrits).toBeFalsy();
    });

    it("agrees with perShipRules' crit top-up for every ship at every refit", () => {
        // The stat layer (applyGuaranteedCrit, which the importer and the reference ships use)
        // and the combat layer (the parsed flag) must name the same ships at the same refits.
        const names = [...new Set(loadShipSkillRecords().map((r) => r.name))];
        const disagreements: string[] = [];
        for (const name of names) {
            for (const refit of [0, 2, 4] as RefitLevel[]) {
                const ship = buildTraceShip(name, { refitLevel: refit });
                if (!ship) continue;
                const stats = { crit: 0 };
                applyGuaranteedCrit(ship.name, refit, [], stats);
                const statLayer = stats.crit === 100;
                const combatLayer = buildShipAbilities(ship).alwaysCrits === true;
                if (statLayer !== combatLayer) disagreements.push(`${name}@R${refit}`);
            }
        }
        expect(disagreements).toEqual([]);
    });
});

describe('an always-crit attacker crits on every hit at an affinity disadvantage', () => {
    it('player Tormenter (electric) into a chemical enemy: every hit crits', () => {
        const [crits, hits] = critTally(
            playerBoard(castKit('Tormenter', 0), 'electric', 'chemical'),
            'attacker'
        );
        expect(hits).toBeGreaterThan(80);
        expect(crits).toBe(hits);
    });

    it('enemy Tormenter into a chemical player ship: every hit crits', () => {
        const [crits, hits] = critTally(
            enemyBoard(castKit('Tormenter', 0), 'electric', 'chemical'),
            'caster'
        );
        expect(hits).toBeGreaterThan(80);
        expect(crits).toBe(hits);
    });

    it('player Asphodel R2 (chemical) into a thermal enemy: every hit crits', () => {
        const [crits, hits] = critTally(
            playerBoard(castKit('Asphodel', 2), 'chemical', 'thermal'),
            'attacker'
        );
        expect(crits).toBe(hits);
    });

    it('enemy Asphodel R2 into a thermal player ship: every hit crits', () => {
        const [crits, hits] = critTally(
            enemyBoard(castKit('Asphodel', 2), 'chemical', 'thermal'),
            'caster'
        );
        expect(crits).toBe(hits);
    });

    it('negative: Asphodel R0 (no clause) at crit 100 is still capped at 75%', () => {
        for (const [input, id] of [
            [playerBoard(castKit('Asphodel', 0), 'chemical', 'thermal'), 'attacker'],
            [enemyBoard(castKit('Asphodel', 0), 'chemical', 'thermal'), 'caster'],
        ] as const) {
            const [crits, hits] = critTally(input, id);
            expect(hits).toBeGreaterThan(80);
            expect(crits / hits).toBeGreaterThan(0.6);
            expect(crits / hits).toBeLessThan(0.9);
        }
    });

    it('reverse board: at an affinity advantage it still crits every hit, both sides', () => {
        const [pc, ph] = critTally(
            playerBoard(castKit('Tormenter', 0), 'electric', 'thermal'),
            'attacker'
        );
        expect(pc).toBe(ph);
        const [ec, eh] = critTally(
            enemyBoard(castKit('Tormenter', 0), 'electric', 'thermal'),
            'caster'
        );
        expect(ec).toBe(eh);
    });
});

describe('an always-crit attacker crits on every hit under Crit Rate Down III', () => {
    it("player Tormenter carrying an enemy Nayra's Crit Rate Down III", () => {
        const input = playerBoard(castKit('Tormenter', 0), 'antimatter', 'antimatter', true);
        expect(casterWasDebuffed(input, 'attacker')).toBe(true);
        const [crits, hits] = critTally(input, 'attacker');
        expect(crits).toBe(hits);
    });

    it("enemy Tormenter carrying a player Nayra's Crit Rate Down III", () => {
        const input = enemyBoard(castKit('Tormenter', 0), 'antimatter', 'antimatter', true);
        expect(casterWasDebuffed(input, 'caster')).toBe(true);
        const [crits, hits] = critTally(input, 'caster');
        expect(crits).toBe(hits);
    });

    it('negative: Asphodel R0 under the same debuff misses some crits, both sides', () => {
        for (const [input, id] of [
            [playerBoard(castKit('Asphodel', 0), 'antimatter', 'antimatter', true), 'attacker'],
            [enemyBoard(castKit('Asphodel', 0), 'antimatter', 'antimatter', true), 'caster'],
        ] as const) {
            expect(casterWasDebuffed(input, id)).toBe(true);
            const [crits, hits] = critTally(input, id);
            expect(crits).toBeLessThan(hits);
        }
    });
});

describe('DPS calculator', () => {
    it('Tormenter at a disadvantage crits on every round', () => {
        const run = (kit: ShipSkills) => {
            setupKeyedRng(1);
            return simulateDPS({
                attack: 1000,
                crit: 100,
                critDamage: 50,
                defensePenetration: 0,
                chargeCount: 0,
                enemyDefense: 0,
                enemyHp: 1e12,
                rounds: 20,
                selfBuffs: [],
                enemyDebuffs: [],
                affinityCritCap: 75,
                affinityCritPenalty: 25,
                affinityDamageModifier: -25,
                affinity: 'electric',
                enemyAffinity: 'chemical',
                shipSkills: kit,
            }).rounds;
        };
        const tormenter = run(castKit('Tormenter', 0));
        expect(tormenter.every((r) => r.didCrit)).toBe(true);
        // Negative: the same stats without the clause miss some.
        const plain = run(castKit('Asphodel', 0));
        expect(plain.some((r) => !r.didCrit)).toBe(true);
    });
});

describe('the flag needs the unit itself as the subject', () => {
    it('"This Unit\'s attacks" sets it; an enemy-subject phrase does not', () => {
        expect(parseAlwaysCrits("This Unit's attacks always critically hit.")).toBe(true);
        expect(parseAlwaysCrits('This Unit’s attacks always critically hit.')).toBe(true);
        expect(parseAlwaysCrits('Enemy attacks always critically hit this Unit.')).toBe(false);
        expect(parseAlwaysCrits("An ally's attacks always critically hit.")).toBe(false);
    });
});

/**
 * An always-crit owner's reactive damage proc crits at a 100% rate even with 0 crit. Board: the
 * owner carries a Provider-shaped passive ("when another ally inflicts a debuff onto an enemy, deal
 * 50% damage to that enemy", without the "cannot critically hit") and 0 crit; an ally inflicts a
 * debuff on the lone enemy every turn. Every proc must crit; the same owner without the flag never
 * does.
 */
describe("an always-crit owner's reactive proc crits at 0 crit", () => {
    const procKit = (alwaysCrits: boolean): ShipSkills => ({
        ...(alwaysCrits ? { alwaysCrits: true } : {}),
        slots: [
            { slot: 'active', abilities: [] },
            {
                slot: 'passive',
                abilities: [
                    {
                        id: 'proc-hit',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-other-ally-debuff-inflicted',
                        conditions: [],
                        config: { type: 'damage', multiplier: 50 },
                    },
                ],
            },
        ],
    });
    const debufferKit: ShipSkills = {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'seed-debuff',
                        type: 'debuff',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'debuff',
                            buffName: 'Attack Down II',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 1,
                            application: 'apply',
                        },
                    },
                ],
            },
        ],
    };
    const procCrits = (placement: Placement, alwaysCrits: boolean) => {
        const owner: BoardUnit = {
            id: 'owner',
            kit: procKit(alwaysCrits),
            position: 'M3',
            speed: 50,
            attack: 1000,
            crit: 0,
        };
        const debuffer: BoardUnit = {
            id: 'debuffer',
            kit: debufferKit,
            position: 'M4',
            speed: 100,
            hacking: 1e6,
        };
        const enemy: BoardUnit = { id: 'foe', kit: NO_KIT, position: 'M4', speed: 1 };
        const { input, id } = boardInput(placement, owner, [debuffer], [enemy], 4);
        setupKeyedRng(57);
        const bus = createEventBus();
        const crits: boolean[] = [];
        bus.on(
            'reactive-damage-performed',
            (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
                if (e.sourceId === id(owner)) crits.push(e.didCrit === true);
            }
        );
        runCombat({ ...input, bus });
        return crits;
    };

    it.each<Placement>(['player', 'enemy'])('%s side: every proc crits', (placement) => {
        const crits = procCrits(placement, true);
        expect(crits.length).toBeGreaterThan(0);
        expect(crits.every(Boolean)).toBe(true);
    });

    it.each<Placement>(['player', 'enemy'])('negative, %s side: no flag, no crit', (placement) => {
        const crits = procCrits(placement, false);
        expect(crits.length).toBeGreaterThan(0);
        expect(crits.some(Boolean)).toBe(false);
    });
});
