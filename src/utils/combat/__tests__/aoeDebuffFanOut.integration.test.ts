/**
 * An on-cast enemy clause on a pattern skill reaches EVERY enemy the skill strikes (owner rulings
 * 2026-10-03: "All skills with an aoe pattern have all their effects on any enemy within the
 * pattern"; "the primary target" narrows nothing either). Covers timed debuffs, the named control
 * statuses (Stasis / Disable), shield removal and buff steal.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv). The caster fires
 * Pattern-Circle-Range-1 anchored on M4, which strikes M4 (A), M3 (B) and T4 (C); M2 (OUT) stands
 * outside it. `Pattern-Base` on the same board strikes A alone. Caster hacking dwarfs every
 * security, so every landing roll lands.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack, CombatActor } from '../state';
import type { StatusEngine } from '../statusEngine';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type Slot = 'active' | 'charged' | 'passive';

const circle = (): ParsedPattern => parsePattern('Pattern-Circle-Range-1');
const single = (): ParsedPattern => parsePattern('Pattern-Base');

const realSlot = (ship: string, slot: Slot): Ability[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};

/** The ship's real `slot` abilities, placed so they fire on its round-1 turn. A charged slot is
 *  fired by `startCharged` (the caller sets it). */
const kit = (ship: string, slot: Slot): ShipSkills => ({
    slots: [{ slot, abilities: realSlot(ship, slot) }],
});

let idc = 0;
const selfBuff = (name: string): Ability => ({
    id: `fb-${++idc}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: name,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 3,
    },
});
const buffKit = (names: string[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities: names.map(selfBuff) }],
});
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

const ENEMY_POSITIONS: [string, Position][] = [
    ['enemy-a', 'M4'],
    ['enemy-b', 'M3'],
    ['enemy-c', 'T4'],
    ['enemy-out', 'M2'],
];
const ENEMY_IDS = ENEMY_POSITIONS.map(([id]) => id);

/** A durable, harmless enemy, faster than the caster. */
const enemyAt = (
    id: string,
    position: Position,
    skills: ShipSkills = NO_SKILLS
): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: single(),
    shipSkills: skills,
});
const enemyRow = (skillsFor: (id: string) => ShipSkills = () => NO_SKILLS): EnemyAttacker[] =>
    ENEMY_POSITIONS.map(([id, p]) => enemyAt(id, p, skillsFor(id)));

/** A durable, harmless player-side ship, faster than the enemy caster. */
const playerShip = (id: string, position: Position, skills: ShipSkills = NO_SKILLS): TeamActor => ({
    id,
    speed: 150,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: single(),
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
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1,
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
    hp: 1e9,
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: circle(),
    speed: 100,
    ...over,
});

/** The player caster firing `ship`'s real `slot` on round 1. */
const playerCaster = (
    ship: string,
    slot: Slot,
    pattern: ParsedPattern
): Partial<CombatEngineInput> => ({
    shipSkills: kit(ship, slot),
    pattern,
    ...(slot === 'charged' ? { hasChargedSkill: true, startCharged: true } : {}),
});

/** The enemy caster firing `ship`'s real `slot` on round 1, slower than every player ship. */
const enemyCaster = (ship: string, slot: Slot, pattern: ParsedPattern): EnemyAttacker => ({
    id: 'enemy-caster',
    stats: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1e9,
        speed: 10,
        security: 0,
        hacking: 1e6,
    },
    chargeCount: slot === 'charged' ? 1 : 0,
    startCharged: slot === 'charged',
    position: 'M4',
    target: parseTarget('front'),
    pattern,
    shipSkills: kit(ship, slot),
});

/** The player-side board an enemy caster on Circle faces: the focus at M4 (struck), B at M3 and
 *  C at T4 (struck), OUT at M2 (not struck). The focus itself casts nothing. */
const playerBoard = (
    enemy: EnemyAttacker,
    skillsFor: (id: string) => ShipSkills = () => NO_SKILLS
): CombatEngineInput =>
    base({
        attack: 0,
        hacking: 0,
        speed: 150,
        pattern: single(),
        shipSkills: skillsFor('attacker'),
        teamActors: [
            playerShip('ally-b', 'M3', skillsFor('ally-b')),
            playerShip('ally-c', 'T4', skillsFor('ally-c')),
            playerShip('ally-out', 'M2', skillsFor('ally-out')),
        ],
        enemyAttackers: [enemy],
    });
const PLAYER_IDS = ['attacker', 'ally-b', 'ally-c', 'ally-out'];

interface Measured {
    /** `buffName → sorted target ids` of the caster's round-1 `debuff-applied`. */
    debuffs: Record<string, string[]>;
    /** Sorted target ids of the caster's round-1 `control-applied`. */
    control: string[];
    /** Sorted target ids of the caster's round-1 `shield-stripped`. */
    stripped: string[];
    /** The caster's round-1 `steal-performed`, by source. */
    steals: Record<string, string[]>;
    actors: Map<string, CombatActor>;
    engine: StatusEngine;
}

const measure = (
    input: CombatEngineInput,
    casterId: string,
    seed: (a: CombatActor) => void = () => {}
): Measured => {
    const bus = createEventBus();
    const debuffs: Record<string, string[]> = {};
    const control: string[] = [];
    const stripped: string[] = [];
    const steals: Record<string, string[]> = {};
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId !== casterId || e.round !== 1) return;
        (debuffs[e.buffName] ??= []).push(e.targetId);
    });
    bus.on('control-applied', (e: Extract<CombatEvent, { type: 'control-applied' }>) => {
        if (e.casterId === casterId && e.round === 1 && e.targetId) control.push(e.targetId);
    });
    bus.on('shield-stripped', (e: Extract<CombatEvent, { type: 'shield-stripped' }>) => {
        if (e.casterId === casterId && e.round === 1) stripped.push(e.targetId);
    });
    bus.on('steal-performed', (e: Extract<CombatEvent, { type: 'steal-performed' }>) => {
        if (e.casterId === casterId && e.round === 1)
            (steals[e.targetId] ??= []).push(...e.buffNames);
    });
    const actors = new Map<string, CombatActor>();
    let engine: StatusEngine | undefined;
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
        __testTapActors: (all) => {
            for (const a of all) {
                actors.set(a.id, a);
                seed(a);
            }
        },
    });
    for (const k of Object.keys(debuffs)) debuffs[k].sort();
    control.sort();
    stripped.sort();
    return { debuffs, control, stripped, steals, actors, engine: engine! };
};

beforeEach(() => {
    idc = 0;
    setupKeyedRng(5);
});

describe("Arum's Attack Down reaches every enemy his pattern strikes", () => {
    it('player Arum on Circle → Attack Down II on A, B and C; not on the enemy outside', () => {
        const { debuffs } = measure(
            base({ ...playerCaster('Arum', 'active', circle()), enemyAttackers: enemyRow() }),
            'attacker'
        );
        expect(debuffs['Attack Down II']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
    });

    it('player Arum on a single-target pattern → A alone', () => {
        const { debuffs } = measure(
            base({ ...playerCaster('Arum', 'active', single()), enemyAttackers: enemyRow() }),
            'attacker'
        );
        expect(debuffs['Attack Down II']).toEqual(['enemy-a']);
    });

    it('enemy-side Arum on Circle → Attack Down II on the three player ships he strikes', () => {
        const { debuffs } = measure(
            playerBoard(enemyCaster('Arum', 'active', circle())),
            'enemy-caster'
        );
        expect(debuffs['Attack Down II']).toEqual(['ally-b', 'ally-c', 'attacker']);
    });

    it("player Arum's charged reaches all three with both debuffs, and each holds them after the cast", () => {
        const { debuffs, engine } = measure(
            base({ ...playerCaster('Arum', 'charged', circle()), enemyAttackers: enemyRow() }),
            'attacker'
        );
        expect(debuffs['Attack Down III']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(debuffs['Crit Rate Down III']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        const held = (id: string) =>
            engine
                .timedAbilityStatuses('enemy', 'attacker', id)
                .map((s) => s.payload.buffName)
                .sort();
        expect(held('enemy-b')).toEqual(['Attack Down III', 'Crit Rate Down III']);
        expect(held('enemy-out')).toEqual([]);
    });
});

describe("Iridium's charged Stasis reaches every enemy his pattern strikes", () => {
    it('player Iridium on Circle → Stasis and its control event on A, B and C', () => {
        const { debuffs, control } = measure(
            base({ ...playerCaster('Iridium', 'charged', circle()), enemyAttackers: enemyRow() }),
            'attacker'
        );
        expect(debuffs['Stasis']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(control).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
    });

    it('enemy-side Iridium on Circle → Stasis on the three player ships he strikes', () => {
        const { debuffs, control } = measure(
            playerBoard(enemyCaster('Iridium', 'charged', circle())),
            'enemy-caster'
        );
        expect(debuffs['Stasis']).toEqual(['ally-b', 'ally-c', 'attacker']);
        expect(control).toEqual(['ally-b', 'ally-c', 'attacker']);
    });
});

describe("APEX's charged: 'the primary target is inflicted with Disable' reaches every struck enemy", () => {
    const shielded = (id: string) => (a: CombatActor) => {
        if (a.id === id) a.shieldPool = 1e7;
    };

    it('player APEX holding a shield → Attack Down II and Disable on A, B and C', () => {
        const { debuffs, control } = measure(
            base({ ...playerCaster('APEX', 'charged', circle()), enemyAttackers: enemyRow() }),
            'attacker',
            shielded('attacker')
        );
        expect(debuffs['Attack Down II']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(debuffs['Disable']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(control).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
    });

    it('player APEX without a shield → no Disable anywhere', () => {
        const { debuffs } = measure(
            base({ ...playerCaster('APEX', 'charged', circle()), enemyAttackers: enemyRow() }),
            'attacker'
        );
        expect(debuffs['Attack Down II']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(debuffs['Disable']).toBeUndefined();
    });

    it('enemy-side APEX holding a shield → Disable on the three player ships he strikes', () => {
        const { debuffs } = measure(
            playerBoard(enemyCaster('APEX', 'charged', circle())),
            'enemy-caster',
            shielded('enemy-caster')
        );
        expect(debuffs['Disable']).toEqual(['ally-b', 'ally-c', 'attacker']);
    });
});

describe('shield removal reaches every enemy the pattern strikes', () => {
    const SHIELD = 100_000;
    const shieldAll = (ids: string[]) => (a: CombatActor) => {
        if (ids.includes(a.id)) a.shieldPool = SHIELD;
    };
    /** Shield left on each id, as a fraction of the seeded pool. The caster's 1-attack hit takes
     *  a few points off a struck shield; a strip takes tens of percent. */
    const shieldLeft = (m: Measured, ids: string[]) =>
        Object.fromEntries(
            ids.map((id) => [id, Math.round((100 * m.actors.get(id)!.shieldPool) / SHIELD)])
        );

    for (const [ship, slot, pct] of [
        ['Laika', 'charged', 40],
        ['APEX', 'active', 30],
        ['Malvex', 'charged', 30],
    ] as const) {
        it(`player ${ship} (${slot}) on Circle → ${pct}% off A, B and C; the enemy outside keeps its shield`, () => {
            const m = measure(
                base({ ...playerCaster(ship, slot, circle()), enemyAttackers: enemyRow() }),
                'attacker',
                shieldAll(ENEMY_IDS)
            );
            expect(m.stripped).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
            expect(shieldLeft(m, ENEMY_IDS)).toEqual({
                'enemy-a': 100 - pct,
                'enemy-b': 100 - pct,
                'enemy-c': 100 - pct,
                'enemy-out': 100,
            });
        });
    }

    it('player Laika on a single-target pattern → A alone', () => {
        const m = measure(
            base({ ...playerCaster('Laika', 'charged', single()), enemyAttackers: enemyRow() }),
            'attacker',
            shieldAll(ENEMY_IDS)
        );
        expect(m.stripped).toEqual(['enemy-a']);
        expect(shieldLeft(m, ENEMY_IDS)).toEqual({
            'enemy-a': 60,
            'enemy-b': 100,
            'enemy-c': 100,
            'enemy-out': 100,
        });
    });

    it('enemy-side Laika on Circle → 40% off the three player ships she strikes', () => {
        const m = measure(
            playerBoard(enemyCaster('Laika', 'charged', circle())),
            'enemy-caster',
            shieldAll(PLAYER_IDS)
        );
        expect(m.stripped).toEqual(['ally-b', 'ally-c', 'attacker']);
        expect(shieldLeft(m, PLAYER_IDS)).toEqual({
            attacker: 60,
            'ally-b': 60,
            'ally-c': 60,
            'ally-out': 100,
        });
    });
});

describe("Crocus's per-enemy Stasis gate spreads over every struck enemy", () => {
    const corrosion = (n: number): ActiveDoTStack[] =>
        Array.from({ length: n }, () => ({
            stacks: 1,
            tier: 1,
            remainingRounds: 9,
            sourceId: 'seed',
        }));
    const seeded =
        (counts: Record<string, number>) =>
        (a: CombatActor): void => {
            const n = counts[a.id];
            if (n) a.corrosionEntries.push(...corrosion(n));
        };

    it('player Crocus on Circle; debuffs A 3, B 1, C 4 → Stasis on A and C', () => {
        const { debuffs } = measure(
            base({ ...playerCaster('Crocus', 'active', circle()), enemyAttackers: enemyRow() }),
            'attacker',
            seeded({ 'enemy-a': 3, 'enemy-b': 1, 'enemy-c': 4, 'enemy-out': 5 })
        );
        expect(debuffs['Stasis']).toEqual(['enemy-a', 'enemy-c']);
    });

    it('enemy-side Crocus on Circle; debuffs focus 1, B 3, C 4 → Stasis on B and C', () => {
        const { debuffs } = measure(
            playerBoard(enemyCaster('Crocus', 'active', circle())),
            'enemy-caster',
            seeded({ attacker: 1, 'ally-b': 3, 'ally-c': 4, 'ally-out': 5 })
        );
        expect(debuffs['Stasis']).toEqual(['ally-b', 'ally-c']);
    });
});

describe('buff steal takes one buff from EACH struck enemy', () => {
    /** Each enemy grants itself one buff of its own name before the caster acts. */
    const ownBuff = (id: string) => buffKit([`Buff of ${id}`]);
    const selfBuffs = (m: Measured, id: string) =>
        m.engine
            .timedAbilityStatuses('self', id)
            .map((s) => s.payload.buffName)
            .sort();

    it('player Tithonus on Circle → steals from A, B and C; he and his adjacent ally hold all three', () => {
        const m = measure(
            base({
                ...playerCaster('Tithonus', 'charged', circle()),
                teamActors: [playerShip('ally-adj', 'M3')],
                enemyAttackers: enemyRow(ownBuff),
            }),
            'attacker'
        );
        expect(m.steals).toEqual({
            'enemy-a': ['Buff of enemy-a'],
            'enemy-b': ['Buff of enemy-b'],
            'enemy-c': ['Buff of enemy-c'],
        });
        const stolen = ['Buff of enemy-a', 'Buff of enemy-b', 'Buff of enemy-c'];
        expect(selfBuffs(m, 'attacker')).toEqual(stolen);
        expect(selfBuffs(m, 'ally-adj')).toEqual(stolen);
        expect(selfBuffs(m, 'enemy-out')).toEqual(['Buff of enemy-out']);
    });

    it('player Tithonus on a single-target pattern → steals from A alone', () => {
        const m = measure(
            base({
                ...playerCaster('Tithonus', 'charged', single()),
                enemyAttackers: enemyRow(ownBuff),
            }),
            'attacker'
        );
        expect(Object.keys(m.steals)).toEqual(['enemy-a']);
    });

    it('player Pallas on Circle → steals one buff from each of A, B and C', () => {
        const m = measure(
            base({
                ...playerCaster('Pallas', 'charged', circle()),
                enemyAttackers: enemyRow(ownBuff),
            }),
            'attacker'
        );
        expect(Object.keys(m.steals).sort()).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(selfBuffs(m, 'attacker')).toEqual([
            'Buff of enemy-a',
            'Buff of enemy-b',
            'Buff of enemy-c',
        ]);
    });

    it('enemy-side Tithonus on Circle → steals from the three player ships he strikes', () => {
        const m = measure(
            playerBoard(enemyCaster('Tithonus', 'charged', circle()), ownBuff),
            'enemy-caster'
        );
        expect(Object.keys(m.steals).sort()).toEqual(['ally-b', 'ally-c', 'attacker']);
        expect(selfBuffs(m, 'enemy-caster')).toEqual([
            'Buff of ally-b',
            'Buff of ally-c',
            'Buff of attacker',
        ]);
    });
});

describe('the single-ship DPS calculator is unchanged by the fan-out', () => {
    const DPS_INPUT = {
        attack: 15000,
        crit: 50,
        critDamage: 150,
        defensePenetration: 10,
        chargeCount: 3,
        enemyDefense: 8000,
        enemyHp: 400000,
        rounds: 12,
        selfBuffs: [],
        enemyDebuffs: [],
        hacking: 250,
        enemySecurity: 100,
        defence: 6000,
        hp: 30000,
    };

    it("Arum's DPS run deals the same total it dealt before the fan-out", () => {
        const built = buildTraceShip('Arum');
        if (!built) throw new Error('Arum missing');
        const result = simulateDPS({ ...DPS_INPUT, shipSkills: buildShipAbilities(built) });
        expect(result.summary.totalDamage).toBe(DPS_ARUM_TOTAL);
    });
});

/** Arum's `simulateDPS` total measured on the pre-fan-out engine (same input, same seed). */
const DPS_ARUM_TOTAL = 165_994;
