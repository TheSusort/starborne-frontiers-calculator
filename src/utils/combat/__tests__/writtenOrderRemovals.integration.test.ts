/**
 * A skill's clauses resolve in the order they are written, for status REMOVALS and for the
 * caster's own "+X% to enemies with Stasis" aura as much as for buffs and debuffs:
 *
 *  - "steals 1 buff and deals 300% damage" (Thresh, Tithonus, Pallas): the stolen buff is the
 *    thief's before the hit, so an Out. Damage Up II taken this way raises that same hit.
 *  - "cleanses 2 debuffs, deals 145% damage" (Sustainer, Laika): the cleansed Attack Down no
 *    longer cuts the hit. "deals 210% damage and cleanses 1 debuff" (Nosorog) keeps it.
 *  - "deals 160% damage and purges 1 buff" (Sefuba, Voron): the purged Defense Up still stands
 *    for that hit. "purges 1 buff … and deals 150% damage" (Zeolite, Tithonus) removes it first.
 *  - "inflicts Stasis … and deals 210% damage" (Tygr): his own "+30% to enemies with Stasis" counts
 *    the Stasis that cast just landed, on the aimed enemy and the splashed one alike.
 *
 * Real kits via `buildTraceShip` (refit 4). Bystanders are skill-less hulls with tagged one-clause
 * text and the always-neutral antimatter affinity — a removal does not land for a caster at an
 * affinity disadvantage (R103), which would make every removal look like a no-op. Every board runs
 * with the subject on the player side and mirrored onto the enemy side. Every claim compares two
 * arms that differ in ONE thing (the buff the bystander holds, or the subject's clause order), so
 * the instrument can report either answer.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { CombatEvent } from '../events';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { setupKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { Position } from '../../../types/encounters';
import type { Ship } from '../../../types/ship';

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
    ship?: Partial<Ship>;
}

const placement = (s: Spec): BattlePlacement => {
    const ship = buildTraceShip(s.name);
    if (!ship) throw new Error(`${s.name} missing from reference data`);
    return {
        ship: { ...ship, id: s.id, affinity: 'antimatter', ...s.ship },
        position: s.position,
        statOverrides: {
            attack: s.attack ?? 0,
            crit: 0,
            critDamage: 100,
            defensePenetration: 0,
            hacking: 1e6,
            security: 0,
            defence: s.defence ?? 0,
            hp: 1e12,
            speed: s.speed,
        },
    };
};

interface Run {
    events: CombatEvent[];
    idOf: (specId: string) => string;
}

const run = (subjects: Spec[], opponents: Spec[], side: Side, rounds: number): Run => {
    tap.recorded.length = 0;
    tap.buses = 0;
    setupKeyedRng(1);
    const playerSpecs = side === 'player' ? subjects : opponents;
    const enemySpecs = side === 'player' ? opponents : subjects;
    const ids = new Map<string, string>();
    playerSpecs.forEach((s, i) => ids.set(s.id, i === 0 ? 'attacker' : `p:${s.id}:${i}`));
    enemySpecs.forEach((s, i) => ids.set(s.id, `e:${s.id}:${i}`));
    simulateBattle({
        playerTeam: playerSpecs.map(placement),
        enemyTeam: enemySpecs.map(placement),
        rounds,
    });
    return {
        events: [...tap.recorded],
        idOf: (specId) => {
            const id = ids.get(specId);
            if (!id) throw new Error(`no actor for ${specId}`);
            return id;
        },
    };
};

type AttackedRow = Extract<CombatEvent, { type: 'attacked' }>;

/** The subject's FIRST cast hit on `target` in `round` (a later extra action's hit is not it). */
const firstCastHit = (r: Run, attacker: string, target: string, round: number): AttackedRow => {
    const row = r.events.find(
        (e): e is AttackedRow =>
            e.type === 'attacked' &&
            e.reactiveHitId === undefined &&
            e.attackerId === r.idOf(attacker) &&
            e.targetId === r.idOf(target) &&
            e.round === round
    );
    if (!row) throw new Error(`no cast hit ${attacker} -> ${target} in round ${round}`);
    expect(row.damage).toBeGreaterThan(0);
    return row;
};

const indexOfFirst = (r: Run, pred: (e: CombatEvent) => boolean): number => {
    const i = r.events.findIndex(pred);
    expect(i).toBeGreaterThanOrEqual(0);
    return i;
};

/** A skill-less hull that casts ONE tagged clause every turn. */
const hull = (id: string, position: Position, speed: number, text: string, defence = 0): Spec => ({
    id,
    name: 'Bedrock',
    position,
    speed,
    defence,
    ship: {
        activeSkillText: text,
        chargeSkillText: '',
        firstPassiveSkillText: '',
        secondPassiveSkillText: '',
        thirdPassiveSkillText: '',
        refits: [],
    },
});
const selfBuff = (name: string) => `This Unit gains <unit-skill>${name}</unit-skill> for 3 turns.`;
const inflict = (name: string) =>
    `This Unit inflicts <unit-skill>${name}</unit-skill> for 2 turns.`;

/** A real kit with a 1-charge charged skill, so it casts its charged skill in round 2. */
const subject = (name: string, over: Partial<Ship> = {}, chargeSkillCharge?: number): Spec => ({
    id: 'S',
    name,
    position: 'M4',
    speed: 100,
    attack: 5000,
    ship: { ...(chargeSkillCharge !== undefined ? { chargeSkillCharge } : {}), ...over },
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('a stolen buff counts for the damage written after the steal', () => {
    // The body (speed 300) re-gains its buff every round before the thief acts. Round 2 is the
    // thief's charged cast. Out. Damage Up II is +30% outgoing; Speed Up I moves no damage.
    const body = (buff: string) => hull('Body', 'M4', 300, selfBuff(buff));

    it.each(SIDES)(
        'Thresh charged: Out. Damage Up II stolen first raises the hit x1.30 (%s side)',
        (side) => {
            const thresh = subject('Thresh', {}, 1);
            const stolenDamage = run([thresh], [body('Out. Damage Up II')], side, 2);
            const stolenSpeed = run([thresh], [body('Speed Up I')], side, 2);
            // Both arms steal one buff (Thresh's per-buff penetration sees one either way).
            for (const r of [stolenDamage, stolenSpeed]) {
                expect(r.events.some((e) => e.type === 'steal-performed' && e.round === 2)).toBe(
                    true
                );
            }
            expect(
                firstCastHit(stolenDamage, 'S', 'Body', 2).damage! /
                    firstCastHit(stolenSpeed, 'S', 'Body', 2).damage!
            ).toBeCloseTo(1.3, 9);
        }
    );

    it.each(SIDES)('Tithonus charged: the stolen buff raises the hit x1.30 (%s side)', (side) => {
        const tithonus = subject('Tithonus', {}, 1);
        const a = run([tithonus], [body('Out. Damage Up II')], side, 2);
        const b = run([tithonus], [body('Speed Up I')], side, 2);
        // Six places, not nine: his R4 "more damage based on the target's missing HP" reads the
        // body's HP after the round-1 hit, which differs between the arms in the tenth place.
        expect(
            firstCastHit(a, 'S', 'Body', 2).damage! / firstCastHit(b, 'S', 'Body', 2).damage!
        ).toBeCloseTo(1.3, 6);
    });

    it.each(SIDES)('Pallas charged: the stolen buff raises the hit x1.30 (%s side)', (side) => {
        const pallas = subject('Pallas', {}, 1);
        const a = run([pallas], [body('Out. Damage Up II')], side, 2);
        const b = run([pallas], [body('Speed Up I')], side, 2);
        expect(
            firstCastHit(a, 'S', 'Body', 2).damage! / firstCastHit(b, 'S', 'Body', 2).damage!
        ).toBeCloseTo(1.3, 9);
    });

    it.each(SIDES)(
        'control: a steal written after the damage does not raise it (%s side)',
        (side) => {
            const thresh = subject(
                'Thresh',
                {
                    chargeSkillText:
                        'This Unit deals <unit-damage>300% damage</unit-damage> and <unit-skill>steals 1 buff</unit-skill>.',
                },
                1
            );
            const a = run([thresh], [body('Out. Damage Up II')], side, 2);
            const b = run([thresh], [body('Speed Up I')], side, 2);
            expect(a.events.some((e) => e.type === 'steal-performed' && e.round === 2)).toBe(true);
            expect(
                firstCastHit(a, 'S', 'Body', 2).damage! / firstCastHit(b, 'S', 'Body', 2).damage!
            ).toBeCloseTo(1, 9);
        }
    );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('a cleanse written before the damage clears the debuff from that hit', () => {
    // The body (speed 300) inflicts one debuff on the subject before it acts in round 1. Attack
    // Down II cuts the subject's attack; Speed Down I moves no round-1 damage. The subject's
    // round-start passives see no debuff in either arm (round 1 starts clean).
    const body = (debuff: string) => hull('Body', 'M4', 300, inflict(debuff));

    it.each(SIDES)(
        'Sustainer active: Attack Down II is cleansed before the hit (%s side)',
        (side) => {
            const sustainer = subject('Sustainer');
            const attackDown = run([sustainer], [body('Attack Down II')], side, 1);
            const speedDown = run([sustainer], [body('Speed Down I')], side, 1);
            expect(attackDown.events.some((e) => e.type === 'cleanse-performed')).toBe(true);
            expect(firstCastHit(attackDown, 'S', 'Body', 1).damage!).toBeCloseTo(
                firstCastHit(speedDown, 'S', 'Body', 1).damage!,
                6
            );
        }
    );

    it.each(SIDES)('Laika active: Attack Down II is cleansed before the hit (%s side)', (side) => {
        const laika = subject('Laika');
        const attackDown = run([laika], [body('Attack Down II')], side, 1);
        const speedDown = run([laika], [body('Speed Down I')], side, 1);
        expect(firstCastHit(attackDown, 'S', 'Body', 1).damage!).toBeCloseTo(
            firstCastHit(speedDown, 'S', 'Body', 1).damage!,
            6
        );
    });

    it.each(SIDES)(
        'control: a cleanse written after the damage leaves the debuff on that hit (%s side)',
        (side) => {
            const sustainer = subject('Sustainer', {
                activeSkillText:
                    'This Unit deals <unit-damage>145% damage</unit-damage> and <unit-skill>cleanses 2 debuffs</unit-skill>.',
            });
            const attackDown = run([sustainer], [body('Attack Down II')], side, 1);
            const speedDown = run([sustainer], [body('Speed Down I')], side, 1);
            expect(attackDown.events.some((e) => e.type === 'cleanse-performed')).toBe(true);
            expect(firstCastHit(attackDown, 'S', 'Body', 1).damage!).toBeLessThan(
                firstCastHit(speedDown, 'S', 'Body', 1).damage! * 0.9
            );
        }
    );

    it.each(SIDES)(
        'Nosorog charged (cleanse after the damage) keeps the debuff on that hit (%s side)',
        (side) => {
            // Round 1 Nosorog's active; round 2 the body re-inflicts, then his charged hits and cleanses.
            const nosorog = subject('Nosorog', {}, 1);
            const attackDown = run([nosorog], [body('Attack Down II')], side, 2);
            const speedDown = run([nosorog], [body('Speed Down I')], side, 2);
            expect(firstCastHit(attackDown, 'S', 'Body', 2).damage!).toBeLessThan(
                firstCastHit(speedDown, 'S', 'Body', 2).damage! * 0.9
            );
        }
    );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('a purge resolves where it is written relative to the damage', () => {
    // The body (speed 300, defence 3000) re-gains Defense Up III (+45% defence) each round
    // before the subject acts; the clean arm's body gains Speed Up I instead.
    const body = (buff: string) => hull('Body', 'M4', 300, selfBuff(buff), 3000);
    const DEF_UP = 'Defense Up III';
    const NEUTRAL = 'Speed Up I';
    const purged = (r: Run, round: number) =>
        r.events.some((e) => e.type === 'purge-performed' && e.round === round);
    const attackedIdx = (r: Run, round: number) =>
        indexOfFirst(
            r,
            (e) => e.type === 'attacked' && e.attackerId === r.idOf('S') && e.round === round
        );
    const purgeIdx = (r: Run, round: number) =>
        indexOfFirst(
            r,
            (e) => e.type === 'purge-performed' && e.casterId === r.idOf('S') && e.round === round
        );

    it.each(SIDES)(
        'Sefuba active ("deals 160% damage and purges 1 buff"): the buff stands for the hit (%s side)',
        (side) => {
            const sefuba = subject('Sefuba');
            const buffed = run([sefuba], [body(DEF_UP)], side, 1);
            const clean = run([sefuba], [body(NEUTRAL)], side, 1);
            // Same hit with no purge clause at all: the Defense Up III stands for it.
            const noPurge = run(
                [
                    subject('Sefuba', {
                        activeSkillText: 'This Unit deals <unit-damage>160% damage</unit-damage>.',
                    }),
                ],
                [body(DEF_UP)],
                side,
                1
            );
            expect(purged(buffed, 1)).toBe(true);
            expect(firstCastHit(buffed, 'S', 'Body', 1).damage!).toBeCloseTo(
                firstCastHit(noPurge, 'S', 'Body', 1).damage!,
                6
            );
            expect(firstCastHit(buffed, 'S', 'Body', 1).damage!).toBeLessThan(
                firstCastHit(clean, 'S', 'Body', 1).damage! * 0.95
            );
            expect(purgeIdx(buffed, 1)).toBeGreaterThan(attackedIdx(buffed, 1));
        }
    );

    it.each(SIDES)(
        'control: the same purge written first removes the buff before the hit (%s side)',
        (side) => {
            const flipped = subject('Sefuba', {
                activeSkillText:
                    'This Unit <unit-skill>purges 1 buff</unit-skill> from the enemy and deals <unit-damage>160% damage</unit-damage>.',
            });
            const buffed = run([flipped], [body(DEF_UP)], side, 1);
            const clean = run([flipped], [body(NEUTRAL)], side, 1);
            expect(firstCastHit(buffed, 'S', 'Body', 1).damage!).toBeCloseTo(
                firstCastHit(clean, 'S', 'Body', 1).damage!,
                6
            );
            expect(purgeIdx(buffed, 1)).toBeLessThan(attackedIdx(buffed, 1));
        }
    );

    it.each(SIDES)(
        'Voron charged ("deals 230% damage and purges 1 buff"): the buff stands for the hit (%s side)',
        (side) => {
            const voron = subject('Voron', {}, 1);
            const buffed = run([voron], [body(DEF_UP)], side, 2);
            const clean = run([voron], [body(NEUTRAL)], side, 2);
            expect(purged(buffed, 2)).toBe(true);
            expect(firstCastHit(buffed, 'S', 'Body', 2).damage!).toBeLessThan(
                firstCastHit(clean, 'S', 'Body', 2).damage! * 0.95
            );
            expect(purgeIdx(buffed, 2)).toBeGreaterThan(attackedIdx(buffed, 2));
        }
    );

    it.each(SIDES)(
        'Zeolite active ("purges 1 buff …, and deals 150% damage"): purged before the hit (%s side)',
        (side) => {
            const zeolite = subject('Zeolite');
            const buffed = run([zeolite], [body(DEF_UP)], side, 1);
            const clean = run([zeolite], [body(NEUTRAL)], side, 1);
            expect(purged(buffed, 1)).toBe(true);
            expect(firstCastHit(buffed, 'S', 'Body', 1).damage!).toBeCloseTo(
                firstCastHit(clean, 'S', 'Body', 1).damage!,
                6
            );
            expect(purgeIdx(buffed, 1)).toBeLessThan(attackedIdx(buffed, 1));
        }
    );

    it.each(SIDES)(
        'Tithonus active ("purges 2 buffs … and deals 170% damage"): purged before the hit (%s side)',
        (side) => {
            const tithonus = subject('Tithonus');
            const buffed = run([tithonus], [body(DEF_UP)], side, 1);
            const clean = run([tithonus], [body(NEUTRAL)], side, 1);
            expect(purged(buffed, 1)).toBe(true);
            expect(firstCastHit(buffed, 'S', 'Body', 1).damage!).toBeCloseTo(
                firstCastHit(clean, 'S', 'Body', 1).damage!,
                6
            );
        }
    );
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('Tygr\'s own Stasis counts for his "+30% to enemies with Stasis" on the same cast', () => {
    // Two bodies in one line: the charged cast's aimed enemy and its splash. Round 2 is the
    // charged cast (charge 1). The no-aura arm keeps every other word of his R4 passive.
    const bodies = [
        hull('A', 'M4', 300, selfBuff('Speed Up I')),
        hull('B', 'M3', 300, selfBuff('Speed Up I')),
    ];
    const tygr = (aura: boolean, chargeSkillText?: string): Spec =>
        subject(
            'Tygr',
            {
                ...(aura
                    ? {}
                    : {
                          thirdPassiveSkillText:
                              "This Unit's attacks do not reduce Stasis. After damaging an enemy affected by <unit-skill>Stasis</unit-skill>, once per round, this Unit gains <unit-skill>one extra action</unit-skill>.",
                      }),
                ...(chargeSkillText !== undefined ? { chargeSkillText } : {}),
            },
            1
        );
    const charged = (r: Run, target: string) => firstCastHit(r, 'S', target, 2).damage!;

    it.each(SIDES)(
        'charged "inflicts Stasis … and deals 210%": aimed and splash hits x1.30 (%s side)',
        (side) => {
            const withAura = run([tygr(true)], bodies, side, 2);
            const noAura = run([tygr(false)], bodies, side, 2);
            // Instrument: the charged cast landed Stasis on both bodies in round 2.
            for (const t of ['A', 'B']) {
                expect(
                    withAura.events.some(
                        (e) =>
                            e.type === 'debuff-applied' &&
                            e.buffName === 'Stasis' &&
                            e.targetId === withAura.idOf(t) &&
                            e.round === 2
                    )
                ).toBe(true);
                expect(charged(withAura, t) / charged(noAura, t)).toBeCloseTo(1.3, 9);
            }
        }
    );

    it.each(SIDES)(
        'control: Stasis written after the damage does not boost that hit (%s side)',
        (side) => {
            const text =
                'This Unit deals <unit-damage>210% damage</unit-damage> and inflicts <unit-skill>Stasis</unit-skill> for 3 turns.';
            const withAura = run([tygr(true, text)], bodies, side, 2);
            const noAura = run([tygr(false, text)], bodies, side, 2);
            for (const t of ['A', 'B']) {
                expect(charged(withAura, t) / charged(noAura, t)).toBeCloseTo(1, 9);
            }
        }
    );
});
