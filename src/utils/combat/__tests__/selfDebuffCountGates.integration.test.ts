/**
 * A self debuff-COUNT gate counts the DoTs the unit carries, one per stack (R26), alongside its named
 * debuffs (owner ruling R22, 2026-10-04 — ruling 8 applied to the unit itself): Sustainer
 * carrying only Corrosion has a debuff, so "At the start of the round, if this Unit has no
 * debuffs it gains Out. Damage Up III" does not fire, and neither does its charged "If this Unit
 * has no debuffs, it gains one extra action". Meatshield's charged "repairs 1.5% of its max HP for
 * each debuff on itself" counts each DoT stack. A NAME-keyed self gate (Panon's "If this Unit is
 * affected by Provoke or Taunt") is not a count and ignores DoTs.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv, refit 4). DoTs are seeded on the unit
 * before combat; they outlast the fight.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { evaluateCondition } from '../../abilities/evaluateConditions';
import { buildRoundContext } from '../../abilities/roundContext';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills, SkillSlot } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { ActiveDoTStack, CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** `ship`'s real slots named in `slots`, as parsed. */
const kit = (ship: string, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.filter((s) => slots.includes(s.slot));
    if (found.length !== slots.length) throw new Error(`${ship} lacks one of ${slots.join(',')}`);
    return { slots: found };
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

const dots = (n: number): ActiveDoTStack[] =>
    Array.from({ length: n }, () => ({ stacks: 1, tier: 1, remainingRounds: 9, sourceId: 'seed' }));

const HP = 1e6;

const harmlessEnemy = (id: string): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 10, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
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

interface Cast {
    kit: ShipSkills;
    charged: boolean;
}

interface Side {
    casterId: string;
    input: (c: Cast) => CombatEngineInput;
}

const PLAYER: Side = {
    casterId: 'attacker',
    input: ({ kit: k, charged }) =>
        base({
            shipSkills: k,
            hasChargedSkill: true,
            chargeCount: charged ? 1 : 9,
            startCharged: charged,
            enemyAttackers: [harmlessEnemy('enemy-a')],
        }),
};

const ENEMY: Side = {
    casterId: 'enemy-caster',
    input: ({ kit: k, charged }) =>
        base({
            attack: 0,
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
    /** `buff-applied` names on the caster in round 1. */
    buffs: string[];
    /** The caster's round-1 turns. */
    turns: number;
    /** HP the caster's round-1 repairs restored to itself. */
    selfRepair: number;
    /** Direct damage the caster's round-1 hits dealt. */
    dealt: number;
}

type Seed = { corrosion?: number; inferno?: number; bomb?: boolean };

const measure = (side: Side, cast: Cast, seed: Seed): Measured => {
    const bus = createEventBus();
    const caster = side.casterId;
    const out: Measured = { buffs: [], turns: 0, selfRepair: 0, dealt: 0 };
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === caster && e.round === 1) out.dealt += e.damage ?? 0;
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId === caster && e.round === 1) out.buffs.push(e.buffName);
    });
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        if (e.actorId === caster && e.round === 1) out.turns++;
    });
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
        if (e.casterId === caster && e.round === 1 && e.targets.includes(caster))
            out.selfRepair += e.amount;
    });
    runCombat({
        ...side.input(cast),
        bus,
        __testTapActors: (all: CombatActor[]) => {
            const a = all.find((x) => x.id === caster);
            if (!a) throw new Error('caster missing');
            a.currentHp = HP * 0.5;
            if (seed.corrosion) a.corrosionEntries.push(...dots(seed.corrosion));
            if (seed.inferno) a.infernoEntries.push(...dots(seed.inferno));
            if (seed.bomb)
                a.pendingBombs.push({
                    countdown: 9,
                    damagePerStack: 1,
                    stacks: 1,
                    tier: 1,
                    sourceId: 'seed',
                    affinityMult: 1,
                    detonationDamageModifier: 0,
                    splashModifier: 0,
                });
        },
    });
    return out;
};

beforeEach(() => {
    setupKeyedRng(3);
});

const SUSTAINER_PASSIVE = (): Cast => ({
    kit: kit('Sustainer', ['active', 'passive']),
    charged: false,
});
const SUSTAINER_CHARGED = (): Cast => ({ kit: kit('Sustainer', ['charged']), charged: true });
const ODU = 'Out. Damage Up III';

describe("Sustainer: 'if this Unit has no debuffs' counts its DoTs", () => {
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag} start of round: nothing on it → Out. Damage Up III and Attack Up III`, () => {
            const m = measure(side, SUSTAINER_PASSIVE(), {});
            expect(m.buffs.filter((b) => b === ODU)).toEqual([ODU]);
            expect(m.buffs.filter((b) => b === 'Attack Up III')).toEqual(['Attack Up III']);
        });
        it(`${tag} start of round: carrying only Corrosion → neither`, () => {
            const m = measure(side, SUSTAINER_PASSIVE(), { corrosion: 1 });
            expect(m.buffs.filter((b) => b === ODU)).toEqual([]);
            expect(m.buffs.filter((b) => b === 'Attack Up III')).toEqual([]);
        });
        it(`${tag} start of round: carrying only Inferno → neither`, () => {
            const m = measure(side, SUSTAINER_PASSIVE(), { inferno: 2 });
            expect(m.buffs.filter((b) => b === ODU)).toEqual([]);
        });
        it(`${tag} charged: nothing on it → one extra action`, () => {
            expect(measure(side, SUSTAINER_CHARGED(), {}).turns).toBe(2);
        });
        it(`${tag} charged: carrying only Corrosion → no extra action`, () => {
            expect(measure(side, SUSTAINER_CHARGED(), { corrosion: 1 }).turns).toBe(1);
        });
        it(`${tag} charged: carrying only a Bomb → no extra action`, () => {
            expect(measure(side, SUSTAINER_CHARGED(), { bomb: true }).turns).toBe(1);
        });
    }
});

describe("Meatshield: 'repairs 1.5% for each debuff on itself' counts each DoT stack", () => {
    const cast = (): Cast => ({ kit: kit('Meatshield', ['charged']), charged: true });
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag}: two Corrosion and one Inferno → 4.5% of max HP`, () => {
            const m = measure(side, cast(), { corrosion: 2, inferno: 1 });
            expect(m.selfRepair).toBeCloseTo(HP * 0.045, 0);
        });
        it(`${tag}: nothing on it → no repair`, () => {
            expect(measure(side, cast(), {}).selfRepair).toBe(0);
        });
    }
});

describe("Panon: the name-keyed 'affected by Provoke or Taunt' gate ignores DoTs", () => {
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag}: carrying only Corrosion → Terran Guard II, not III`, () => {
            const m = measure(
                side,
                { kit: kit('Panon', ['active']), charged: false },
                { corrosion: 2 }
            );
            expect(m.buffs).toContain('Terran Guard II');
            expect(m.buffs).not.toContain('Terran Guard III');
        });
    }
});

describe('the self-debuff reading: a count includes DoTs, a name does not', () => {
    const ctx = buildRoundContext({
        selfBuffNames: [],
        landedEnemyDebuffCount: 0,
        corrosionStacks: 0,
        infernoStacks: 0,
        bombStacks: 0,
        effectiveCritRate: 0,
        selfDebuffNames: ['Provoke'],
        selfDebuffCount: 3,
    });
    it('an unnamed count (Sustainer, Meatshield, the Warpstrike implant) reads the full count', () => {
        expect(evaluateCondition({ subject: 'self-debuff', derivable: true }, ctx)).toBe(3);
    });
    it('a named gate (Panon, Thresh) reads names only', () => {
        expect(
            evaluateCondition({ subject: 'self-debuff', derivable: true, buffName: 'Provoke' }, ctx)
        ).toBe(1);
        expect(
            evaluateCondition(
                { subject: 'self-debuff', derivable: true, buffName: 'Corrosion' },
                ctx
            )
        ).toBe(0);
    });
});

describe("the Warpstrike implant: 'while debuffed' counts the DoTs the ship carries", () => {
    /** A plain 100% hitter wearing a legendary Warpstrike (+5% damage while debuffed), the
     *  implant's abilities built by the real equipment registry. */
    const warpstrikeCast = (): Cast => {
        const ship = {
            id: 'warp-ship',
            name: 'Warp Ship',
            rarity: 'legendary',
            faction: 'AURELIAN_SOVEREIGNTY',
            type: 'ATTACKER',
            baseStats: {},
            equipment: {},
            implants: { implant_major: 'warp' },
            refits: [],
        } as unknown as Ship;
        const piece = {
            id: 'warp',
            slot: 'implant_major',
            level: 16,
            stars: 6,
            rarity: 'legendary',
            mainStat: null,
            subStats: [],
            setBonus: 'WARPSTRIKE',
        } as unknown as GearPiece;
        const implant = buildEquipmentAbilities(ship, (id) => (id === 'warp' ? piece : undefined));
        if (implant.length === 0) throw new Error('Warpstrike built no abilities');
        return {
            kit: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'hit',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 100 },
                            },
                        ],
                    },
                    { slot: 'passive', abilities: implant },
                ],
            },
            charged: false,
        };
    };
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag}: carrying only Corrosion → the hit is 5% larger than carrying nothing`, () => {
            const clean = measure(side, warpstrikeCast(), {});
            const dotted = measure(side, warpstrikeCast(), { corrosion: 1 });
            expect(clean.dealt).toBeGreaterThan(0);
            expect(dotted.dealt / clean.dealt).toBeCloseTo(1.05, 3);
        });
    }
});
