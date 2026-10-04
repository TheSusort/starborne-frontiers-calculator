/**
 * A cleanse removes DoT STACKS (owner ruling R27, 2026-10-04): each stack is one debuff, so
 * "cleanses 1 debuff" on a ship holding only 2 Corrosion stacks removes ONE stack and leaves 1;
 * "cleanses all debuffs" removes every stack. A named debuff and a DoT stack are both candidates —
 * the newest applied goes first (cleanseRecency.integration.test.ts pins the order; a DoT entry
 * seeded here before the fight is older than anything landed in it). An unremovable DoT (Acidic
 * Decay) stays.
 * A typed cleanse (Nyxen's "cleanses 2 Bomb", "cleanses 2 damage over time debuffs") removes only
 * that kind.
 *
 * The cleansing ship cleanses itself (Laika's and Sustainer's actives, Nuqtu's start-of-turn
 * passive — real parsed kits; hand-built kits for "cleanses all" and the typed cleanse, which no
 * shipped self-cleanse carries). Its debuffs are seeded before anyone acts: DoT entries pushed onto
 * it, and a named Attack Down II landed by a faster enemy. Each case runs on both sides: a player
 * cleanser, and an enemy cleanser.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { ownerDebuffNamesFor } from '../triggers';
import type { StatusEngine } from '../statusEngine';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills, SkillSlot } from '../../../types/abilities';
import type { ActiveDoTStack, CombatActor, PendingBomb } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

beforeEach(() => {
    setupKeyedRng(27);
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
const selfCleanse = (count: number | 'all', debuffType?: 'bomb' | 'dot'): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'self-cleanse',
                    type: 'cleanse',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'cleanse', count, ...(debuffType ? { debuffType } : {}) },
                },
            ],
        },
    ],
});
/** A faster enemy's "inflicts Attack Down II" — the named debuff seed. */
const attackDownKit: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'attack-down',
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Attack Down II',
                        parsedEffects: { attack: -30 },
                        stacks: 1,
                        isStackable: false,
                        duration: 3,
                        application: 'inflict',
                    },
                },
            ],
        },
    ],
};

const HP = 1e9;

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
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

const opponent = (id: string, k: ShipSkills, speed: number): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: HP,
        speed,
        security: 0,
        hacking: 1e6,
    },
    chargeCount: 9,
    startCharged: false,
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: k,
});

interface Side {
    tag: string;
    cleanserId: string;
    input: (cleanser: ShipSkills, seedNamed: boolean) => CombatEngineInput;
}

/** The cleanser acts at speed 100; a named-debuff seeder (speed 200) acts before it. */
const PLAYER: Side = {
    tag: 'player',
    cleanserId: 'attacker',
    input: (cleanser, seedNamed) =>
        base({
            shipSkills: cleanser,
            hasChargedSkill: true,
            chargeCount: 9,
            enemyAttackers: [opponent('enemy-a', seedNamed ? attackDownKit : NO_SKILLS, 200)],
        }),
};

const ENEMY: Side = {
    tag: 'enemy-side',
    cleanserId: 'enemy-cleanser',
    input: (cleanser, seedNamed) =>
        base({
            shipSkills: seedNamed ? attackDownKit : NO_SKILLS,
            speed: 200,
            enemyAttackers: [{ ...opponent('enemy-cleanser', cleanser, 100) }],
        }),
};

interface Seed {
    corrosion?: (number | { stacks: number; unremovable: true })[];
    inferno?: number[];
    bombs?: number[];
    named?: boolean;
}

interface After {
    corrosion: number[];
    inferno: number[];
    bombs: number[];
    named: string[];
}

const entry = (s: number | { stacks: number; unremovable: true }): ActiveDoTStack =>
    typeof s === 'number'
        ? { stacks: s, tier: 1, remainingRounds: 9, sourceId: 'seed' }
        : { stacks: s.stacks, tier: 1, remainingRounds: 9, sourceId: 'seed', unremovable: true };
const bomb = (stacks: number): PendingBomb => ({
    countdown: 9,
    damagePerStack: 1,
    stacks,
    tier: 100,
    sourceId: 'seed',
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

const run = (side: Side, cleanser: ShipSkills, seed: Seed): After => {
    const bus = createEventBus();
    const out: After = { corrosion: [], inferno: [], bombs: [], named: [] };
    let engine: StatusEngine | undefined;
    runCombat({
        ...side.input(cleanser, seed.named === true),
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
        __testTapActors: (all: CombatActor[]) => {
            const c = all.find((a) => a.id === side.cleanserId);
            if (!c) throw new Error('cleanser missing');
            c.corrosionEntries.push(...(seed.corrosion ?? []).map(entry));
            c.infernoEntries.push(...(seed.inferno ?? []).map(entry));
            c.pendingBombs.push(...(seed.bombs ?? []).map(bomb));
            bus.on('round-ended', () => {
                out.corrosion = c.corrosionEntries.map((e) => e.stacks);
                out.inferno = c.infernoEntries.map((e) => e.stacks);
                out.bombs = c.pendingBombs.map((e) => e.stacks);
                out.named = engine ? ownerDebuffNamesFor(engine, side.cleanserId) : [];
            });
        },
    });
    return out;
};

describe('an ally cleanse removes the ally’s DoT stacks', () => {
    type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
    const allAlliesCleanse1: ShipSkills = {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'ally-cleanse',
                        type: 'cleanse',
                        target: 'all-allies',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'cleanse', count: 1 },
                    },
                ],
            },
        ],
    };
    const teammate: TeamActor = {
        id: 'ally-b',
        speed: 10,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M3',
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
                hp: HP,
                security: 0,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    };
    const boards: { tag: string; allyId: string; input: CombatEngineInput }[] = [
        {
            tag: 'player',
            allyId: 'ally-b',
            input: base({
                shipSkills: allAlliesCleanse1,
                teamActors: [teammate],
                enemyAttackers: [opponent('enemy-a', NO_SKILLS, 10)],
            }),
        },
        {
            tag: 'enemy-side',
            allyId: 'enemy-b',
            input: base({
                speed: 10,
                enemyAttackers: [
                    opponent('enemy-cleanser', allAlliesCleanse1, 100),
                    { ...opponent('enemy-b', NO_SKILLS, 10), position: 'M3' },
                ],
            }),
        },
    ];
    for (const { tag, allyId, input } of boards) {
        it(`${tag}: 'cleanses 1 debuff' on all allies → the ally's 2-stack Corrosion keeps 1`, () => {
            const bus = createEventBus();
            let after: number[] = [];
            runCombat({
                ...input,
                bus,
                __testTapActors: (all: CombatActor[]) => {
                    const ally = all.find((a) => a.id === allyId);
                    if (!ally) throw new Error('ally missing');
                    ally.corrosionEntries.push(entry(2));
                    bus.on('round-ended', () => {
                        after = ally.corrosionEntries.map((e) => e.stacks);
                    });
                },
            });
            expect(after).toEqual([1]);
        });
    }
});

for (const side of [PLAYER, ENEMY]) {
    describe(`${side.tag}: a cleanse removes DoT stacks`, () => {
        it("Laika's 'cleanses 1 debuff' on one 2-stack Corrosion → 1 stack left", () => {
            const a = run(side, kit('Laika', ['active']), { corrosion: [2] });
            expect(a.corrosion).toEqual([1]);
        });

        it('negative: a ship with no cleanse keeps both stacks', () => {
            const a = run(side, kit('Snakeroot', ['active']), { corrosion: [2] });
            expect(a.corrosion).toEqual([2]);
        });

        it("Sustainer's 'cleanses 2 debuffs' on Attack Down II + one 1-stack Corrosion → both gone", () => {
            const a = run(side, kit('Sustainer', ['active']), { corrosion: [1], named: true });
            expect(a.named).toEqual([]);
            expect(a.corrosion).toEqual([]);
        });

        it('newest first: cleanse 1 on a seeded Corrosion stack + the later Attack Down II keeps the stack', () => {
            const a = run(side, kit('Laika', ['active']), { corrosion: [1], named: true });
            expect(a.named).toEqual([]);
            expect(a.corrosion).toEqual([1]);
        });

        it('cleanse all removes every stack of every DoT, Bombs included', () => {
            const a = run(side, selfCleanse('all'), {
                corrosion: [2, 1],
                inferno: [3],
                bombs: [2],
                named: true,
            });
            expect(a).toEqual({ corrosion: [], inferno: [], bombs: [], named: [] });
        });

        it('an unremovable DoT stays (Acidic Decay)', () => {
            const a = run(side, selfCleanse('all'), {
                corrosion: [{ stacks: 2, unremovable: true }, 1],
            });
            expect(a.corrosion).toEqual([2]);
        });

        it("Nuqtu's start-of-turn 'cleanses 1 debuff' (the reactive path) → 1 stack left", () => {
            const a = run(side, kit('Nuqtu', ['active', 'passive']), { corrosion: [2] });
            expect(a.corrosion).toEqual([1]);
        });

        it("a typed 'cleanses 2 Bomb' takes only Bomb stacks", () => {
            const a = run(side, selfCleanse(2, 'bomb'), {
                corrosion: [1],
                bombs: [3],
                named: true,
            });
            expect(a).toEqual({
                corrosion: [1],
                inferno: [],
                bombs: [1],
                named: ['Attack Down II'],
            });
        });

        it("a typed 'cleanses 2 damage over time debuffs' leaves the named debuff", () => {
            const a = run(side, selfCleanse(2, 'dot'), {
                corrosion: [1],
                inferno: [1],
                named: true,
            });
            expect(a).toEqual({ corrosion: [], inferno: [], bombs: [], named: ['Attack Down II'] });
        });
    });
}
