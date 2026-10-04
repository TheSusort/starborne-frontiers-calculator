/**
 * Every DoT STACK inflicted gets its own landing (hacking-vs-security) roll (owner ruling R30,
 * 2026-10-04). Snakeroot's "inflicts 2 stacks of Corrosion I" on B is two independent rolls, so 0,
 * 1 or 2 stacks land; each stack whose roll fails is a resist, and a resist reaction fires once per
 * failed stack. A partly landed application leaves ONE entry holding the stacks that landed — never
 * a 0-stack entry.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv), single-target (Pattern-Base) casts from
 * M4 at the enemy in front. The caster's hacking is 50 against 0 security — a 50% landing chance —
 * and each case is swept over a run of seeds, so a fixture that only ever rolled "all land" or
 * "none land" cannot pass. Each case runs on both sides: a player caster against enemy A, and an
 * enemy caster against the player focus.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills, SkillSlot } from '../../../types/abilities';
import type { CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const kit = (ship: string, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.filter((s) => slots.includes(s.slot));
    if (found.length !== slots.length) throw new Error(`${ship} lacks one of ${slots.join(',')}`);
    return { slots: found };
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

/** "When this Unit resists a debuff, it gains a shield equal to 1% of its max HP" — one
 *  `shield-applied` per resist its listener sees. Hand-built: no shipped resist reaction both
 *  counts every resist and leaves an event behind (Prophet's per-resist pen gain is silent). */
const RESIST_SHIELD: Ability = {
    id: 'resist-shield',
    type: 'shield',
    target: 'self',
    trigger: 'on-debuff-resisted',
    conditions: [],
    config: { type: 'shield', pct: 1, basis: 'hp' },
};
const victimKit = (resistReaction: boolean): ShipSkills =>
    resistReaction
        ? {
              slots: [
                  { slot: 'active', abilities: [] },
                  { slot: 'passive', abilities: [RESIST_SHIELD] },
              ],
          }
        : NO_SKILLS;

const HP = 1e6;

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: NO_SKILLS,
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

interface Side {
    tag: string;
    casterId: string;
    victimId: string;
    input: (k: ShipSkills, hacking: number, resistReaction: boolean) => CombatEngineInput;
}

const PLAYER: Side = {
    tag: 'player',
    casterId: 'attacker',
    victimId: 'enemy-a',
    input: (k, hacking, resistReaction) =>
        base({
            shipSkills: k,
            hacking,
            hasChargedSkill: true,
            chargeCount: 9,
            enemyAttackers: [
                {
                    id: 'enemy-a',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1e9,
                        speed: 10,
                        security: 0,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: victimKit(resistReaction),
                } satisfies EnemyAttacker,
            ],
        }),
};

const ENEMY: Side = {
    tag: 'enemy-side',
    casterId: 'enemy-caster',
    victimId: 'attacker',
    input: (k, hacking, resistReaction) =>
        base({
            attack: 0,
            speed: 10,
            shipSkills: victimKit(resistReaction),
            enemyAttackers: [
                {
                    id: 'enemy-caster',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: HP,
                        speed: 100,
                        security: 0,
                        hacking,
                    },
                    chargeCount: 9,
                    startCharged: false,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: k,
                },
            ],
        }),
};

interface Outcome {
    /** Stacks the caster's round-1 `dot-applied` events report on the victim. */
    landedStacks: number;
    /** The caster's round-1 roll resists (`viaLandingRoll`) on the victim. */
    rollResists: number;
    /** The victim's round-1 `shield-applied` from its own resist reaction. */
    resistReactions: number;
    /** The victim's DoT entries' stack counts once the round ends. */
    entries: number[];
}

const runOnce = (
    side: Side,
    k: ShipSkills,
    hacking: number,
    seed: number,
    resistReaction = false
): Outcome => {
    setupKeyedRng(seed);
    const bus = createEventBus();
    const out: Outcome = { landedStacks: 0, rollResists: 0, resistReactions: 0, entries: [] };
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        if (e.sourceId === side.casterId && e.targetId === side.victimId && e.round === 1)
            out.landedStacks += e.stacks;
    });
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        if (
            e.sourceId === side.casterId &&
            e.targetId === side.victimId &&
            e.round === 1 &&
            e.viaLandingRoll === true
        )
            out.rollResists += 1;
    });
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        if (e.granterId === side.victimId && e.round === 1) out.resistReactions += 1;
    });
    runCombat({
        ...side.input(k, hacking, resistReaction),
        bus,
        __testTapActors: (all: CombatActor[]) => {
            const v = all.find((a) => a.id === side.victimId);
            if (!v) throw new Error('victim missing');
            bus.on('round-ended', () => {
                out.entries = [...v.corrosionEntries, ...v.infernoEntries, ...v.pendingBombs].map(
                    (e) => e.stacks
                );
            });
        },
    });
    return out;
};

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

describe('R30: each stack of a multi-stack DoT rolls its own landing', () => {
    const cases: { ship: string; stacks: number }[] = [
        { ship: 'Snakeroot', stacks: 2 },
        { ship: 'Lingshe', stacks: 3 },
    ];
    for (const side of [PLAYER, ENEMY]) {
        for (const { ship, stacks } of cases) {
            it(`${side.tag}: ${ship}'s ${stacks}-stack application lands stack by stack at 50%`, () => {
                const k = kit(ship, ['active']);
                const landed = new Set<number>();
                for (const seed of SEEDS) {
                    const o = runOnce(side, k, 50, seed);
                    // Every stack is decided: it lands or it is a roll resist.
                    expect(o.landedStacks + o.rollResists).toBe(stacks);
                    // The landed stacks sit in ONE entry; nothing lands → no entry at all.
                    expect(o.entries).toEqual(o.landedStacks > 0 ? [o.landedStacks] : []);
                    landed.add(o.landedStacks);
                }
                // A partial landing happens — one shared roll could only give 0 or all.
                expect([...landed].some((n) => n > 0 && n < stacks)).toBe(true);
            });
        }

        it(`${side.tag}: a sure landing (chance 100%) lands both stacks, no resist`, () => {
            const o = runOnce(side, kit('Snakeroot', ['active']), 1e6, 1);
            expect(o).toMatchObject({ landedStacks: 2, rollResists: 0, entries: [2] });
        });

        it(`${side.tag}: a sure resist (chance 0%) is two roll resists and no entry`, () => {
            const o = runOnce(side, kit('Snakeroot', ['active']), 0, 1);
            expect(o).toMatchObject({ landedStacks: 0, rollResists: 2, entries: [] });
        });

        it(`${side.tag}: the victim's resist reaction fires once per failed stack`, () => {
            const o = runOnce(side, kit('Snakeroot', ['active']), 0, 1, true);
            expect(o.rollResists).toBe(2);
            expect(o.resistReactions).toBe(2);
        });

        it(`${side.tag}: negative — a landed stack is no resist, so the reaction stays quiet`, () => {
            const o = runOnce(side, kit('Snakeroot', ['active']), 1e6, 1, true);
            expect(o.resistReactions).toBe(0);
        });
    }
});

describe('R30: a covered enemy rolls each stack too', () => {
    type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
    const cone = parsePattern('Pattern-Cone-Range-1');
    const harmless = (id: string, position: 'M4' | 'M3' | 'T3'): EnemyAttacker => ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 10, security: 0 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills: NO_SKILLS,
    });
    const ally = (id: string, position: 'M3' | 'T3'): TeamActor => ({
        id,
        speed: 10,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        walk: {
            shipSkills: NO_SKILLS,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1e9,
                security: 0,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });
    const coneSides: { side: Side; covered: string }[] = [
        {
            covered: 'enemy-b',
            side: {
                ...PLAYER,
                input: (k, hacking) =>
                    base({
                        shipSkills: k,
                        hacking,
                        pattern: cone,
                        hasChargedSkill: true,
                        chargeCount: 9,
                        enemyAttackers: [
                            harmless('enemy-a', 'M4'),
                            harmless('enemy-b', 'M3'),
                            harmless('enemy-c', 'T3'),
                        ],
                    }),
            },
        },
        {
            covered: 'ally-b',
            side: {
                ...ENEMY,
                input: (k, hacking) => {
                    const i = ENEMY.input(k, hacking, false);
                    return {
                        ...i,
                        teamActors: [ally('ally-b', 'M3'), ally('ally-c', 'T3')],
                        enemyAttackers: (i.enemyAttackers ?? []).map((e) => ({
                            ...e,
                            pattern: cone,
                        })),
                    };
                },
            },
        },
    ];
    for (const { side, covered } of coneSides) {
        it(`${side.tag}: Snakeroot's Corrosion on covered ${covered} lands stack by stack`, () => {
            const k = kit('Snakeroot', ['active']);
            const coveredSide: Side = { ...side, victimId: covered };
            const landed = new Set<number>();
            for (const seed of SEEDS) {
                const o = runOnce(coveredSide, k, 50, seed);
                expect(o.landedStacks + o.rollResists).toBe(2);
                expect(o.entries).toEqual(o.landedStacks > 0 ? [o.landedStacks] : []);
                landed.add(o.landedStacks);
            }
            expect(landed.has(1)).toBe(true);
        });
    }
});

describe('R30: a reactive multi-stack DoT rolls each stack', () => {
    // No shipped reactive DoT carries more than one stack; this hand-built "when this Unit is
    // attacked, it inflicts 2 stacks of Inferno II on its attacker" walks the reactive executor.
    const RETALIATE: Ability = {
        id: 'retaliate-dot',
        type: 'dot',
        target: 'enemy',
        trigger: 'on-attacked',
        conditions: [],
        config: { type: 'dot', dotType: 'inferno', stacks: 2, tier: 30, duration: 2 },
    };
    const HIT: Ability = {
        id: 'hit',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100 },
    };
    const reactorKit: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [] },
            { slot: 'passive', abilities: [RETALIATE] },
        ],
    };
    const hitterKit: ShipSkills = { slots: [{ slot: 'active', abilities: [HIT] }] };
    const reactiveSides: Side[] = [
        {
            // The player focus reacts; the enemy that hits it is the victim.
            tag: 'player',
            casterId: 'attacker',
            victimId: 'enemy-a',
            input: (_k, hacking) =>
                base({
                    shipSkills: reactorKit,
                    hacking,
                    speed: 10,
                    enemyAttackers: [
                        {
                            id: 'enemy-a',
                            stats: {
                                attack: 1000,
                                crit: 0,
                                critDamage: 0,
                                defence: 0,
                                hp: 1e9,
                                speed: 100,
                                security: 0,
                            },
                            chargeCount: 0,
                            startCharged: false,
                            position: 'M4',
                            target: parseTarget('front'),
                            pattern: parsePattern('Pattern-Base'),
                            shipSkills: hitterKit,
                        },
                    ],
                }),
        },
        {
            // The enemy reacts; the player focus that hits it is the victim.
            tag: 'enemy-side',
            casterId: 'enemy-caster',
            victimId: 'attacker',
            input: (_k, hacking) => {
                const i = ENEMY.input(reactorKit, hacking, false);
                return {
                    ...i,
                    shipSkills: hitterKit,
                    attack: 1000,
                    speed: 100,
                    enemyAttackers: (i.enemyAttackers ?? []).map((e) => ({
                        ...e,
                        stats: { ...e.stats, speed: 10 },
                    })),
                };
            },
        },
    ];
    for (const side of reactiveSides) {
        it(`${side.tag}: the retaliation's 2 stacks land stack by stack`, () => {
            const landed = new Set<number>();
            for (const seed of SEEDS) {
                const o = runOnce(side, NO_SKILLS, 50, seed);
                expect(o.landedStacks + o.rollResists).toBe(2);
                expect(o.entries).toEqual(o.landedStacks > 0 ? [o.landedStacks] : []);
                landed.add(o.landedStacks);
            }
            expect(landed.has(1)).toBe(true);
        });
    }
});

describe('R30: a single-stack DoT keeps its one shared roll', () => {
    // Pinned on the pre-R30 engine: one stack, one draw, at the same point in the turn — the
    // per-stack rolls add draws only for a second and later stack.
    const PIN: Record<string, number[]> = {
        player: [1, 3, 6, 7, 12, 13, 14, 15, 16, 18, 22, 23],
        'enemy-side': [2, 4, 5, 7, 8, 9, 10, 13, 15, 16, 17, 22],
    };
    for (const side of [PLAYER, ENEMY]) {
        it(`${side.tag}: Wisteria's 1-stack Corrosion lands on exactly the pinned seeds`, () => {
            const k = kit('Wisteria', ['active']);
            const landedSeeds = SEEDS.filter((seed) => {
                const o = runOnce(side, k, 50, seed);
                expect(o.landedStacks + o.rollResists).toBe(1);
                return o.landedStacks === 1;
            });
            expect(landedSeeds).toEqual(PIN[side.tag]);
        });
    }
});
