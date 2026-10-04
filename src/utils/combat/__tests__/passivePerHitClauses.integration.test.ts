/**
 * A passive clause that rides the owner's hits ("When this Unit deals damage to an enemy that has
 * 2 or more debuffs, it inflicts Speed Down II and Out. Damage Down II for 2 turns and gains
 * Terran Bolster II for 2 turns" — Bayah; "After dealing damage to an enemy with more than 2
 * debuffs, this Unit inflicts Block Buff for 1 turn" — Bizon) applies on every cast, PER STRUCK
 * ENEMY, gated on that enemy's debuff count from BEFORE the cast (owner ruling R15, 2026-10-04):
 * Bayah hits A (1 debuff), B (2) and C (0), her active lands 2 more on each, and only B gets
 * Speed Down II and Out. Damage Down II. The self gain fires ONCE per cast if ANY struck enemy
 * qualifies (R17), never at combat start.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv, refit 4). The caster fires
 * Pattern-Circle-Range-1 anchored on M4, which strikes M4 (A), M3 (B) and T4 (C); M2 (OUT) stands
 * outside it. Caster hacking dwarfs every security, so every landing roll lands. Debuffs are
 * seeded as Corrosion entries, which count one each.
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
import type { ShipSkills } from '../../../types/abilities';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const circle = (): ParsedPattern => parsePattern('Pattern-Circle-Range-1');
const single = (): ParsedPattern => parsePattern('Pattern-Base');

/** The ship's real active and passive slots, as parsed. */
const realKit = (ship: string): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const slots = buildShipAbilities(built).slots.filter(
        (s) => s.slot === 'active' || s.slot === 'passive'
    );
    if (slots.length !== 2) throw new Error(`${ship} lacks an active or a passive slot`);
    return { slots };
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

const corrosion = (n: number): ActiveDoTStack[] =>
    Array.from({ length: n }, () => ({ stacks: 1, tier: 1, remainingRounds: 9, sourceId: 'seed' }));

const ENEMY_POSITIONS: [string, Position][] = [
    ['enemy-a', 'M4'],
    ['enemy-b', 'M3'],
    ['enemy-c', 'T4'],
    ['enemy-out', 'M2'],
];

/** A durable, harmless enemy, faster than the caster. */
const enemyAt = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: single(),
    shipSkills: NO_SKILLS,
});

/** A durable, harmless player-side ship, faster than the enemy caster. */
const playerShip = (id: string, position: Position): TeamActor => ({
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
        shipSkills: NO_SKILLS,
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

/** The player caster: `ship`'s real active + passive, firing on round 1. */
const playerBoard = (ship: string, pattern: ParsedPattern): CombatEngineInput =>
    base({
        shipSkills: realKit(ship),
        pattern,
        enemyAttackers: ENEMY_POSITIONS.map(([id, p]) => enemyAt(id, p)),
    });

/** The enemy caster: `ship`'s real active + passive, slower than every player ship. It strikes
 *  the focus at M4 (A), ally-b at M3 (B) and ally-c at T4 (C); ally-out at M2 stands outside. */
const enemyBoard = (ship: string, pattern: ParsedPattern): CombatEngineInput =>
    base({
        attack: 0,
        hacking: 0,
        speed: 150,
        pattern: single(),
        teamActors: [
            playerShip('ally-b', 'M3'),
            playerShip('ally-c', 'T4'),
            playerShip('ally-out', 'M2'),
        ],
        enemyAttackers: [
            {
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
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                target: parseTarget('front'),
                pattern,
                shipSkills: realKit(ship),
            },
        ],
    });

interface Measured {
    /** `buffName → sorted target ids` of the caster's round-1 `debuff-applied`. */
    debuffs: Record<string, string[]>;
    /** Sorted ids the caster's round-1 cast struck. */
    struck: string[];
    /** Every `buff-applied` the caster received, as `round:buffName`, in emission order. */
    selfBuffs: string[];
}

const measure = (
    input: CombatEngineInput,
    casterId: string,
    seeds: Record<string, number>
): Measured => {
    const bus = createEventBus();
    const debuffs: Record<string, string[]> = {};
    const struck = new Set<string>();
    const selfBuffs: string[] = [];
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId !== casterId || e.round !== 1) return;
        (debuffs[e.buffName] ??= []).push(e.targetId);
    });
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === casterId && e.round === 1) struck.add(e.targetId);
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId === casterId) selfBuffs.push(`${e.round}:${e.buffName}`);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all) => {
            for (const a of all) {
                const n = seeds[a.id];
                if (n) a.corrosionEntries.push(...corrosion(n));
            }
        },
    });
    for (const k of Object.keys(debuffs)) debuffs[k].sort();
    return { debuffs, struck: [...struck].sort(), selfBuffs };
};

const BOLSTER = 'Terran Bolster II';
const bolsters = (m: Measured): string[] => m.selfBuffs.filter((b) => b.endsWith(BOLSTER));

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Bayah: the per-hit passive lands on each struck enemy that had 2+ debuffs before the cast', () => {
    const P = (seeds: Record<string, number>, pattern = circle()) =>
        measure(playerBoard('Bayah', pattern), 'attacker', seeds);
    const E = (seeds: Record<string, number>, pattern = circle()) =>
        measure(enemyBoard('Bayah', pattern), 'enemy-caster', seeds);

    it('player: A 1, B 2, C 0 → Speed Down II and Out. Damage Down II on B alone; one Terran Bolster', () => {
        const m = P({ 'enemy-a': 1, 'enemy-b': 2, 'enemy-out': 2 });
        expect(m.struck).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        // Her active's own two debuffs reach all three (the instrument can see a landing).
        expect(m.debuffs['Attack Down II']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(m.debuffs['Speed Down II']).toEqual(['enemy-b']);
        expect(m.debuffs['Out. Damage Down II']).toEqual(['enemy-b']);
        expect(bolsters(m)).toEqual([`1:${BOLSTER}`]);
    });

    it('player, reversed: A 2, B 0, C 1 → the aimed enemy alone', () => {
        const m = P({ 'enemy-a': 2, 'enemy-c': 1 });
        expect(m.debuffs['Speed Down II']).toEqual(['enemy-a']);
        expect(m.debuffs['Out. Damage Down II']).toEqual(['enemy-a']);
        expect(bolsters(m)).toEqual([`1:${BOLSTER}`]);
    });

    it('player: A 2, B 2, C 2 → all three, and still ONE Terran Bolster', () => {
        const m = P({ 'enemy-a': 2, 'enemy-b': 2, 'enemy-c': 2 });
        expect(m.debuffs['Speed Down II']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(bolsters(m)).toEqual([`1:${BOLSTER}`]);
    });

    it("player: the cast's own debuffs do not count — A 1, B 1, C 1 → nothing", () => {
        const m = P({ 'enemy-a': 1, 'enemy-b': 1, 'enemy-c': 1 });
        expect(m.debuffs['Attack Down II']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(m.debuffs['Speed Down II']).toBeUndefined();
        expect(m.debuffs['Out. Damage Down II']).toBeUndefined();
        expect(bolsters(m)).toEqual([]);
    });

    it('player, Pattern-Base: B at 2 is not struck → nothing; A at 2 → A alone', () => {
        const none = P({ 'enemy-b': 2 }, single());
        expect(none.struck).toEqual(['enemy-a']);
        expect(none.debuffs['Speed Down II']).toBeUndefined();
        expect(bolsters(none)).toEqual([]);
        const aimed = P({ 'enemy-a': 2 }, single());
        expect(aimed.debuffs['Speed Down II']).toEqual(['enemy-a']);
        expect(bolsters(aimed)).toEqual([`1:${BOLSTER}`]);
    });

    it('enemy-side: focus 1, ally-b 2, ally-c 0 → ally-b alone; one Terran Bolster', () => {
        const m = E({ attacker: 1, 'ally-b': 2, 'ally-out': 2 });
        expect(m.struck).toEqual(['ally-b', 'ally-c', 'attacker']);
        expect(m.debuffs['Speed Down II']).toEqual(['ally-b']);
        expect(m.debuffs['Out. Damage Down II']).toEqual(['ally-b']);
        expect(bolsters(m)).toEqual([`1:${BOLSTER}`]);
    });

    it('enemy-side, reversed: focus 2, ally-b 0, ally-c 1 → the focus alone', () => {
        const m = E({ attacker: 2, 'ally-c': 1 });
        expect(m.debuffs['Speed Down II']).toEqual(['attacker']);
        expect(bolsters(m)).toEqual([`1:${BOLSTER}`]);
    });

    it('enemy-side: nobody at 2 → nothing', () => {
        const m = E({ attacker: 1, 'ally-b': 1 });
        expect(m.debuffs['Speed Down II']).toBeUndefined();
        expect(bolsters(m)).toEqual([]);
    });
});

describe('Bizon: Block Buff lands on each struck enemy that had 3+ debuffs before the cast', () => {
    it('player: A 3, B 2, C 4 → A and C (B reaches 4 only with the cast’s own debuffs)', () => {
        const m = measure(playerBoard('Bizon', circle()), 'attacker', {
            'enemy-a': 3,
            'enemy-b': 2,
            'enemy-c': 4,
            'enemy-out': 3,
        });
        expect(m.struck).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(m.debuffs['Speed Down II']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(m.debuffs['Block Buff']).toEqual(['enemy-a', 'enemy-c']);
    });

    it('player, reversed: A 2, B 3 → B alone', () => {
        const m = measure(playerBoard('Bizon', circle()), 'attacker', {
            'enemy-a': 2,
            'enemy-b': 3,
        });
        expect(m.debuffs['Block Buff']).toEqual(['enemy-b']);
    });

    it('player, Pattern-Base: B at 3 is not struck → nothing', () => {
        const m = measure(playerBoard('Bizon', single()), 'attacker', { 'enemy-b': 3 });
        expect(m.debuffs['Block Buff']).toBeUndefined();
    });

    it('enemy-side: focus 0, ally-b 3, ally-c 4 → ally-b and ally-c', () => {
        const m = measure(enemyBoard('Bizon', circle()), 'enemy-caster', {
            'ally-b': 3,
            'ally-c': 4,
            'ally-out': 3,
        });
        expect(m.debuffs['Block Buff']).toEqual(['ally-b', 'ally-c']);
    });
});

describe('Sha Xing: "When damaging a debuffed enemy" gains Tianchao Precision II once if any struck enemy is debuffed', () => {
    const PRECISION = 'Tianchao Precision II';
    const precisions = (m: Measured) => m.selfBuffs.filter((b) => b.endsWith(PRECISION));

    it('player: A 0, B 1, C 0 → one grant', () => {
        const m = measure(playerBoard('Sha Xing', circle()), 'attacker', { 'enemy-b': 1 });
        expect(m.struck).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(precisions(m)).toEqual([`1:${PRECISION}`]);
    });

    it("player: nobody debuffed before the cast → none (her own Inc. Repair Down II doesn't count)", () => {
        const m = measure(playerBoard('Sha Xing', circle()), 'attacker', { 'enemy-out': 1 });
        expect(m.debuffs['Inc. Repair Down II']).toEqual(['enemy-a', 'enemy-b', 'enemy-c']);
        expect(precisions(m)).toEqual([]);
    });

    it('enemy-side: focus 0, ally-c 1 → one grant', () => {
        const m = measure(enemyBoard('Sha Xing', circle()), 'enemy-caster', { 'ally-c': 1 });
        expect(precisions(m)).toEqual([`1:${PRECISION}`]);
    });
});

describe('DPS calculator: the one enemy is the struck set', () => {
    const debuff = (name: string): SelectedGameBuff => ({
        id: name,
        buffName: name,
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
    });
    const run = (enemyDebuffs: SelectedGameBuff[]) => {
        const built = buildTraceShip('Bayah');
        if (!built) throw new Error('Bayah missing');
        const bus = createEventBus();
        const bolsterRounds: number[] = [];
        const speedDownRounds: number[] = [];
        bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
            if (e.buffName === BOLSTER) bolsterRounds.push(e.round);
        });
        bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
            if (e.buffName === 'Speed Down II') speedDownRounds.push(e.round);
        });
        simulateDPS({
            attack: 15000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            chargeCount: 99,
            enemyDefense: 8000,
            enemyHp: 1e12,
            rounds: 3,
            selfBuffs: [],
            enemyDebuffs,
            hacking: 1e6,
            enemySecurity: 0,
            defence: 6000,
            hp: 30000,
            shipSkills: buildShipAbilities(built),
            bus,
        });
        return { bolsterRounds, speedDownRounds };
    };

    it('no configured debuffs: round 1 does not qualify, rounds 2 and 3 do (her own round-1 debuffs)', () => {
        expect(run([])).toEqual({ bolsterRounds: [2, 3], speedDownRounds: [2, 3] });
    });

    it('two configured debuffs: every cast qualifies; nothing is seeded at combat start', () => {
        expect(run([debuff('Defense Down II'), debuff('Attack Down II')])).toEqual({
            bolsterRounds: [1, 2, 3],
            speedDownRounds: [1, 2, 3],
        });
    });

    it("a role-gated passive gain keeps its combat-start seed (Anjian's Stealth against a Debuffer)", () => {
        const built = buildTraceShip('Anjian');
        if (!built) throw new Error('Anjian missing');
        const bus = createEventBus();
        const stealthRounds: number[] = [];
        bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
            if (e.buffName === 'Stealth') stealthRounds.push(e.round);
        });
        simulateDPS({
            attack: 15000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            chargeCount: 99,
            enemyDefense: 8000,
            enemyHp: 1e12,
            rounds: 3,
            selfBuffs: [],
            enemyDebuffs: [],
            enemyType: 'Debuffer',
            hacking: 1e6,
            enemySecurity: 0,
            defence: 6000,
            hp: 30000,
            shipSkills: buildShipAbilities(built),
            bus,
        });
        expect(stealthRounds).toEqual([1]);
    });
});
