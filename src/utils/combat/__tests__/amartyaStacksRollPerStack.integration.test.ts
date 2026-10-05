/**
 * A non-DoT "inflicts N stacks of X" rolls each stack on its own (owner ruling R48, 2026-10-05 —
 * the R30 mirror): Amartya's "When an enemy defender is directly repaired, this Unit inflicts 2
 * stacks of Defense Shred on that defender" against a 50% landing chance lands 0, 1 or 2 stacks,
 * and each failed stack is its own resist. A reaction to a debuff being inflicted fires once per
 * stack that lands (R28): an ally APEX gains one 3% shield per landed stack. The same holds for her
 * "When an enemy defender gains Taunt, … inflicts 2 stacks of Exposed".
 *
 * Real parsed passives (buildTraceShip, refit 4): Amartya, APEX; Madax's real active (a DEFENDER
 * that gains Taunt). Amartya's hacking 50 against security 0 is a 50% chance per stack.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { ShipSkills } from '../../../types/abilities';
import type { StatusEngine } from '../statusEngine';
import { mirrorBoard, realSlots, ShipSpec, MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

const APEX_HP = 100_000;

const amartya = (hacking: number): ShipSpec => ({
    id: 'amartya',
    position: 'M4',
    speed: 10,
    hacking,
    skills: { slots: [{ slot: 'active', abilities: [] }, ...realSlots('Amartya', ['passive'])] },
});

/** APEX's passive alone, beside Amartya: "gains a shield equal to 3% of their max HP when an enemy
 *  gets inflicted with a debuff". */
const apex = (): ShipSpec => ({
    id: 'apex',
    position: 'M3',
    speed: 5,
    hp: APEX_HP,
    skills: { slots: [{ slot: 'active', abilities: [] }, ...realSlots('APEX', ['passive'])] },
});

const healAll = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'healer-repair',
                    type: 'heal',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                },
            ],
        },
    ],
});

interface PerRound {
    landed: number;
    resisted: number;
}

interface Measured {
    rounds: PerRound[];
    /** Stacks of `status` on the defender after the fight (persistent statuses only). */
    finalStacks: number;
    /** APEX's 3% shield grants. */
    apexShields: number;
    /** Stacks on the defender right after each landing event, per round (max). */
    stacksAtLanding: number[];
}

const measure = (
    teams: MirrorTeams,
    side: 'player' | 'enemy',
    status: string,
    defenderSpec: string,
    seed: number
): Measured => {
    setupKeyedRng(seed);
    const { input, idOf } = mirrorBoard(teams, side);
    const caster = idOf('amartya');
    const defender = idOf(defenderSpec);
    const apexId = idOf('apex');
    const rounds: PerRound[] = Array.from({ length: teams.numRounds ?? 1 }, () => ({
        landed: 0,
        resisted: 0,
    }));
    const stacksAtLanding: number[] = rounds.map(() => 0);
    let apexShields = 0;
    let engine: StatusEngine | undefined;
    const stacksOn = (): number =>
        engine
            ?.timedAbilityStatuses('enemy', undefined, defender)
            .find((s) => s.active.buffName === status)?.active.stacks ??
        engine
            ?.timedAbilityStatuses('enemy', undefined, defender)
            .find((s) => s.active.buffName === status)?.payload.stacks ??
        0;
    const bus = createEventBus();
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId !== caster || e.buffName !== status || e.targetId !== defender) return;
        rounds[e.round - 1].landed += 1;
        stacksAtLanding[e.round - 1] = Math.max(stacksAtLanding[e.round - 1], stacksOn());
    });
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        if (e.sourceId === caster && e.buffName === status && e.targetId === defender)
            rounds[e.round - 1].resisted += 1;
    });
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        if (e.granterId === apexId) apexShields += 1;
    });
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (se) => {
            engine = se;
        },
    });
    return { rounds, finalStacks: stacksOn(), apexShields, stacksAtLanding };
};

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const ROUNDS = 4;

describe('Amartya: "inflicts 2 stacks of Defense Shred" rolls each stack (R48)', () => {
    const teams = (hacking: number, reverse: boolean): MirrorTeams => ({
        caster: [amartya(hacking), apex()],
        // Reverse board: the defender repairs itself and an attacker, rather than a supporter
        // repairing a defender.
        other: reverse
            ? [
                  { id: 'x', position: 'M4', speed: 150, role: 'DEFENDER', skills: healAll() },
                  { id: 'y', position: 'M3', speed: 1, role: 'ATTACKER' },
              ]
            : [
                  {
                      id: 'healer',
                      position: 'M4',
                      speed: 150,
                      role: 'SUPPORTER',
                      skills: healAll(),
                  },
                  { id: 'x', position: 'M3', speed: 1, role: 'DEFENDER' },
              ],
        numRounds: ROUNDS,
    });
    for (const side of ['player', 'enemy'] as const) {
        for (const reverse of [false, true]) {
            const tag = `${side}-side${reverse ? ', reverse board' : ''}`;
            it(`${tag}: 50% per stack → each repair rolls twice, and a single stack can land`, () => {
                let singles = 0;
                for (const seed of SEEDS) {
                    const m = measure(teams(50, reverse), side, 'Defense Shred', 'x', seed);
                    for (const r of m.rounds) {
                        expect(r.landed + r.resisted).toBe(2);
                        if (r.landed === 1) singles += 1;
                    }
                    const landed = m.rounds.reduce((s, r) => s + r.landed, 0);
                    // Every landed stack is on the defender, and each gave APEX one shield.
                    expect(m.finalStacks).toBe(landed);
                    expect(m.apexShields).toBe(landed);
                }
                expect(singles).toBeGreaterThan(0);
            });
            it(`${tag}: a certain landing → both stacks, two APEX shields per repair`, () => {
                const m = measure(teams(1e6, reverse), side, 'Defense Shred', 'x', 1);
                expect(m.rounds).toEqual(Array(ROUNDS).fill({ landed: 2, resisted: 0 }));
                expect(m.finalStacks).toBe(2 * ROUNDS);
                expect(m.apexShields).toBe(2 * ROUNDS);
            });
            it(`${tag}: no chance → two resists per repair, nothing lands, no APEX shield`, () => {
                const m = measure(teams(0, reverse), side, 'Defense Shred', 'x', 1);
                expect(m.rounds).toEqual(Array(ROUNDS).fill({ landed: 0, resisted: 2 }));
                expect(m.finalStacks).toBe(0);
                expect(m.apexShields).toBe(0);
            });
        }
    }
});

describe('Amartya: "inflicts 2 stacks of Exposed" rolls each stack (R48)', () => {
    const teams = (hacking: number): MirrorTeams => ({
        caster: [amartya(hacking), apex()],
        other: [
            {
                id: 'madax',
                position: 'M4',
                speed: 150,
                role: 'DEFENDER',
                skills: { slots: realSlots('Madax', ['active']) },
            },
        ],
        numRounds: ROUNDS,
    });
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: 50% per stack → each Taunt rolls twice; landed stacks = events`, () => {
            let singles = 0;
            for (const seed of SEEDS) {
                const m = measure(teams(50), side, 'Exposed', 'madax', seed);
                m.rounds.forEach((r, i) => {
                    expect(r.landed + r.resisted).toBe(2);
                    if (r.landed > 0) expect(m.stacksAtLanding[i]).toBe(r.landed);
                    if (r.landed === 1) singles += 1;
                });
                const landed = m.rounds.reduce((s, r) => s + r.landed, 0);
                expect(m.apexShields).toBe(landed);
            }
            expect(singles).toBeGreaterThan(0);
        });
        it(`${side}-side: a certain landing → 2 Exposed stacks each Taunt`, () => {
            const m = measure(teams(1e6), side, 'Exposed', 'madax', 1);
            expect(m.rounds).toEqual(Array(ROUNDS).fill({ landed: 2, resisted: 0 }));
            expect(m.stacksAtLanding).toEqual(Array(ROUNDS).fill(2));
        });
    }
});

describe('corpus tripwire: a multi-stack non-DoT infliction is reactive (R48)', () => {
    it('only reactive debuffs carry stacks > 1 — the cast path rolls a debuff once', () => {
        // The per-stack roll lives in the reactive `debuff` executor. A cast-path (on-cast)
        // multi-stack debuff would land all-or-nothing, so a data refresh that adds one must
        // route it there first.
        const castMultiStack: string[] = [];
        let reactiveMultiStack = 0;
        for (const { name } of loadShipSkillRecords()) {
            const built = buildTraceShip(name);
            if (!built) continue;
            for (const slot of buildShipAbilities(built).slots) {
                for (const a of slot.abilities) {
                    if (a.config.type !== 'debuff' || (a.config.stacks ?? 1) <= 1) continue;
                    if (a.trigger === 'on-cast') castMultiStack.push(`${name} ${slot.slot}`);
                    else reactiveMultiStack += 1;
                }
            }
        }
        expect(castMultiStack).toEqual([]);
        // The instrument can see one: Amartya's two "2 stacks" clauses.
        expect(reactiveMultiStack).toBeGreaterThanOrEqual(2);
    });
});
