/**
 * A counter-attack (Stalwart, Centurion) and a reactive damage proc (Chakara's round-start hit)
 * are full damage walks: they read the same victim profile and the same owner stats as the
 * owner's own cast hit on the same victim.
 *
 * Every board runs twice — the subject on the player side, then the exact mirror with the subject
 * on the enemy side — and every claim is checked against the subject's OWN cast hit on the same
 * victim, which is the instrument: a board where the cast does not move proves nothing.
 *
 * Exposed is deliberately NOT read by a counter or a proc (and so is not spent by one); see the
 * test of that name.
 *
 * Real kits via `buildTraceShip` (refit 4), stats via `statOverrides`, events via a recording bus.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { CombatEvent } from '../events';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import {
    damageKit,
    realEnemyInput,
    REAL_ENEMY_ID,
} from '../../calculators/__testutils__/dpsRealEnemyFixture';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import {
    setupKeyedRng,
    setKeyedRng,
    setRateGateRng,
    resetRateGateRng,
} from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { victimDefenceMitigation } from '../victimDamage';
import type { Position } from '../../../types/encounters';
import type { AffinityName, Ship } from '../../../types/ship';

// `vi.mock` is hoisted above the imports, so the state its factory closes over must be too.
const tap = vi.hoisted(() => ({ recorded: [] as CombatEvent[], buses: 0 }));
vi.mock('../events', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../events')>();
    return {
        ...mod,
        createEventBus: () => {
            const bus = mod.createEventBus();
            // simulateBattle's own bus is created first; the engine's internal bus re-carries the
            // same events, so only the first bus of a run is recorded.
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

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});
afterEach(() => resetRateGateRng());

const SIDES = ['player', 'enemy'] as const;
type Side = (typeof SIDES)[number];

interface Spec {
    /** Unique id; also the ship id, so the engine's actor id is derived from it. */
    id: string;
    name: string;
    position: Position;
    speed: number;
    attack?: number;
    defence?: number;
    crit?: number;
    security?: number;
    affinity?: AffinityName;
    ship?: Partial<Ship>;
}

const placement = (s: Spec): BattlePlacement => {
    const ship = buildTraceShip(s.name);
    if (!ship) throw new Error(`${s.name} missing from reference data`);
    return {
        ship: { ...ship, id: s.id, ...(s.affinity ? { affinity: s.affinity } : {}), ...s.ship },
        position: s.position,
        statOverrides: {
            attack: s.attack ?? 0,
            crit: s.crit ?? 0,
            critDamage: 100,
            defensePenetration: 0,
            hacking: 1000,
            security: s.security ?? 0,
            defence: s.defence ?? 0,
            hp: 1e12,
            speed: s.speed,
        },
    };
};

interface Run {
    events: CombatEvent[];
    /** Engine actor id of a spec id on this run. */
    idOf: (specId: string) => string;
}

/**
 * Run `subjects` against `opponents` with the subjects on `side`. `rng` replaces the seeded
 * streams with a constant draw: a gate fires when the draw is below the rate, so 0.8 crits at a
 * 100% rate and does not at a 75% one.
 */
const run = (
    subjects: Spec[],
    opponents: Spec[],
    side: Side,
    rounds: number,
    rng?: number
): Run => {
    tap.recorded.length = 0;
    tap.buses = 0;
    setupKeyedRng(1);
    if (rng !== undefined) {
        setRateGateRng(() => rng);
        setKeyedRng(() => rng);
    }
    const playerSpecs = side === 'player' ? subjects : opponents;
    const enemySpecs = side === 'player' ? opponents : subjects;
    simulateBattle({
        playerTeam: playerSpecs.map(placement),
        enemyTeam: enemySpecs.map(placement),
        rounds,
    });
    const ids = new Map<string, string>();
    playerSpecs.forEach((s, i) => ids.set(s.id, i === 0 ? 'attacker' : `p:${s.id}:${i}`));
    enemySpecs.forEach((s, i) => ids.set(s.id, `e:${s.id}:${i}`));
    return {
        events: [...tap.recorded],
        idOf: (specId) => {
            const id = ids.get(specId);
            if (!id) throw new Error(`no actor for ${specId}`);
            return id;
        },
    };
};

type ReactiveRow = Extract<CombatEvent, { type: 'reactive-damage-performed' }>;
type AttackedRow = Extract<CombatEvent, { type: 'attacked' }>;

/** The ONE reactive hit `source` landed on `target` in `round`. */
const reactiveHit = (r: Run, source: string, target: string, round: number): ReactiveRow => {
    const rows = r.events.filter(
        (e): e is ReactiveRow =>
            e.type === 'reactive-damage-performed' &&
            e.sourceId === r.idOf(source) &&
            e.targetId === r.idOf(target) &&
            e.round === round
    );
    expect(rows).toHaveLength(1);
    return rows[0];
};

/** The ONE cast hit `attacker` landed on `target` in `round` — the instrument. */
const castHit = (r: Run, attacker: string, target: string, round: number): AttackedRow => {
    const rows = r.events.filter(
        (e): e is AttackedRow =>
            e.type === 'attacked' &&
            e.attackerId === r.idOf(attacker) &&
            e.targetId === r.idOf(target) &&
            e.round === round
    );
    expect(rows).toHaveLength(1);
    return rows[0];
};

// Bedrock (90% damage, single target) is the punching bag: defence 5000, attacks every round.
const bedrock = (over: Partial<Spec> = {}): Spec => ({
    id: 'Bag',
    name: 'Bedrock',
    position: 'M4',
    speed: 200,
    attack: 100,
    defence: 5000,
    ...over,
});
const stalwart = (over: Partial<Spec> = {}): Spec => ({
    id: 'Stalwart',
    name: 'Stalwart',
    position: 'M4',
    speed: 100,
    attack: 10_000,
    ...over,
});
// Nayra (speed 300) acts first: her active lands Defense Down II on the enemy she strikes.
const nayra = (over: Partial<Spec> = {}): Spec => ({
    id: 'Nayra',
    name: 'Nayra',
    position: 'T4',
    speed: 300,
    attack: 1,
    ...over,
});

/** Defence factor of a 5000-defence victim under Defense Down II (-30%), over the bare one. */
const DEFENSE_DOWN_II_RATIO =
    victimDefenceMitigation({ defence: 5000, defenceModifierPct: -30, affinity: 'antimatter' }, 0) /
    victimDefenceMitigation({ defence: 5000, defenceModifierPct: 0, affinity: 'antimatter' }, 0);

describe('a counter or reactive proc reads the victim profile the cast reads', () => {
    it.each(SIDES)(
        'Stalwart counter rises with Defense Down II on its victim (%s side)',
        (side) => {
            const bare = run([stalwart()], [bedrock()], side, 1);
            const shredded = run([stalwart(), nayra()], [bedrock()], side, 1);

            // Instrument: Stalwart's own cast on the same Bedrock moves by the defence factor.
            const castBare = castHit(bare, 'Stalwart', 'Bag', 1).damage!;
            const castShredded = castHit(shredded, 'Stalwart', 'Bag', 1).damage!;
            expect(castShredded / castBare).toBeCloseTo(DEFENSE_DOWN_II_RATIO, 9);

            const counterBare = reactiveHit(bare, 'Stalwart', 'Bag', 1).amount;
            const counterShredded = reactiveHit(shredded, 'Stalwart', 'Bag', 1).amount;
            expect(counterShredded / counterBare).toBeCloseTo(DEFENSE_DOWN_II_RATIO, 9);
        }
    );

    it.each(SIDES)(
        "Chakara's round-start proc rises with Defense Down II on its victim (%s side)",
        (side) => {
            // Chakara is the slowest ally, so at each round start she hits the fastest enemy.
            // Nayra's Defense Down II from round 1 is on that enemy at the start of round 2.
            const chakara: Spec = {
                id: 'Chakara',
                name: 'Chakara',
                position: 'M4',
                speed: 50,
                attack: 10_000,
            };
            const filler: Spec = { ...nayra(), id: 'Filler', name: 'Bedrock', attack: 0 };
            const bare = run([chakara, filler], [bedrock()], side, 2);
            const shredded = run([chakara, nayra()], [bedrock()], side, 2);

            // Instrument: her round-2 cast on the same Bedrock rises.
            expect(castHit(shredded, 'Chakara', 'Bag', 2).damage!).toBeGreaterThan(
                castHit(bare, 'Chakara', 'Bag', 2).damage! * 1.05
            );

            const procBare = reactiveHit(bare, 'Chakara', 'Bag', 2).amount;
            const procShredded = reactiveHit(shredded, 'Chakara', 'Bag', 2).amount;
            expect(procShredded / procBare).toBeCloseTo(DEFENSE_DOWN_II_RATIO, 9);
        }
    );

    it.each(SIDES)(
        "Stalwart counter rises with Asphodel's Inc. Damage Up II on its victim (%s side)",
        (side) => {
            // Asphodel (fast) fires her charged skill in round 3, inflicting Inc. Damage Up II on
            // Bedrock before Bedrock strikes Stalwart. The control Asphodel's charged text is the
            // same hit without the debuff. Refit 0, whose rows lack "attacks always critically
            // hit": a crit-every-cast Asphodel gains charges faster and fires before round 3.
            const asphodel = (withDebuff: boolean): Spec => ({
                id: 'Asphodel',
                name: 'Asphodel',
                position: 'T4',
                speed: 300,
                attack: 1,
                ship: withDebuff
                    ? { refits: [] }
                    : {
                          refits: [],
                          chargeSkillText:
                              'This Unit deals <unit-damage>250% damage</unit-damage>.',
                      },
            });
            const bare = run([stalwart(), asphodel(false)], [bedrock()], side, 3);
            const amplified = run([stalwart(), asphodel(true)], [bedrock()], side, 3);

            // Instrument: Stalwart's round-3 cast on Bedrock is 30% bigger.
            expect(
                castHit(amplified, 'Stalwart', 'Bag', 3).damage! /
                    castHit(bare, 'Stalwart', 'Bag', 3).damage!
            ).toBeCloseTo(1.3, 9);

            expect(
                reactiveHit(amplified, 'Stalwart', 'Bag', 3).amount /
                    reactiveHit(bare, 'Stalwart', 'Bag', 3).amount
            ).toBeCloseTo(1.3, 9);
        }
    );

    it.each(SIDES)('Exposed neither amplifies a counter nor is spent by one (%s side)', (side) => {
        // A fast ally lands one stack of Exposed on Bedrock after its own (zero) hit, for two
        // turns so the stack outlives Bedrock's own turn end. Bedrock then hits Stalwart, who
        // counters; Stalwart's own cast comes after. Whether a counter is "direct damage" for
        // Exposed is an open question, so the counter neither reads the stack nor spends it,
        // and Stalwart's cast is the hit that does both.
        const exposer = (withExposed: boolean): Spec => ({
            id: 'Exposer',
            name: 'Bedrock',
            position: 'T4',
            speed: 300,
            attack: 0,
            ship: {
                activeSkillText: withExposed
                    ? 'This Unit deals <unit-damage>90% damage</unit-damage> and inflicts <unit-skill>Exposed</unit-skill> for 2 turns.'
                    : 'This Unit deals <unit-damage>90% damage</unit-damage>.',
            },
        });
        const bare = run([stalwart(), exposer(false)], [bedrock()], side, 1);
        const exposed = run([stalwart(), exposer(true)], [bedrock()], side, 1);

        // Instrument: the stack is still there for Stalwart's cast, which it doubles.
        expect(
            castHit(exposed, 'Stalwart', 'Bag', 1).damage! /
                castHit(bare, 'Stalwart', 'Bag', 1).damage!
        ).toBeCloseTo(2, 9);

        expect(reactiveHit(exposed, 'Stalwart', 'Bag', 1).amount).toBeCloseTo(
            reactiveHit(bare, 'Stalwart', 'Bag', 1).amount,
            9
        );
    });
});

describe("a counter reads the owner's accumulating stacks", () => {
    it.each(SIDES)(
        "Centurion's counter carries his Core Charge stacks like his cast does (%s side)",
        (side) => {
            // Centurion fires his charged skill in round 3 (4 stacks of Core Charge I: +4%
            // outgoing and +1% defence penetration each). Bedrock hits him every round and he
            // retaliates for 100%; his round-1 and round-4 actives are 100% too, so on each of
            // those rounds the counter and the cast are the same hit.
            const centurion: Spec = {
                id: 'Centurion',
                name: 'Centurion',
                position: 'M4',
                speed: 100,
                attack: 10_000,
            };
            const r = run([centurion], [bedrock()], side, 4);

            const castR1 = castHit(r, 'Centurion', 'Bag', 1).damage!;
            const castR4 = castHit(r, 'Centurion', 'Bag', 4).damage!;
            // Instrument: the stacks lift his round-4 cast.
            expect(castR4).toBeGreaterThan(castR1 * 1.1);

            expect(reactiveHit(r, 'Centurion', 'Bag', 1).amount).toBeCloseTo(castR1, 6);
            expect(reactiveHit(r, 'Centurion', 'Bag', 4).amount).toBeCloseTo(castR4, 6);
        }
    );
});

describe('a counter or reactive proc rolls crit at the affinity-capped rate', () => {
    // Constant draw 0.8: a 100% rate crits, the 75% disadvantage cap does not.
    const DRAW = 0.8;

    it.each(SIDES)(
        'Stalwart at affinity disadvantage does not crit on the counter (%s side)',
        (side) => {
            // Thermal Stalwart vs electric Bedrock is a disadvantage; antimatter is neutral.
            const disadvantaged = run(
                [stalwart({ crit: 100, affinity: 'thermal', speed: 400 })],
                [bedrock({ speed: 200 })],
                side,
                1,
                DRAW
            );
            const neutral = run(
                [stalwart({ crit: 100, affinity: 'antimatter', speed: 400 })],
                [bedrock({ speed: 200 })],
                side,
                1,
                DRAW
            );
            // Instrument: his cast on the same Bedrock is capped the same way.
            expect(castHit(disadvantaged, 'Stalwart', 'Bag', 1).didCrit).toBeFalsy();
            expect(castHit(neutral, 'Stalwart', 'Bag', 1).didCrit).toBe(true);

            expect(reactiveHit(disadvantaged, 'Stalwart', 'Bag', 1).didCrit).toBe(false);
            expect(reactiveHit(neutral, 'Stalwart', 'Bag', 1).didCrit).toBe(true);
        }
    );

    it.each(SIDES)(
        "Chakara's round-start proc at affinity disadvantage does not crit (%s side)",
        (side) => {
            const chakara = (affinity: AffinityName): Spec => ({
                id: 'Chakara',
                name: 'Chakara',
                position: 'M4',
                speed: 50,
                attack: 10_000,
                crit: 100,
                affinity,
            });
            const disadvantaged = run([chakara('thermal')], [bedrock()], side, 1, DRAW);
            const neutral = run([chakara('antimatter')], [bedrock()], side, 1, DRAW);
            // Instrument: her cast on the same Bedrock.
            expect(castHit(disadvantaged, 'Chakara', 'Bag', 1).didCrit).toBeFalsy();
            expect(castHit(neutral, 'Chakara', 'Bag', 1).didCrit).toBe(true);

            expect(reactiveHit(disadvantaged, 'Chakara', 'Bag', 1).didCrit).toBe(false);
            expect(reactiveHit(neutral, 'Chakara', 'Bag', 1).didCrit).toBe(true);
        }
    );
});

describe('Defensive Affinity Override on the victim of a counter or a covered hit', () => {
    const DRAW = 0.8;

    it.each(SIDES)(
        "Stalwart's counter into Nayra's Defensive Affinity Override is at disadvantage (%s side)",
        (side) => {
            // Nayra (speed 300, holding her round-start override) hits Stalwart first; he counters
            // her while she still holds it. Her active is reduced to its hit, so her Crit Rate
            // Down III on Stalwart cannot be what stops the crit. Control: the same counter into a
            // Bedrock.
            const stal = stalwart({ crit: 100, speed: 100, affinity: 'antimatter' });
            const plainNayra = nayra({
                id: 'Bag',
                position: 'M4',
                defence: 0,
                ship: {
                    activeSkillText: 'This Unit deals <unit-damage>170% damage</unit-damage>.',
                },
            });
            const intoNayra = run([stal], [plainNayra], side, 1, DRAW);
            const intoBedrock = run(
                [stal],
                [bedrock({ defence: 0, speed: 300, affinity: 'antimatter' })],
                side,
                1,
                DRAW
            );

            const control = reactiveHit(intoBedrock, 'Stalwart', 'Bag', 1);
            expect(control.didCrit).toBe(true);
            expect(control.amount).toBeCloseTo(10_000 * 0.7 * 2, 6);

            const overridden = reactiveHit(intoNayra, 'Stalwart', 'Bag', 1);
            expect(overridden.didCrit).toBe(false);
            expect(overridden.amount).toBeCloseTo(10_000 * 0.7 * 0.75, 6);
        }
    );

    it.each(SIDES)(
        "Lev's cone does not crit a covered Nayra holding the override (%s side)",
        (side) => {
            // Lev's cone anchors on the front enemy and covers its neighbour. Neutral anchor,
            // covered Nayra holding her override (she is slow, so she still holds it). Control: a
            // covered Bedrock with no override.
            const lev: Spec = {
                id: 'Lev',
                name: 'Lev',
                position: 'M4',
                speed: 300,
                attack: 10_000,
                crit: 100,
                affinity: 'antimatter',
            };
            const anchor = bedrock({ id: 'Anchor', defence: 0, affinity: 'antimatter' });
            const coveredNayra = nayra({ id: 'Covered', position: 'M3', speed: 10 });
            const coveredBag = bedrock({
                id: 'Covered',
                position: 'M3',
                defence: 0,
                speed: 10,
                affinity: 'antimatter',
            });
            const withOverride = run([lev], [anchor, coveredNayra], side, 1, DRAW);
            const control = run([lev], [anchor, coveredBag], side, 1, DRAW);

            expect(castHit(withOverride, 'Lev', 'Anchor', 1).didCrit).toBe(true);
            expect(castHit(control, 'Lev', 'Covered', 1).didCrit).toBe(true);
            expect(castHit(withOverride, 'Lev', 'Covered', 1).didCrit).toBeFalsy();
        }
    );
});

describe('Meatshield defence substitution on reactive hits — unchanged pending the direct-damage ruling', () => {
    it.each(SIDES)("reaches Chakara's proc but not Stalwart's counter (%s side)", (side) => {
        // A plain attacker-role enemy (Lev's role, a bare 90% hit) with a high-defence
        // Meatshield beside it. Whether a counter is "direct damage" for Meatshield's "as if
        // that ally had this Unit's defense" is an open owner question; until it is answered a
        // counter keeps the victim's own defence and a proc takes Meatshield's.
        const hitter: Spec = {
            id: 'Bag',
            name: 'Lev',
            position: 'M4',
            speed: 200,
            attack: 100,
            ship: {
                activeSkillText: 'This Unit deals <unit-damage>90% damage</unit-damage>.',
                chargeSkillText: undefined,
                firstPassiveSkillText: undefined,
                secondPassiveSkillText: undefined,
                thirdPassiveSkillText: undefined,
            },
        };
        const meatshield: Spec = {
            id: 'Meat',
            name: 'Meatshield',
            position: 'B4',
            speed: 1,
            defence: 50_000,
        };
        const chakara: Spec = {
            id: 'Chakara',
            name: 'Chakara',
            position: 'T4',
            speed: 50,
            attack: 10_000,
        };
        const alone = run([stalwart(), chakara], [hitter], side, 1);
        const guarded = run([stalwart(), chakara], [hitter, meatshield], side, 1);

        expect(reactiveHit(guarded, 'Chakara', 'Bag', 1).amount).toBeLessThan(
            reactiveHit(alone, 'Chakara', 'Bag', 1).amount / 2
        );
        expect(reactiveHit(guarded, 'Stalwart', 'Bag', 1).amount).toBeCloseTo(
            reactiveHit(alone, 'Stalwart', 'Bag', 1).amount,
            9
        );
    });
});

describe('a reactive hit reads only debuffs that LANDED', () => {
    it.each(SIDES)(
        "a resisted Defense Down II leaves Stalwart's counter alone; a landed one boosts it (%s side)",
        (side) => {
            // Nayra's Defense Down II on Bedrock lands at Bedrock security 0 and is resisted at
            // security 5000 (her hacking is 1000).
            const bare = run([stalwart()], [bedrock()], side, 1);
            const landed = run([stalwart(), nayra()], [bedrock()], side, 1);
            const resisted = run([stalwart(), nayra()], [bedrock({ security: 5000 })], side, 1);

            // Instrument: Stalwart's own cast.
            const castBare = castHit(bare, 'Stalwart', 'Bag', 1).damage!;
            expect(castHit(resisted, 'Stalwart', 'Bag', 1).damage!).toBeCloseTo(castBare, 9);
            expect(castHit(landed, 'Stalwart', 'Bag', 1).damage! / castBare).toBeCloseTo(
                DEFENSE_DOWN_II_RATIO,
                9
            );

            const counterBare = reactiveHit(bare, 'Stalwart', 'Bag', 1).amount;
            expect(reactiveHit(resisted, 'Stalwart', 'Bag', 1).amount).toBeCloseTo(counterBare, 9);
            expect(reactiveHit(landed, 'Stalwart', 'Bag', 1).amount / counterBare).toBeCloseTo(
                DEFENSE_DOWN_II_RATIO,
                9
            );
        }
    );
});

describe("DPS mode: a counter reads the calculator's enemy debuffs only where they LANDED", () => {
    // The page's "enemy debuffs" picks are the player's, scheduled against the enemy side and
    // rolled hacking-vs-security every round on the player side's turns only. Defense Down II here never lands at hacking 0 vs
    // security 1000, and always lands at hacking 1000 vs security 0.
    const DD2 = [
        {
            id: 'dd2',
            buffName: 'Defense Down II',
            stacks: 1,
            parsedEffects: { defense: -30 },
            isStackable: false,
            skillDuration: 'recurring' as const,
        },
    ];
    type Landing = 'none' | 'fails' | 'lands';
    const landingStats = (landing: Landing) =>
        landing === 'lands' ? { hacking: 1000, security: 0 } : { hacking: 0, security: 1000 };

    const runDps = (
        landing: Landing,
        focus: { skills: ReturnType<typeof buildShipAbilities>; speed: number; defence: number },
        enemy: { skills?: ReturnType<typeof buildShipAbilities>; speed: number; attack: number }
    ): CombatEvent[] => {
        tap.recorded.length = 0;
        tap.buses = 0;
        setupKeyedRng(1);
        const { hacking, security } = landingStats(landing);
        simulateDPS(
            realEnemyInput({
                attack: 10_000,
                crit: 0,
                critDamage: 100,
                defence: focus.defence,
                hp: 1e12,
                speed: focus.speed,
                rounds: 2,
                shipSkills: focus.skills,
                enemyDefense: 5000,
                enemyHp: 1e12,
                hacking,
                enemySecurity: security,
                enemyDebuffs: landing === 'none' ? [] : DD2,
                enemyAttackers: [
                    {
                        id: REAL_ENEMY_ID,
                        stats: {
                            attack: enemy.attack,
                            crit: 0,
                            critDamage: 100,
                            speed: enemy.speed,
                            defence: 5000,
                            hp: 1e12,
                            security,
                            hacking: landing === 'lands' ? 1000 : 0,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        ...(enemy.skills ? { shipSkills: enemy.skills } : {}),
                    },
                ],
            })
        );
        return [...tap.recorded];
    };
    const one = <T extends CombatEvent['type']>(
        events: CombatEvent[],
        type: T,
        pick: (e: Extract<CombatEvent, { type: T }>) => boolean
    ): Extract<CombatEvent, { type: T }> => {
        const rows = events.filter(
            (e): e is Extract<CombatEvent, { type: T }> =>
                e.type === type && pick(e as Extract<CombatEvent, { type: T }>)
        );
        expect(rows).toHaveLength(1);
        return rows[0];
    };
    const stalwartKit = () => buildShipAbilities(buildTraceShip('Stalwart')!);

    it("the player's counter ignores a Defense Down II that failed and reads one that landed", () => {
        // The enemy (faster) hits Stalwart each round, who counters; his own cast follows. The
        // picks are rolled on HIS turns, so the round-2 counter answers to his round-1 roll, and
        // the round-1 counter comes before any roll at all.
        const focus = { skills: stalwartKit(), speed: 100, defence: 0 };
        const enemy = { speed: 200, attack: 100 };
        const counter = (l: Landing, round: number) =>
            one(
                runDps(l, focus, enemy),
                'reactive-damage-performed',
                (e) => e.sourceId === 'attacker' && e.round === round
            ).amount;
        const cast = (l: Landing) =>
            one(
                runDps(l, focus, enemy),
                'attacked',
                (e) => e.attackerId === 'attacker' && e.targetId === REAL_ENEMY_ID && e.round === 1
            ).damage!;

        // Instrument: his cast reads the landing decision.
        expect(cast('fails')).toBeCloseTo(cast('none'), 9);
        expect(cast('lands') / cast('none')).toBeCloseTo(DEFENSE_DOWN_II_RATIO, 9);

        expect(counter('fails', 2)).toBeCloseTo(counter('none', 2), 9);
        expect(counter('lands', 2) / counter('none', 2)).toBeCloseTo(DEFENSE_DOWN_II_RATIO, 9);
        // Nothing has been rolled before his first turn, so nothing has landed.
        expect(counter('lands', 1)).toBeCloseTo(counter('none', 1), 9);
    });

    it("the enemy's counter and cast never read the calculator's picks", () => {
        // Mirror: an enemy Stalwart is hit by the (faster) player and counters onto the player,
        // who has 5000 defence. The picks are the PLAYER side's debuffs on the enemy: the enemy
        // never rolls them against the player, so neither its cast nor its counter onto the
        // player moves, whatever its hacking.
        const focus = { skills: damageKit(), speed: 200, defence: 5000 };
        const enemy = { skills: stalwartKit(), speed: 100, attack: 10_000 };
        const counter = (l: Landing, round: number) =>
            one(
                runDps(l, focus, enemy),
                'reactive-damage-performed',
                (e) => e.sourceId === REAL_ENEMY_ID && e.round === round
            ).amount;
        const cast = (l: Landing) =>
            one(
                runDps(l, focus, enemy),
                'attacked',
                (e) => e.attackerId === REAL_ENEMY_ID && e.targetId === 'attacker' && e.round === 1
            ).damage!;

        expect(cast('fails')).toBeCloseTo(cast('none'), 9);
        expect(cast('lands')).toBeCloseTo(cast('none'), 9);
        for (const round of [1, 2]) {
            expect(counter('fails', round)).toBeCloseTo(counter('none', round), 9);
            expect(counter('lands', round)).toBeCloseTo(counter('none', round), 9);
        }
    });
});
