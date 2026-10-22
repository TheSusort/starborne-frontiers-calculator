import { describe, it, expect } from 'vitest';
import {
    compareMirror,
    labelsFromRoster,
    mirrorIdMap,
    remapStreamKey,
    runMirrorPair,
    runSwappedPaired,
    swapSides,
    withSpeedNudge,
} from '../sideMirror';
import { canonicalPlacement } from '../fixtures';
import { runSeededBattle } from '../../../simulator/seededRuns';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import type {
    BattleResult,
    BattleSimulationInput,
    ShipRoundState,
} from '../../../calculators/battleSimulator';
import type { CombatLogEntry } from '../../log/types';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';

// ---------------------------------------------------------------------------
// Synthetic 1v1 fixtures: ship `a` vs ship `b`. Original arm ids: a='attacker', b='e:b:0'.
// Swapped arm ids: b='attacker', a='e:a:0'.
// ---------------------------------------------------------------------------

function fakeShip(id: string): Ship {
    return { id, name: id.toUpperCase(), baseStats: { speed: 50 } } as unknown as Ship;
}

function input1v1(posA: Position = 'T1', posB: Position = 'T1'): BattleSimulationInput {
    return {
        playerTeam: [{ ship: fakeShip('a'), position: posA, statOverrides: { speed: 50 } }],
        enemyTeam: [{ ship: fakeShip('b'), position: posB, statOverrides: { speed: 50 } }],
    };
}

function state(actorId: string, side: 'player' | 'enemy', damageTaken: number): ShipRoundState {
    return {
        actorId,
        side,
        damageDealt: 0,
        damageTaken,
        healingDone: 0,
        healingReceived: 0,
        shieldsAbsorbed: 0,
        shieldGranted: 0,
        shieldStripped: 0,
        currentShieldPool: 0,
        incomingDamage: damageTaken,
        incomingShieldAbsorbed: 0,
        incomingBarrierAbsorbed: 0,
        hpPct: 100,
        shieldPct: 0,
        alive: true,
        activeBuffs: [],
        activeDebuffs: [],
    };
}

function attack(actorId: string, targetId: string, amount: number): CombatLogEntry {
    return { kind: 'attack', actorId, targets: [{ targetId, amount }], reactions: [] };
}

function buff(actorId: string, note: string): CombatLogEntry {
    return { kind: 'buff', actorId, targets: [{ targetId: actorId }], reactions: [], note };
}

/** One round: `first` acts then `second`; the player side's ship takes 10, the enemy's 20. The
 *  fight shape is the same in both arms — only the ids and sides are relabelled. */
function result(opts: {
    aId: string;
    bId: string;
    aSide: 'player' | 'enemy';
    first: 'a' | 'b';
    startOfRound?: CombatLogEntry[];
    winner?: 'player' | 'enemy';
    speeds?: { a: number; b: number };
    positions?: { a: Position; b: Position };
}): BattleResult {
    const { aId, bId, aSide } = opts;
    const bSide = aSide === 'player' ? 'enemy' : 'player';
    const order = opts.first === 'a' ? [aId, bId] : [bId, aId];
    const speeds = opts.speeds ?? { a: 50, b: 50 };
    const snap = (speed: number) =>
        ({ speed }) as unknown as NonNullable<
            BattleResult['combatLog'][0]['turns'][0]['statsSnapshot']
        >;
    return {
        rounds: [
            {
                round: 1,
                ships: [state(aId, aSide, 10), state(bId, bSide, 20)],
                turnOrder: order,
            },
        ],
        outcome: { winner: opts.winner ?? (aSide === 'player' ? 'player' : 'enemy'), lastRound: 1 },
        roster: [
            { actorId: aId, side: aSide, name: 'A', position: opts.positions?.a ?? 'T1' },
            { actorId: bId, side: bSide, name: 'B', position: opts.positions?.b ?? 'T1' },
        ],
        combatLog: [
            {
                round: 1,
                startOfRound: opts.startOfRound ?? [],
                turns: order.map((id) => ({
                    actorId: id,
                    chargeBefore: 0,
                    chargeMax: 0,
                    statsSnapshot: snap(id === aId ? speeds.a : speeds.b),
                    entries: [attack(id, id === aId ? bId : aId, id === aId ? 20 : 10)],
                })),
                endOfRound: [],
            },
        ],
    };
}

const ORIGINAL = { aId: 'attacker', bId: 'e:b:0', aSide: 'player' as const };
const SWAPPED = { aId: 'e:a:0', bId: 'attacker', aSide: 'enemy' as const };

describe('sideMirror — id pairing', () => {
    it('maps every swapped-arm id to the same ship’s original-arm id', () => {
        const map = mirrorIdMap(input1v1());
        expect(map.get('attacker')).toBe('e:b:0');
        expect(map.get('e:a:0')).toBe('attacker');
    });

    it('remaps a stream key’s actor-id prefix, longest id first, and leaves other keys alone', () => {
        const input: BattleSimulationInput = {
            playerTeam: [
                { ship: fakeShip('x'), position: 'T1' },
                { ship: fakeShip('y'), position: 'T2' },
            ],
            enemyTeam: [
                { ship: fakeShip('z'), position: 'T1' },
                { ship: fakeShip('y'), position: 'T3' },
            ],
        };
        const map = mirrorIdMap(input);
        expect(remapStreamKey('attacker:active-crit', map)).toBe('e:z:0:active-crit');
        expect(remapStreamKey('e:x:0:landing', map)).toBe('attacker:landing');
        expect(remapStreamKey('p:y:1:ability-7', map)).toBe('e:y:1:ability-7');
        expect(remapStreamKey('e:y:1:proc', map)).toBe('p:y:1:proc');
        expect(remapStreamKey(':concentrate-fire-pick', map)).toBe(':concentrate-fire-pick');
    });

    it('throws when the roster does not carry the minted ids', () => {
        const bad = result({ ...ORIGINAL, first: 'a' });
        bad.roster[1].actorId = 'e:b:7';
        expect(() => labelsFromRoster(input1v1(), bad, false)).toThrow(/actor-id scheme/);
    });

    it('swaps teams and squad leaders together', () => {
        const input = {
            ...input1v1(),
            playerSquadLeader: { name: 'P' },
            enemySquadLeader: { name: 'E' },
        } as unknown as BattleSimulationInput;
        const swapped = swapSides(input);
        expect(swapped.playerTeam[0].ship.id).toBe('b');
        expect(swapped.enemyTeam[0].ship.id).toBe('a');
        expect(swapped.playerSquadLeader).toEqual({ name: 'E' });
        expect(swapped.enemySquadLeader).toEqual({ name: 'P' });
    });

    it('nudges only the named slot’s speed', () => {
        const nudged = withSpeedNudge(input1v1(), 'E0', 0.01);
        expect(nudged.enemyTeam[0].statOverrides?.speed).toBeCloseTo(50.01);
        expect(nudged.playerTeam[0].statOverrides?.speed).toBe(50);
    });
});

describe('sideMirror — compareMirror on synthetic pairs', () => {
    it('reads a relabelled-identical pair as mirrored', () => {
        const v = compareMirror(
            input1v1(),
            result({ ...ORIGINAL, first: 'a' }),
            result({ ...SWAPPED, first: 'a' })
        );
        expect(v.class).toBe('mirrored');
        expect(v.strict).toBeNull();
    });

    it('flags an entry missing from one arm as behaviour with the state still mirrored', () => {
        const swapped = result({ ...SWAPPED, first: 'a' });
        swapped.combatLog[0].turns[1].entries = [];
        const v = compareMirror(input1v1(), result({ ...ORIGINAL, first: 'a' }), swapped);
        expect(v.class).toBe('behaviour');
        expect(v.stateMirrored).toBe(true);
        expect(v.unordered?.kind).toBe('combat-log');
        expect(v.kindDiffs).toEqual([
            { label: 'E0', shipName: 'B', onlyOriginal: ['attack'], onlySwapped: [] },
        ]);
    });

    it('flags a side-dependent damage number as behaviour that changed the fight state', () => {
        const swapped = result({ ...SWAPPED, first: 'a' });
        swapped.rounds[0].ships[1].damageTaken = 21;
        const v = compareMirror(input1v1(), result({ ...ORIGINAL, first: 'a' }), swapped);
        expect(v.class).toBe('behaviour');
        expect(v.stateMirrored).toBe(false);
        expect(v.unordered).toMatchObject({ kind: 'ship-state', actors: ['E0'] });
    });

    it('reads the same entries in a side-dependent order as log-order', () => {
        const v = compareMirror(
            input1v1(),
            result({
                ...ORIGINAL,
                first: 'a',
                startOfRound: [buff('attacker', 'X'), buff('e:b:0', 'Y')],
            }),
            result({
                ...SWAPPED,
                first: 'a',
                startOfRound: [buff('attacker', 'Y'), buff('e:a:0', 'X')],
            })
        );
        expect(v.class).toBe('log-order');
        expect(v.stateMirrored).toBe(true);
        expect(v.strict).toMatchObject({ kind: 'combat-log', section: 'start-of-round' });
    });

    it('reads a flipped turn order at equal speed on the same cell as the documented speed tie', () => {
        const v = compareMirror(
            input1v1('T1', 'T1'),
            result({ ...ORIGINAL, first: 'a' }),
            result({ ...SWAPPED, first: 'b' })
        );
        expect(v.class).toBe('speed-tie');
    });

    it('does not excuse a flipped turn order when the speeds differ', () => {
        const v = compareMirror(
            input1v1('T1', 'T1'),
            result({ ...ORIGINAL, first: 'a', speeds: { a: 51, b: 50 } }),
            result({ ...SWAPPED, first: 'b', speeds: { a: 51, b: 50 } })
        );
        expect(v.class).toBe('behaviour');
    });

    it('does not excuse a flipped turn order when the cells differ', () => {
        const positions = { a: 'T1' as Position, b: 'T2' as Position };
        const v = compareMirror(
            input1v1('T1', 'T2'),
            result({ ...ORIGINAL, first: 'a', positions }),
            result({ ...SWAPPED, first: 'b', positions })
        );
        expect(v.class).toBe('behaviour');
    });

    it('exempts only the winner of a fight that reached the round cap', () => {
        const v = compareMirror(
            input1v1(),
            result({ ...ORIGINAL, first: 'a', winner: 'enemy' }),
            result({ ...SWAPPED, first: 'a', winner: 'enemy' })
        );
        expect(v.class).toBe('mirrored');
        expect(v.roundCap).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Real engine: a composition with persistent per-round stacks on both sides.
// ---------------------------------------------------------------------------

function realInput(): BattleSimulationInput {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — tests need them to resolve real ship skill text/stats.'
        );
    }
    const place = (name: string, position: Position) => {
        const ship = buildTraceShip(name);
        if (!ship) throw new Error(`${name} did not resolve from the corpus`);
        return canonicalPlacement(ship, position);
    };
    return {
        playerTeam: [
            place('Amartya', 'B4'),
            place('Xcellence', 'T4'),
            place('Ravager', 'M2'),
            place('Sentinel', 'T1'),
        ],
        enemyTeam: [
            place('Sokol', 'M1'),
            place('Nayra', 'M2'),
            place('Razi', 'T1'),
            place('Suku', 'T3'),
        ],
    };
}

describe('sideMirror — real engine', () => {
    it('pairs every draw to an actor-keyed stream', () => {
        const { stats } = runSwappedPaired(realInput(), 12);
        expect(stats).toEqual({ unkeyedDraws: 0, unmappedKeyedDraws: 0 });
    });

    it('fights the same fight from both sides when the streams are paired', () => {
        const { verdict } = runMirrorPair(realInput(), 12);
        expect(verdict.class).not.toBe('behaviour');
        expect(verdict.stateMirrored).toBe(true);
    });

    // The pairing is what makes a single seed a verdict. Without it the swapped arm draws other
    // ships' streams, and the same composition reads as a behaviour difference.
    it('diverges when the swapped arm is run without stream pairing', () => {
        const input = realInput();
        const original = runSeededBattle(input, 12);
        const unpaired = runSeededBattle(swapSides(input), 12);
        const verdict = compareMirror(input, original, unpaired);
        expect(verdict.class).toBe('behaviour');
        expect(verdict.stateMirrored).toBe(false);
    });
});
