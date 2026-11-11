/**
 * Row-choice targeting (#519, Mamma Maglienza and her Capos). A `row-most` / `row-least` cast with
 * `Pattern-Row` picks one opposing row and strikes every unit in it as a PRIMARY target at full
 * damage — no covered 50% cells. Owner rulings 2026-11-11:
 *   - most: the row with the most living enemies, ties M → B → T; least: the fewest among
 *     non-empty rows, ties on the caster's own row first, then M → B → T;
 *   - a multi-hex unit counts once in each row it covers;
 *   - a stealthed ship counts toward its row's size, and the row hit strikes it;
 *   - a caster under Taunt, Provoke or Concentrate Fire hits the forcing ship's row;
 *   - Protection still redirects a row hit (it is not a whole-battlefield hit).
 * Every board runs with the attacker on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern, parseTarget } from '../../targetingParser';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(519));

const SIDES: Placement[] = ['player', 'enemy'];

interface Round1Hit {
    taken: number;
    primary: boolean[];
}

/** What each unit took from `attackerId`'s round-1 cast, and the primary flag of each hit. */
const runRound1 = (
    input: Parameters<typeof runCombat>[0],
    attackerId: string
): { hits: Map<string, Round1Hit>; debuffs: Map<string, string[]> } => {
    const bus = createEventBus();
    const hits = new Map<string, Round1Hit>();
    const debuffs = new Map<string, string[]>();
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== attackerId || e.round !== 1) return;
        const prior = hits.get(e.targetId) ?? { taken: 0, primary: [] };
        prior.taken += e.takenDamage ?? 0;
        prior.primary.push(e.isPrimaryTarget === true);
        hits.set(e.targetId, prior);
    });
    bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
        if (e.round === 1) debuffs.set(e.actorId, e.debuffNames);
    });
    runCombat({ ...input, bus });
    for (const h of hits.values()) h.taken = Math.round(h.taken);
    return { hits, debuffs };
};

const rowAttacker = (
    selection: 'row-most' | 'row-least',
    position: Position,
    kit: ShipSkills = hitKit(100)
): BoardUnit => ({
    id: 'mamma',
    kit,
    position,
    speed: 300,
    attack: 10_000,
    hacking: 100_000,
    target: parseTarget(selection),
    pattern: parsePattern('Pattern-Row'),
});

const dummy = (id: string, position: Position): BoardUnit => ({
    id,
    kit: NO_KIT,
    position,
    speed: 1,
});

/** The opposing board: row M holds three units, rows T and B one each. */
const threeOneOne = (): BoardUnit[] => [
    dummy('m4', 'M4'),
    dummy('m2', 'M2'),
    dummy('m1', 'M1'),
    dummy('t4', 'T4'),
    dummy('b3', 'B3'),
];

const probeDebuff: Ability = {
    id: 'probe-debuff',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Probe Mark',
        duration: 5,
        stacks: 1,
        isStackable: false,
        application: 'apply',
        parsedEffects: {},
    },
};

const tauntSelf: Ability = {
    id: 'taunt-self',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Taunt',
        duration: 3,
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
    },
};

const selfBuff = (buffName: string): Ability => ({
    ...tauntSelf,
    id: `self-${buffName}`,
    config: { ...tauntSelf.config, buffName } as Ability['config'],
});

/** A unit that casts `buffName` on itself before the row caster acts. */
const selfBuffer = (id: string, position: Position, buffName: string): BoardUnit => ({
    id,
    kit: { slots: [{ slot: 'active', abilities: [selfBuff(buffName)] }] },
    position,
    speed: 400,
});

const debuffNamed = (buffName: string): Ability => ({
    ...probeDebuff,
    id: `debuff-${buffName}`,
    config: { ...probeDebuff.config, buffName, duration: 2 } as Ability['config'],
});

/** A fast unit whose cast lands `buffName` on the front-most opposing ship of its own row. */
const debuffer = (id: string, position: Position, buffName: string): BoardUnit => ({
    id,
    kit: { slots: [{ slot: 'active', abilities: [debuffNamed(buffName)] }] },
    position,
    speed: 400,
    hacking: 100_000,
});

describe.each(SIDES)('forced targeting picks the row, attacker on the %s side', (placement) => {
    // Row M holds three, so an unforced row-most cast strikes M.
    const board = (provoker: BoardUnit) => [
        dummy('m4', 'M4'),
        dummy('m2', 'M2'),
        dummy('m1', 'M1'),
        provoker,
        dummy('t2', 'T2'),
        dummy('b3', 'B3'),
        dummy('b1', 'B1'),
    ];

    it("a provoked row-most caster strikes the provoker's whole row", () => {
        const opponents = board(debuffer('provoker', 'T4', 'Provoke'));
        const attacker = rowAttacker('row-most', 'T1');
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits } = runRound1(input, id(attacker));
        expect([...hits.keys()].sort()).toEqual(
            opponents
                .filter((u) => u.position.startsWith('T'))
                .map(id)
                .sort()
        );
    });

    it("a row-most caster strikes the Concentrate Fire carrier's whole row", () => {
        const opponents = board(dummy('t4', 'T4'));
        // The marker sits in row B and marks B3, the front-most ship of that row.
        const marker = debuffer('marker', 'B1', 'Concentrate Fire');
        const attacker = rowAttacker('row-most', 'T1');
        const { input, id } = boardInput(placement, attacker, [marker], opponents, 1);
        const { hits } = runRound1(input, id(attacker));
        expect([...hits.keys()].sort()).toEqual(
            opponents
                .filter((u) => u.position.startsWith('B'))
                .map(id)
                .sort()
        );
    });

    it('validity: unforced, the same board strikes row M', () => {
        const opponents = board(dummy('t4', 'T4'));
        const attacker = rowAttacker('row-most', 'T1');
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits } = runRound1(input, id(attacker));
        expect([...hits.keys()].sort()).toEqual(
            opponents
                .filter((u) => u.position.startsWith('M'))
                .map(id)
                .sort()
        );
    });
});

describe.each(SIDES)('stealthed ships in the row count, attacker on the %s side', (placement) => {
    it('row-most: a stealthed ship counts toward its row and is struck with it', () => {
        // M holds two; B holds two plus one stealthed. Without the stealthed ship the M/B tie
        // goes to M.
        const opponents = [
            dummy('m4', 'M4'),
            dummy('m2', 'M2'),
            selfBuffer('ghost', 'B4', 'Stealth'),
            dummy('b3', 'B3'),
            dummy('b1', 'B1'),
        ];
        const attacker = rowAttacker('row-most', 'T1');
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits } = runRound1(input, id(attacker));
        const bRow = opponents.filter((u) => u.position.startsWith('B')).map(id);
        expect([...hits.keys()].sort()).toEqual([...bRow].sort());
        for (const victim of bRow) expect(hits.get(victim)!.taken).toBe(10_000);
    });

    it('row-least: a stealthed ship counts toward its row', () => {
        // T holds one plus one stealthed, M two, B three; the caster sits in B. Counting the
        // stealthed ship ties T with M, and M wins (after the caster's own row B, which is full).
        // Without it T alone is the emptiest.
        const opponents = [
            dummy('t4', 'T4'),
            selfBuffer('ghost', 'T2', 'Stealth'),
            dummy('m4', 'M4'),
            dummy('m3', 'M3'),
            dummy('b4', 'B4'),
            dummy('b3', 'B3'),
            dummy('b2', 'B2'),
        ];
        const attacker = rowAttacker('row-least', 'B1');
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits } = runRound1(input, id(attacker));
        expect([...hits.keys()].sort()).toEqual(
            opponents
                .filter((u) => u.position.startsWith('M'))
                .map(id)
                .sort()
        );
    });

    it('validity: the stealthed ship is untargetable to a single-target cast', () => {
        const opponents = [selfBuffer('ghost', 'B4', 'Stealth'), dummy('b3', 'B3')];
        const attacker: BoardUnit = {
            ...rowAttacker('row-most', 'B1'),
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
        };
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits } = runRound1(input, id(attacker));
        expect([...hits.keys()]).toEqual([id(opponents[1])]);
    });
});

describe.each(SIDES)('row-choice cast, attacker on the %s side', (placement) => {
    it('row-most strikes every unit of the fullest row at full damage, each as a primary target', () => {
        const kit: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [...hitKit(100).slots[0].abilities, probeDebuff] },
            ],
        };
        const attacker = rowAttacker('row-most', 'T1', kit);
        const opponents = threeOneOne();
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits, debuffs } = runRound1(input, id(attacker));
        const struck = opponents.filter((u) => u.position.startsWith('M')).map(id);
        expect([...hits.keys()].sort()).toEqual([...struck].sort());
        for (const victim of struck) {
            expect(hits.get(victim)).toEqual({ taken: 10_000, primary: [true] });
            expect(debuffs.get(victim)).toContain('Probe Mark');
        }
        for (const other of opponents.filter((u) => !u.position.startsWith('M')).map(id)) {
            expect(debuffs.get(other) ?? []).not.toContain('Probe Mark');
        }
    });

    it("row-least strikes the emptiest row; a tie goes to the caster's own row", () => {
        // Rows T and B hold one each; the caster sits in T.
        const attacker = rowAttacker('row-least', 'T1');
        const opponents = threeOneOne();
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits } = runRound1(input, id(attacker));
        const t4 = id(opponents.find((u) => u.id === 't4')!);
        expect([...hits.keys()]).toEqual([t4]);
        expect(hits.get(t4)).toEqual({ taken: 10_000, primary: [true] });
    });

    it("row-least: a B-row caster's own row wins a B/M tie that M → B → T would give to M", () => {
        const opponents = [
            dummy('m3', 'M3'),
            dummy('b4', 'B4'),
            dummy('t4', 'T4'),
            dummy('t3', 'T3'),
            dummy('t2', 'T2'),
        ];
        const attacker = rowAttacker('row-least', 'B1');
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits } = runRound1(input, id(attacker));
        expect([...hits.keys()]).toEqual([id(opponents[1])]);
    });

    it("a taunted row-most caster strikes the taunter's whole row instead", () => {
        const taunter: BoardUnit = {
            id: 'taunter',
            kit: { slots: [{ slot: 'active', abilities: [tauntSelf] }] },
            position: 'T4',
            speed: 400,
        };
        const opponents = [
            dummy('m4', 'M4'),
            dummy('m2', 'M2'),
            dummy('m1', 'M1'),
            taunter,
            dummy('t2', 'T2'),
            dummy('b3', 'B3'),
        ];
        const attacker = rowAttacker('row-most', 'T1');
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits } = runRound1(input, id(attacker));
        const tRow = opponents.filter((u) => u.position.startsWith('T')).map(id);
        expect([...hits.keys()].sort()).toEqual([...tRow].sort());
        for (const victim of tRow) expect(hits.get(victim)!.taken).toBe(10_000);
    });

    it('validity: the same board without the Taunt strikes the fullest row (M)', () => {
        const opponents = [
            dummy('m4', 'M4'),
            dummy('m2', 'M2'),
            dummy('m1', 'M1'),
            dummy('taunter', 'T4'),
            dummy('t2', 'T2'),
            dummy('b3', 'B3'),
        ];
        const attacker = rowAttacker('row-most', 'T1');
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits } = runRound1(input, id(attacker));
        expect([...hits.keys()].sort()).toEqual(
            opponents
                .filter((u) => u.position.startsWith('M'))
                .map(id)
                .sort()
        );
    });

    it('Protection still redirects a row hit (30% to Meatshield outside the row)', () => {
        // Rows M and B hold one each, T two; the caster sits in M, so row-least picks M.
        const attacker = rowAttacker('row-least', 'M1', hitKit(60));
        const meatshield: BoardUnit = {
            id: 'meatshield',
            kit: {
                slots: realKit('Meatshield').slots.map((s) =>
                    s.slot === 'passive' ? s : { slot: s.slot, abilities: [] }
                ),
            },
            position: 'B4',
            speed: 1,
        };
        const victim = dummy('victim', 'M4');
        const opponents = [victim, meatshield, dummy('t4', 'T4'), dummy('t3', 'T3')];
        const { input, id } = boardInput(placement, attacker, [], opponents, 1);
        const { hits, debuffs } = runRound1(input, id(attacker));
        expect(hits.get(id(victim))).toEqual({ taken: 4200, primary: [true] });
        expect(debuffs.get('meatshield')).toEqual(['Damage over Time']);
    });
});

// ---------------------------------------------------------------------------
// A multi-hex unit counts once in each row it covers — through the battle path.
// ---------------------------------------------------------------------------

const ROW_DAMAGE = 'This Unit deals <unit-damage>100% damage</unit-damage>.';

const makeShip = (id: string, target = 'front', pattern = 'Pattern-Base'): Ship => ({
    id,
    name: id,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'ATTACKER',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: ROW_DAMAGE,
    chargeSkillCharge: 0,
    activeTarget: target,
    activePattern: pattern,
});

const place = (
    ship: Ship,
    position: Position,
    attack: number,
    speed: number,
    footprint?: Position[]
): BattlePlacement => ({
    ship,
    position,
    ...(footprint ? { footprint } : {}),
    statOverrides: {
        attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 10_000,
        defence: 0,
        hp: 1_000_000_000,
        speed,
    },
});

describe.each(SIDES)('a multi-hex unit in the row count, attacker on the %s side', (side) => {
    it('Mamma-shaped footprint T1,M2,M3,B1 plus T4 and B4: row-most picks B', () => {
        // Per unit per row: T = boss + T4 = 2, M = boss = 1, B = boss + B4 = 2 → tie, B before T.
        // Counting cells would make M = 2 and win the tie; counting the anchor row alone would
        // make T the only 2.
        const attacker = [place(makeShip('caster', 'row-most', 'Pattern-Row'), 'M1', 5000, 300)];
        const defenders = [
            place(makeShip('boss'), 'T1', 0, 1, ['T1', 'M2', 'M3', 'B1']),
            place(makeShip('top'), 'T4', 0, 1),
            place(makeShip('bottom'), 'B4', 0, 1),
        ];
        const result = simulateBattle({
            playerTeam: side === 'player' ? attacker : defenders,
            enemyTeam: side === 'player' ? defenders : attacker,
            rounds: 1,
        });
        const casterId = result.roster.find((r) => r.position === 'M1' && r.side === side)!.actorId;
        const idAt = (pos: Position) =>
            result.roster.find((r) => r.position === pos && r.side !== side)!.actorId;
        const entries = result.combatLog[0].turns
            .flatMap((t) => t.entries)
            .filter((e) => e.kind === 'attack' && e.actorId === casterId);
        expect(entries).toHaveLength(1);
        const [entry] = entries;
        const struck = entry.kind === 'attack' ? entry.targets.map((t) => t.targetId) : [];
        expect([...struck].sort()).toEqual([idAt('T1'), idAt('B4')].sort());
    });
});
