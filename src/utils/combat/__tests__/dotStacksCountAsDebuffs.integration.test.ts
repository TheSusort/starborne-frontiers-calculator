/**
 * Every STACK of a damage-over-time effect is a separate debuff and a separate damage-over-time
 * effect (owner ruling R26, 2026-10-04: "stacks of dots display as separate debuffs"). Snakeroot's
 * one "inflicts 2 stacks of Corrosion I" application puts 2 debuffs on B: B then satisfies Bayah's
 * "an enemy that has 2 or more debuffs" on its own, and with Ravager's 1 Inferno added B carries 3
 * damage-over-time effects for Anemone's "If the primary target has 3 or more damage over time
 * effects". Two separate 1-stack applications count 2 as well — the count is the SUM of stacks.
 *
 * Every board here seeds ONE DoT entry holding SEVERAL stacks — the shape Snakeroot's application
 * leaves (pinned below) — so a count by entries and a count by stacks give different answers.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv, refit 4), single-target (Pattern-Base)
 * casts from M4 at the enemy in front. Every landing roll lands (caster hacking dwarfs every
 * security). Each case runs on both sides: a player caster against enemy A, and an enemy caster
 * against the player focus.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { gateFiringAbilities } from '../../abilities/applyAbilities';
import { dotFamilyCounts } from '../../abilities/roundContext';
import type { ConditionContext } from '../../abilities/evaluateConditions';
import { actorDebuffCount } from '../triggers';
import { createStatusEngine } from '../statusEngine';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills, SkillSlot } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack, CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

/** `ship`'s real slots named in `slots`, as parsed. */
const kit = (ship: string, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.filter((s) => slots.includes(s.slot));
    if (found.length !== slots.length) throw new Error(`${ship} lacks one of ${slots.join(',')}`);
    return { slots: found };
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

/** One DoT entry per element, holding that many stacks: `[2]` is ONE application of 2 stacks,
 *  `[1, 1]` two applications of 1. */
const entries = (stacks: number[]): ActiveDoTStack[] =>
    stacks.map((s) => ({ stacks: s, tier: 1, remainingRounds: 9, sourceId: 'seed' }));

interface Seed {
    corrosion?: number[];
    inferno?: number[];
}

const HP = 1e6;

const harmlessEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 10, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: NO_SKILLS,
});

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

interface Cast {
    kit: ShipSkills;
    charged: boolean;
}

interface Side {
    tag: string;
    casterId: string;
    /** The enemy the caster's cast strikes. */
    victimId: string;
    input: (c: Cast) => CombatEngineInput;
}

const PLAYER: Side = {
    tag: 'player',
    casterId: 'attacker',
    victimId: 'enemy-a',
    input: ({ kit: k, charged }) =>
        base({
            shipSkills: k,
            hasChargedSkill: true,
            chargeCount: charged ? 1 : 9,
            startCharged: charged,
            enemyAttackers: [harmlessEnemy('enemy-a', 'M4')],
        }),
};

const ENEMY: Side = {
    tag: 'enemy-side',
    casterId: 'enemy-caster',
    victimId: 'attacker',
    input: ({ kit: k, charged }) =>
        base({
            attack: 0,
            hacking: 0,
            speed: 150,
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
                        hacking: 1e6,
                    },
                    chargeCount: charged ? 1 : 9,
                    startCharged: charged,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: k,
                },
            ],
        }),
};

interface Measured {
    /** `buffName → target ids` of the caster's round-1 `debuff-applied`. */
    debuffs: Record<string, string[]>;
    /** `buff-applied` names on the caster in round 1. */
    buffs: string[];
    /** HP the caster's round-1 repairs restored to itself. */
    selfRepair: number;
    /** Direct damage the caster's round-1 hits dealt. */
    dealt: number;
}

/** Runs one round with `seeds` (keyed `caster` / `victim`) on the board before anyone acts. */
const measure = (
    side: Side,
    cast: Cast,
    seeds: { caster?: Seed; victim?: Seed },
    extra: Partial<CombatEngineInput> = {}
): Measured => {
    const bus = createEventBus();
    const caster = side.casterId;
    const out: Measured = { debuffs: {}, buffs: [], selfRepair: 0, dealt: 0 };
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === caster && e.round === 1)
            (out.debuffs[e.buffName] ??= []).push(e.targetId);
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId === caster && e.round === 1) out.buffs.push(e.buffName);
    });
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
        if (e.casterId === caster && e.round === 1 && e.targets.includes(caster))
            out.selfRepair += e.amount;
    });
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === caster && e.round === 1) out.dealt += e.damage ?? 0;
    });
    const seedFor = new Map<string, Seed>();
    if (seeds.caster) seedFor.set(caster, seeds.caster);
    if (seeds.victim) seedFor.set(side.victimId, seeds.victim);
    runCombat({
        ...side.input(cast),
        ...extra,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            for (const a of all) {
                if (a.id === caster) a.currentHp = a.stats.hp * 0.5;
                const s = seedFor.get(a.id);
                if (!s) continue;
                if (s.corrosion) a.corrosionEntries.push(...entries(s.corrosion));
                if (s.inferno) a.infernoEntries.push(...entries(s.inferno));
            }
        },
    });
    return out;
};

beforeEach(() => {
    setupKeyedRng(3);
});

describe("the seed shape: Snakeroot's '2 stacks of Corrosion I' is ONE entry of 2 stacks", () => {
    for (const side of [PLAYER, ENEMY]) {
        it(`${side.tag}: one active cast leaves exactly [2] on the struck enemy`, () => {
            let victimCorrosion: number[] = [];
            const bus = createEventBus();
            runCombat({
                ...side.input({ kit: kit('Snakeroot', ['active']), charged: false }),
                bus,
                __testTapActors: (all: CombatActor[]) => {
                    const v = all.find((a) => a.id === side.victimId);
                    if (!v) throw new Error('victim missing');
                    // Read after the fight: the 2-turn Corrosion outlives a 1-round run.
                    bus.on('round-ended', () => {
                        victimCorrosion = v.corrosionEntries.map((e) => e.stacks);
                    });
                },
            });
            expect(victimCorrosion).toEqual([2]);
        });
    }
});

describe("Bayah: 'an enemy that has 2 or more debuffs' counts each DoT stack", () => {
    const bayah = (): Cast => ({ kit: kit('Bayah', ['active', 'passive']), charged: false });
    for (const side of [PLAYER, ENEMY]) {
        it(`${side.tag}: one 2-stack Corrosion (Snakeroot's application) → Speed Down II lands`, () => {
            const m = measure(side, bayah(), { victim: { corrosion: [2] } });
            expect(m.debuffs['Speed Down II']).toEqual([side.victimId]);
            expect(m.buffs).toContain('Terran Bolster II');
        });
        it(`${side.tag}: one 1-stack Corrosion → no Speed Down II`, () => {
            const m = measure(side, bayah(), { victim: { corrosion: [1] } });
            // The instrument can see her landings: the active's own debuff lands.
            expect(m.debuffs['Attack Down II']).toEqual([side.victimId]);
            expect(m.debuffs['Speed Down II']).toBeUndefined();
            expect(m.buffs).not.toContain('Terran Bolster II');
        });
        it(`${side.tag}: two separate 1-stack Corrosions still count 2 → Speed Down II lands`, () => {
            const m = measure(side, bayah(), { victim: { corrosion: [1, 1] } });
            expect(m.debuffs['Speed Down II']).toEqual([side.victimId]);
        });
    }
});

describe("Anemone: '3 or more damage over time effects' counts each DoT stack", () => {
    const anemone = (): Cast => ({ kit: kit('Anemone', ['charged']), charged: true });
    for (const side of [PLAYER, ENEMY]) {
        it(`${side.tag}: 2-stack Corrosion + 1 Inferno → Taunt`, () => {
            const m = measure(side, anemone(), { victim: { corrosion: [2], inferno: [1] } });
            expect(m.buffs).toContain('Taunt');
        });
        it(`${side.tag}: 1-stack Corrosion + 1 Inferno → no Taunt`, () => {
            const m = measure(side, anemone(), { victim: { corrosion: [1], inferno: [1] } });
            // The instrument can see her cast: the charged Corrosion III lands as a DoT, not a
            // named debuff, so the dealt hit is the visible landing here.
            expect(m.dealt).toBeGreaterThan(0);
            expect(m.buffs).not.toContain('Taunt');
        });
    }
});

describe("Lev: 'an additional 15% for each debuff on the enemy' counts each DoT stack", () => {
    const lev = (): Cast => ({ kit: kit('Lev', ['active']), charged: false });
    for (const side of [PLAYER, ENEMY]) {
        it(`${side.tag}: one 2-stack Corrosion scales the hit by 2 debuffs (210% over 180%)`, () => {
            const clean = measure(side, lev(), {});
            const one = measure(side, lev(), { victim: { corrosion: [1] } });
            const two = measure(side, lev(), { victim: { corrosion: [2] } });
            expect(clean.dealt).toBeGreaterThan(0);
            expect(one.dealt / clean.dealt).toBeCloseTo(195 / 180, 4);
            expect(two.dealt / clean.dealt).toBeCloseTo(210 / 180, 4);
        });
    }
});

describe("Crocus: 'If an enemy has 3 or more debuffs' counts each DoT stack", () => {
    const crocus = (): Cast => ({ kit: kit('Crocus', ['active']), charged: false });
    for (const side of [PLAYER, ENEMY]) {
        it(`${side.tag}: one 3-stack Corrosion → Stasis`, () => {
            const m = measure(side, crocus(), { victim: { corrosion: [3] } });
            expect(m.debuffs['Stasis']).toEqual([side.victimId]);
        });
        it(`${side.tag}: one 1-stack Corrosion → no Stasis`, () => {
            const m = measure(side, crocus(), { victim: { corrosion: [1] } });
            expect(m.dealt).toBeGreaterThan(0);
            expect(m.debuffs['Stasis']).toBeUndefined();
        });
    }
});

describe("Sustainer: 'if this Unit has no debuffs' — any DoT stack is a debuff", () => {
    const passive = (): Cast => ({ kit: kit('Sustainer', ['active', 'passive']), charged: false });
    const ODU = 'Out. Damage Up III';
    for (const side of [PLAYER, ENEMY]) {
        it(`${side.tag}: nothing on it → Out. Damage Up III`, () => {
            expect(measure(side, passive(), {}).buffs).toContain(ODU);
        });
        it(`${side.tag}: one 1-stack Corrosion → no Out. Damage Up III`, () => {
            expect(measure(side, passive(), { caster: { corrosion: [1] } }).buffs).not.toContain(
                ODU
            );
        });
        it(`${side.tag}: one 2-stack Corrosion → no Out. Damage Up III`, () => {
            expect(measure(side, passive(), { caster: { corrosion: [2] } }).buffs).not.toContain(
                ODU
            );
        });
    }
});

describe("Meatshield: 'repairs 1.5% for each debuff on itself' counts each DoT stack", () => {
    const meatshield = (): Cast => ({ kit: kit('Meatshield', ['charged']), charged: true });
    for (const side of [PLAYER, ENEMY]) {
        it(`${side.tag}: one 2-stack Corrosion → 3% of max HP`, () => {
            const m = measure(side, meatshield(), { caster: { corrosion: [2] } });
            expect(m.selfRepair).toBeCloseTo(HP * 0.03, 0);
        });
        it(`${side.tag}: one 1-stack Corrosion → 1.5% of max HP`, () => {
            const m = measure(side, meatshield(), { caster: { corrosion: [1] } });
            expect(m.selfRepair).toBeCloseTo(HP * 0.015, 0);
        });
        it(`${side.tag}: a 2-stack Corrosion and a 1-stack Inferno → 4.5% of max HP`, () => {
            const m = measure(side, meatshield(), { caster: { corrosion: [2], inferno: [1] } });
            expect(m.selfRepair).toBeCloseTo(HP * 0.045, 0);
        });
    }
});

describe("APEX: Block Shield's '3 or more debuffs' counts each DoT stack", () => {
    const APEX_HP = 100_000;
    let idc = 0;
    /** One hit, then Attack Down II — a named debuff landing that wakes APEX's passive. */
    const namedInflictor = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: `ap-${++idc}`,
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                    {
                        id: `ap-${++idc}`,
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
                            duration: 2,
                            application: 'inflict',
                        },
                    },
                ],
            },
        ],
    });
    const apexPassiveOnly = (): ShipSkills => {
        const passive = kit('APEX', ['passive']).slots[0];
        return { slots: [{ slot: 'active', abilities: [] }, passive] };
    };
    const apexShip = (id: string, position: Position): TeamActor => ({
        id,
        speed: 50,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        walk: {
            shipSkills: apexPassiveOnly(),
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 1e6,
                defence: 0,
                hp: APEX_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });
    const enemyStats = (attack: number, hp: number, speed: number) => ({
        attack,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp,
        speed,
        security: 0,
        hacking: 1e6,
    });

    /** The fast focus lands Attack Down II on enemy X; APEX is a slow player ship that never casts. */
    const playerBoard = (): CombatEngineInput =>
        base({
            speed: 200,
            shipSkills: namedInflictor(),
            teamActors: [apexShip('apex', 'M3')],
            enemyAttackers: [harmlessEnemy('enemy-x', 'M4')],
        });
    /** A fast enemy lands Attack Down II on the player focus; a slow enemy APEX never casts. */
    const enemyBoard = (): CombatEngineInput =>
        base({
            attack: 0,
            hacking: 0,
            enemyAttackers: [
                {
                    ...harmlessEnemy('e-inflictor', 'M4'),
                    stats: enemyStats(1000, 1e9, 200),
                    shipSkills: namedInflictor(),
                },
                {
                    ...harmlessEnemy('e-apex', 'M3'),
                    stats: enemyStats(0, APEX_HP, 50),
                    shipSkills: apexPassiveOnly(),
                },
            ],
        });

    const blockShieldOn = (
        input: CombatEngineInput,
        apexId: string,
        xId: string,
        corrosion: number[]
    ): string[] => {
        const bus = createEventBus();
        const out: string[] = [];
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            if (e.sourceId === apexId && e.buffName === 'Block Shield' && e.round === 1)
                out.push(e.targetId);
        });
        runCombat({
            ...input,
            bus,
            __testTapActors: (all) => {
                const x = all.find((a) => a.id === xId);
                if (!x) throw new Error('X missing');
                x.corrosionEntries.push(...entries(corrosion));
            },
        });
        return out;
    };

    beforeEach(() => {
        idc = 0;
    });

    it('player: X carries one 2-stack Corrosion, the ally lands Attack Down II → 3 → Block Shield', () => {
        expect(blockShieldOn(playerBoard(), 'apex', 'enemy-x', [2])).toEqual(['enemy-x']);
    });
    it('player: X carries one 1-stack Corrosion → 2 → no Block Shield', () => {
        expect(blockShieldOn(playerBoard(), 'apex', 'enemy-x', [1])).toEqual([]);
    });
    it('enemy-side: the focus carries one 2-stack Corrosion → Block Shield on it', () => {
        expect(blockShieldOn(enemyBoard(), 'e-apex', 'attacker', [2])).toEqual(['attacker']);
    });
    it('enemy-side: the focus carries one 1-stack Corrosion → no Block Shield', () => {
        expect(blockShieldOn(enemyBoard(), 'e-apex', 'attacker', [1])).toEqual([]);
    });
});

describe('the count primitives sum stacks', () => {
    it('actorDebuffCount: one 2-stack Corrosion, one 1-stack Inferno and a 3-stack Bomb → 6', () => {
        const actor = {
            id: 'x',
            corrosionEntries: entries([2]),
            infernoEntries: entries([1]),
            genericDoTEntries: [],
            pendingBombs: [
                {
                    countdown: 4,
                    damagePerStack: 1,
                    stacks: 3,
                    tier: 1,
                    sourceId: 'lingshe',
                    affinityMult: 1,
                    detonationDamageModifier: 0,
                    splashModifier: 0,
                },
            ],
        } as unknown as CombatActor;
        const engine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        expect(actorDebuffCount(engine, actor)).toBe(6);
    });

    it("dotFamilyCounts: Belladonna's Acidic Decay family counts each stack", () => {
        const corrosion = entries([2, 1]).map((e) => ({ ...e, family: 'Acidic Decay' }));
        expect(dotFamilyCounts(corrosion, [], [])).toEqual({ 'Acidic Decay': 3 });
    });

    it("gateFiringAbilities: a same-cast '2 stacks of Corrosion' clause raises a later gate's count by 2", () => {
        const dot: Ability = {
            id: 'dot',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'dot', dotType: 'corrosion', tier: 1, stacks: 2, duration: 2 },
        };
        const gated: Ability = {
            id: 'gated',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [
                {
                    subject: 'enemy-debuff',
                    derivable: true,
                    countComparator: 'gte',
                    countThreshold: 2,
                },
            ],
            config: {
                type: 'debuff',
                buffName: 'Stasis',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 1,
                application: 'inflict',
            },
        };
        // A clean enemy: the only debuffs the gate can see are the cast's own earlier clause's.
        const ctx: ConditionContext = {
            selfBuffNames: [],
            selfDebuffNames: [],
            enemyBuffNames: [],
            effectiveCritRate: 0,
            selfHpPct: 100,
            enemyDebuffCount: 0,
        };
        const { gatedSkill } = gateFiringAbilities(
            { slot: 'active', abilities: [dot, gated] },
            ctx
        );
        expect(gatedSkill?.abilities.map((a) => a.id)).toEqual(['dot', 'gated']);
    });
});
