/**
 * A self gain gated on "the target" / "the primary target" on a pattern skill fires ONCE per cast
 * if ANY enemy the cast strikes qualifies (owner ruling R17, 2026-10-04): Malvex hits A (no
 * shield), B and C (shielded) → one 15% shield. Never more than one gain per cast. A single-target
 * (Pattern-Base) cast strikes its target alone and is unchanged.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv, refit 4), each firing its real pattern
 * from M4: Line-Range-2 strikes M4 (A), M3 (B) and M2 (C); Scattershot-Range-1 strikes M4 (A), M2
 * (B) and T2 (C). The enemies are faster than the caster and harmless; whatever they do to
 * themselves (repair, buff) happens before the cast.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
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
type Slot = 'active' | 'charged';

/** `ship`'s real `slot`, without its passive, so only the gated clause can move the measure. An
 *  active cast also carries the real charged slot (it never fills in one round): a ship with no
 *  charged skill accrues no charges. */
const kit = (ship: string, slot: Slot): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const slots = buildShipAbilities(built).slots;
    const found = slots.find((s) => s.slot === slot);
    const charged = slots.find((s) => s.slot === 'charged');
    if (!found || !charged) throw new Error(`${ship} lacks a ${slot} or charged slot`);
    return { slots: slot === 'active' ? [found, charged] : [found] };
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

let idc = 0;
const selfRepair = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `sg-${++idc}`,
                    type: 'heal',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                },
            ],
        },
    ],
});
const selfBuffs = (n: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: Array.from({ length: n }, (_, i) => ({
                id: `sg-${++idc}`,
                type: 'buff' as const,
                target: 'self' as const,
                trigger: 'on-cast' as const,
                conditions: [],
                config: {
                    type: 'buff' as const,
                    buffName: `Seed Buff ${i + 1}`,
                    parsedEffects: {},
                    stacks: 1,
                    isStackable: false,
                    duration: 3,
                },
            })),
        },
    ],
});

const corrosion = (n: number): ActiveDoTStack[] =>
    Array.from({ length: n }, () => ({ stacks: 1, tier: 1, remainingRounds: 9, sourceId: 'seed' }));

/** What each struck slot carries before the cast. */
interface Seed {
    shield?: boolean;
    dots?: number;
    /** Wounded, and repairs itself on its own (earlier) turn. */
    repaired?: boolean;
    buffs?: number;
}
type Label = 'A' | 'B' | 'C';
type Board = Partial<Record<Label, Seed>>;

const LINE: Record<Label, Position> = { A: 'M4', B: 'M3', C: 'M2' };
const SCATTER: Record<Label, Position> = { A: 'M4', B: 'M2', C: 'T2' };

const skillsFor = (s: Seed | undefined): ShipSkills =>
    s?.repaired ? selfRepair() : s?.buffs ? selfBuffs(s.buffs) : NO_SKILLS;

const enemyAt = (id: string, position: Position, skills: ShipSkills): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: skills,
});
const playerShip = (id: string, position: Position, skills: ShipSkills): TeamActor => ({
    id,
    speed: 150,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: skills,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1e9,
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
    hp: 1e9,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

interface Measured {
    /** Self shield grants the caster gave itself in round 1. */
    shields: number;
    /** `buff-applied` names on the caster in round 1. */
    buffs: string[];
    /** Self `control-applied` effects in round 1. */
    selfControls: string[];
    /** Skill-granted charge moves (`manip`) on the caster in round 1, as the amount gained. */
    chargeGains: number[];
    /** The caster's round-1 turns. */
    turns: number;
    struck: string[];
}

interface Side {
    casterId: string;
    ids: Record<Label, string>;
    input: (
        ship: string,
        slot: Slot,
        pattern: string,
        pos: Record<Label, Position>,
        b: Board
    ) => CombatEngineInput;
}

const PLAYER: Side = {
    casterId: 'attacker',
    ids: { A: 'enemy-a', B: 'enemy-b', C: 'enemy-c' },
    input: (ship, slot, pattern, pos, b) =>
        base({
            shipSkills: kit(ship, slot),
            pattern: parsePattern(pattern),
            ...(slot === 'charged'
                ? { chargeCount: 1, hasChargedSkill: true, startCharged: true }
                : { chargeCount: 9, hasChargedSkill: true }),
            enemyAttackers: (['A', 'B', 'C'] as Label[]).map((l) =>
                enemyAt(PLAYER.ids[l], pos[l], skillsFor(b[l]))
            ),
        }),
};

const ENEMY: Side = {
    casterId: 'enemy-caster',
    ids: { A: 'attacker', B: 'ally-b', C: 'ally-c' },
    input: (ship, slot, pattern, pos, b) =>
        base({
            attack: 0,
            speed: 150,
            shipSkills: skillsFor(b.A),
            position: pos.A,
            teamActors: [
                playerShip('ally-b', pos.B, skillsFor(b.B)),
                playerShip('ally-c', pos.C, skillsFor(b.C)),
            ],
            enemyAttackers: [
                {
                    id: 'enemy-caster',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1e9,
                        speed: 10,
                        security: 0,
                    },
                    chargeCount: slot === 'charged' ? 1 : 9,
                    startCharged: slot === 'charged',
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern(pattern),
                    shipSkills: kit(ship, slot),
                },
            ],
        }),
};

const measure = (
    side: Side,
    ship: string,
    slot: Slot,
    pattern: string,
    pos: Record<Label, Position>,
    b: Board
): Measured => {
    const bus = createEventBus();
    const caster = side.casterId;
    const out: Measured = {
        shields: 0,
        buffs: [],
        selfControls: [],
        chargeGains: [],
        turns: 0,
        struck: [],
    };
    const struck = new Set<string>();
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        if (e.granterId === caster && e.round === 1 && e.recipientIds.includes(caster))
            out.shields++;
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId === caster && e.round === 1) out.buffs.push(e.buffName);
    });
    bus.on('control-applied', (e: Extract<CombatEvent, { type: 'control-applied' }>) => {
        if (e.casterId === caster && e.targetId === caster && e.round === 1)
            out.selfControls.push(e.effect);
    });
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId === caster && e.round === 1 && e.reason === 'manip')
            out.chargeGains.push(e.newCharge - e.oldCharge);
    });
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        if (e.actorId === caster && e.round === 1) out.turns++;
    });
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === caster && e.round === 1) struck.add(e.targetId);
    });
    const byId = new Map<string, Seed>();
    for (const l of ['A', 'B', 'C'] as Label[]) if (b[l]) byId.set(side.ids[l], b[l]);
    runCombat({
        ...side.input(ship, slot, pattern, pos, b),
        bus,
        __testTapActors: (all: CombatActor[]) => {
            for (const a of all) {
                const s = byId.get(a.id);
                if (!s) continue;
                if (s.shield) a.shieldPool = 1e8;
                if (s.dots) a.corrosionEntries.push(...corrosion(s.dots));
                if (s.repaired) a.currentHp = a.stats.hp * 0.5;
            }
        },
    });
    out.struck = [...struck].sort();
    return out;
};

beforeEach(() => {
    idc = 0;
    setupKeyedRng(13);
});

const L2 = 'Pattern-Line-Range-2';
const BASE = 'Pattern-Base';

describe("Malvex: 'If the target has a shield' gains once if any struck enemy is shielded", () => {
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag} active: A bare, B and C shielded → one 15% shield`, () => {
            const m = measure(side, 'Malvex', 'active', L2, LINE, {
                B: { shield: true },
                C: { shield: true },
            });
            expect(m.struck).toEqual(Object.values(side.ids).sort());
            expect(m.shields).toBe(1);
        });
        it(`${tag} active: A shielded, B and C bare → one (the aimed enemy still counts)`, () => {
            expect(
                measure(side, 'Malvex', 'active', L2, LINE, { A: { shield: true } }).shields
            ).toBe(1);
        });
        it(`${tag} active: all three shielded → still ONE shield`, () => {
            const all = { A: { shield: true }, B: { shield: true }, C: { shield: true } };
            expect(measure(side, 'Malvex', 'active', L2, LINE, all).shields).toBe(1);
        });
        it(`${tag} active: nobody shielded → none`, () => {
            expect(measure(side, 'Malvex', 'active', L2, LINE, {}).shields).toBe(0);
        });
        it(`${tag} charged: B shielded alone → one Barrier`, () => {
            const m = measure(side, 'Malvex', 'charged', L2, LINE, { B: { shield: true } });
            expect(m.buffs.filter((n) => n === 'Barrier')).toEqual(['Barrier']);
        });
    }
    it('player, Pattern-Base: B shielded is not struck → none', () => {
        const m = measure(PLAYER, 'Malvex', 'active', BASE, LINE, { B: { shield: true } });
        expect(m.struck).toEqual(['enemy-a']);
        expect(m.shields).toBe(0);
    });
});

describe("Zosimos: 'If the target was repaired this round' adds one charge if any struck enemy was", () => {
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag}: B repaired alone → +1 charge`, () => {
            expect(
                measure(side, 'Zosimos', 'active', L2, LINE, { B: { repaired: true } }).chargeGains
            ).toEqual([1]);
        });
        it(`${tag}: A, B and C repaired → still +1`, () => {
            const all = { A: { repaired: true }, B: { repaired: true }, C: { repaired: true } };
            expect(measure(side, 'Zosimos', 'active', L2, LINE, all).chargeGains).toEqual([1]);
        });
        it(`${tag}: nobody repaired → nothing`, () => {
            expect(measure(side, 'Zosimos', 'active', L2, LINE, {}).chargeGains).toEqual([]);
        });
    }
});

describe("Anemone: 'If the primary target has 3 or more DoTs' gains Taunt once if any struck enemy has", () => {
    const SC = 'Pattern-Scattershot-Range-1';
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag}: B at 3 DoTs alone → Taunt and its control event, once`, () => {
            const m = measure(side, 'Anemone', 'charged', SC, SCATTER, { B: { dots: 3 } });
            expect(m.struck).toEqual(Object.values(side.ids).sort());
            expect(m.buffs.filter((n) => n === 'Taunt')).toEqual(['Taunt']);
            expect(m.selfControls).toEqual(['taunt']);
        });
        // At 1 each, her own Corrosion III (written first, R29) brings a struck enemy to 2 at most.
        it(`${tag}: everyone at 1 → none`, () => {
            const m = measure(side, 'Anemone', 'charged', SC, SCATTER, {
                A: { dots: 1 },
                B: { dots: 1 },
                C: { dots: 1 },
            });
            expect(m.buffs.filter((n) => n === 'Taunt')).toEqual([]);
            expect(m.selfControls).toEqual([]);
        });
    }
});

describe("Nuqtu: 'If the target has 3 or more buffs' fires once if any struck enemy has", () => {
    for (const side of [PLAYER, ENEMY]) {
        const tag = side === PLAYER ? 'player' : 'enemy-side';
        it(`${tag} active: A 1 buff, B 4 → +2 charges, once`, () => {
            expect(
                measure(side, 'Nuqtu', 'active', L2, LINE, { A: { buffs: 1 }, B: { buffs: 4 } })
                    .chargeGains
            ).toEqual([2]);
        });
        it(`${tag} active: B 4 and C 4 → still +2 once`, () => {
            expect(
                measure(side, 'Nuqtu', 'active', L2, LINE, { B: { buffs: 4 }, C: { buffs: 4 } })
                    .chargeGains
            ).toEqual([2]);
        });
        it(`${tag} active: everyone at 2 → nothing`, () => {
            const two = { A: { buffs: 2 }, B: { buffs: 2 }, C: { buffs: 2 } };
            expect(measure(side, 'Nuqtu', 'active', L2, LINE, two).chargeGains).toEqual([]);
        });
        it(`${tag} charged: B 4 → one extra end-of-round turn`, () => {
            expect(measure(side, 'Nuqtu', 'charged', L2, LINE, { B: { buffs: 4 } }).turns).toBe(2);
        });
    }
});

describe("Chakara: 'If ALL damaged enemies have more speed' is not an any-struck gate", () => {
    it('player on Line-Range-1: the aimed enemy slower, the covered one faster → no charge', () => {
        // The enemies here are faster than Chakara (150 vs 100) unless slowed; slow A only.
        const bus = createEventBus();
        const gains: number[] = [];
        bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
            if (e.actorId === 'attacker' && e.round === 1 && e.reason === 'manip')
                gains.push(e.newCharge - e.oldCharge);
        });
        runCombat({
            ...base({
                shipSkills: kit('Chakara', 'active'),
                pattern: parsePattern('Pattern-Line-Range-1'),
                chargeCount: 9,
                hasChargedSkill: true,
                enemyAttackers: [
                    {
                        ...enemyAt('enemy-a', 'M4', NO_SKILLS),
                        stats: { ...enemyAt('x', 'M4', NO_SKILLS).stats, speed: 50 },
                    },
                    enemyAt('enemy-b', 'M3', NO_SKILLS),
                ],
            }),
            bus,
        });
        expect(gains).toEqual([]);
    });
});
