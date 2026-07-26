import { describe, it, expect } from 'vitest';
import {
    createActor,
    selectNextActor,
    selectNextBySpeed,
    buildTurnQueue,
    orderByTurnPriority,
    positionTurnRank,
    advanceChargeCadence,
    ActorStats,
    CombatActor,
    TURN_METER_THRESHOLD,
    MAX_SELECTION_TICKS,
} from '../state';
import type { Position } from '../../../types/encounters';

const baseStats: ActorStats = {
    attack: 10000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 0,
    shieldPenetration: 0,
    defence: 5000,
    hp: 20000,
    speed: 0,
};

describe('createActor', () => {
    it('sets currentHp to stats.hp', () => {
        const actor = createActor({
            id: 'a',
            side: 'player',
            kind: 'attacker',
            stats: { ...baseStats, hp: 30000 },
        });
        expect(actor.currentHp).toBe(30000);
    });

    it('sets turnMeter to 0', () => {
        const actor = createActor({ id: 'a', side: 'player', kind: 'attacker', stats: baseStats });
        expect(actor.turnMeter).toBe(0);
    });

    it('initialises all DoT containers as empty arrays', () => {
        const actor = createActor({ id: 'a', side: 'enemy', kind: 'enemy', stats: baseStats });
        expect(actor.corrosionEntries).toEqual([]);
        expect(actor.infernoEntries).toEqual([]);
        expect(actor.pendingBombs).toEqual([]);
        expect(actor.pendingAccumulators).toEqual([]);
    });

    it('preserves id and side from input', () => {
        const actor = createActor({ id: 'enemy', side: 'enemy', kind: 'enemy', stats: baseStats });
        expect(actor.id).toBe('enemy');
        expect(actor.side).toBe('enemy');
    });

    it('seeds charges from chargeCount when startCharged is true', () => {
        const actor = createActor({
            id: 'a',
            side: 'player',
            kind: 'attacker',
            stats: baseStats,
            chargeCount: 3,
            startCharged: true,
        });
        expect(actor.charges).toBe(3);
        expect(actor.chargeCount).toBe(3);
    });

    it('starts with 0 charges when startCharged is false or omitted', () => {
        const actor = createActor({
            id: 'a',
            side: 'player',
            kind: 'attacker',
            stats: baseStats,
            chargeCount: 3,
        });
        expect(actor.charges).toBe(0);
    });

    it('threads raw affinity onto the actor (positional plumbing)', () => {
        const actor = createActor({
            id: 'a',
            side: 'player',
            kind: 'attacker',
            stats: baseStats,
            affinity: 'thermal',
        });
        expect(actor.affinity).toBe('thermal');
    });

    it('leaves affinity undefined when omitted (neutral default downstream)', () => {
        const actor = createActor({ id: 'a', side: 'player', kind: 'attacker', stats: baseStats });
        expect(actor.affinity).toBeUndefined();
    });
});

describe('createActor shieldPenetration (H1 Task 1)', () => {
    const baseStatsWithPen: ActorStats = {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        shieldPenetration: 0,
        defence: 0,
        hp: 1,
        speed: 50,
    };

    it('carries shieldPenetration when supplied', () => {
        const a = createActor({
            id: 'x',
            side: 'player',
            kind: 'attacker',
            stats: { ...baseStatsWithPen, shieldPenetration: 25 },
        });
        expect(a.stats.shieldPenetration).toBe(25);
    });

    // The "default to 0 when omitted" path lives at the adapter boundary
    // (engine actor builders' `?? 0`), not in createActor — which requires the
    // field and copies it through. That defaulting is covered by
    // shieldPenetration.test.ts ('… defaults shieldPenetration to 0 when omitted').
});

describe('selectNextActor', () => {
    it('selects attacker (speed 100) over enemy (speed 0) after ticks reach the threshold', () => {
        const attacker = createActor({
            id: 'attacker',
            side: 'player',
            kind: 'attacker',
            stats: { ...baseStats, speed: 100 },
        });
        const enemy = createActor({
            id: 'enemy',
            side: 'enemy',
            kind: 'enemy',
            stats: { ...baseStats, speed: 0 },
        });
        const selected = selectNextActor([attacker, enemy]);
        expect(selected.id).toBe('attacker');
        expect(attacker.turnMeter).toBe(TURN_METER_THRESHOLD);
        expect(enemy.turnMeter).toBe(0);
    });

    it('selects attacker again after resetting its meter to 0', () => {
        const attacker = createActor({
            id: 'attacker',
            side: 'player',
            kind: 'attacker',
            stats: { ...baseStats, speed: 100 },
        });
        const enemy = createActor({
            id: 'enemy',
            side: 'enemy',
            kind: 'enemy',
            stats: { ...baseStats, speed: 0 },
        });

        // First selection
        selectNextActor([attacker, enemy]);
        attacker.turnMeter = 0;

        // Second selection
        const selected = selectNextActor([attacker, enemy]);
        expect(selected.id).toBe('attacker');
        expect(attacker.turnMeter).toBe(TURN_METER_THRESHOLD);
    });

    it('selects actor with highest meter when multiple are eligible', () => {
        const fast = createActor({
            id: 'fast',
            side: 'player',
            kind: 'attacker',
            stats: { ...baseStats, speed: 200 },
        });
        const slow = createActor({
            id: 'slow',
            side: 'player',
            kind: 'attacker',
            stats: { ...baseStats, speed: 100 },
        });
        const selected = selectNextActor([fast, slow]);
        expect(selected.id).toBe('fast');
    });

    it('throws (not hangs) when every actor has speed 0', () => {
        const a = createActor({
            id: 'a',
            side: 'player',
            kind: 'attacker',
            stats: { ...baseStats, speed: 0 },
        });
        const b = createActor({
            id: 'b',
            side: 'enemy',
            kind: 'enemy',
            stats: { ...baseStats, speed: 0 },
        });
        expect(() => selectNextActor([a, b])).toThrow(new RegExp(`${MAX_SELECTION_TICKS} ticks`));
    });

    it('fails fast on an empty actor list', () => {
        expect(() => selectNextActor([])).toThrow(/must not be empty/);
    });
});

describe('buildTurnQueue', () => {
    const actor = (id: string, kind: CombatActor['kind'], speed: number): CombatActor =>
        createActor({
            id,
            side: kind === 'enemy' ? 'enemy' : 'player',
            kind,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                shieldPenetration: 0,
                defence: 0,
                hp: 1,
                speed,
            },
        });

    it('orders by speed descending', () => {
        const q = buildTurnQueue([
            actor('attacker', 'attacker', 100),
            actor('t1', 'team', 140),
            actor('enemy', 'enemy', 120),
        ]);
        expect(q.map((a) => a.id)).toEqual(['t1', 'enemy', 'attacker']);
    });

    it('breaks ties: player side before enemy, then input order (team before attacker by list position)', () => {
        const q = buildTurnQueue([
            actor('t1', 'team', 100),
            actor('t2', 'team', 100),
            actor('attacker', 'attacker', 100),
            actor('enemy', 'enemy', 100),
        ]);
        expect(q.map((a) => a.id)).toEqual(['t1', 't2', 'attacker', 'enemy']);
    });

    it('default speeds (team 100, attacker 100, enemy 50) yield team → attacker → enemy', () => {
        const q = buildTurnQueue([
            actor('t1', 'team', 100),
            actor('attacker', 'attacker', 100),
            actor('enemy', 'enemy', 50),
        ]);
        expect(q.map((a) => a.id)).toEqual(['t1', 'attacker', 'enemy']);
    });

    it('does not mutate the input array', () => {
        const input = [actor('attacker', 'attacker', 140), actor('t1', 'team', 100)];
        buildTurnQueue(input);
        expect(input.map((a) => a.id)).toEqual(['attacker', 't1']);
    });

    // ── Board-position tiebreak (the game's rule: speed → position → team) ──────────────
    const positioned = (id: string, side: CombatActor['side'], speed: number, position: Position) =>
        createActor({
            id,
            side,
            kind: side === 'enemy' ? 'enemy' : 'team',
            position,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                shieldPenetration: 0,
                defence: 0,
                hp: 1,
                speed,
            },
        });

    it('positionTurnRank: TOP row outranks MID outranks BOTTOM, lowest column first', () => {
        // "furthest to the top back wins" — T1 is the single highest-priority cell.
        const cells: Position[] = ['T1', 'T4', 'M1', 'M4', 'B1', 'B4'];
        const ranks = cells.map(positionTurnRank);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b)); // already in priority order
        expect(positionTurnRank('T4')).toBeLessThan(positionTurnRank('M1')); // whole row wins
        expect(positionTurnRank('M4')).toBeLessThan(positionTurnRank('B1'));
        expect(positionTurnRank(undefined)).toBe(Number.POSITIVE_INFINITY); // ranks last
    });

    it('breaks an equal-speed tie by POSITION, not roster order — even within one team', () => {
        // Listed back-to-front on purpose: roster order would give b4 → m2 → t3.
        const q = buildTurnQueue([
            positioned('b4', 'player', 100, 'B4'),
            positioned('m2', 'player', 100, 'M2'),
            positioned('t3', 'player', 100, 'T3'),
        ]);
        expect(q.map((a) => a.id)).toEqual(['t3', 'm2', 'b4']);
    });

    it('interleaves the two sides per equal-speed group (a tie is not a whole-team win)', () => {
        // Two speed groups: the 120s tie on position (T2 beats M1), the 100s likewise.
        const q = buildTurnQueue([
            positioned('p-slow', 'player', 100, 'M1'),
            positioned('p-fast', 'player', 120, 'M1'),
            positioned('e-slow', 'enemy', 100, 'T2'),
            positioned('e-fast', 'enemy', 120, 'T2'),
        ]);
        expect(q.map((a) => a.id)).toEqual(['e-fast', 'p-fast', 'e-slow', 'p-slow']);
    });

    it('falls through to the side rank only when speed AND position both tie', () => {
        const q = buildTurnQueue([
            positioned('enemy-t1', 'enemy', 100, 'T1'),
            positioned('player-t1', 'player', 100, 'T1'),
        ]);
        expect(q.map((a) => a.id)).toEqual(['player-t1', 'enemy-t1']);
    });

    it('a position-less actor ranks LAST within its speed group', () => {
        const q = buildTurnQueue([
            actor('dummy', 'enemy', 100), // no position (DPS sink)
            positioned('b4', 'player', 100, 'B4'),
        ]);
        expect(q.map((a) => a.id)).toEqual(['b4', 'dummy']);
    });
});

describe('selectNextBySpeed', () => {
    const actor = (id: string, kind: CombatActor['kind'], speed: number): CombatActor =>
        createActor({
            id,
            side: kind === 'enemy' ? 'enemy' : 'player',
            kind,
            stats: { ...baseStats, hp: 1, speed },
        });

    const allPending = () => 1;

    it('picks the actor with the highest effective speed', () => {
        const actors = [
            actor('attacker', 'attacker', 100),
            actor('t1', 'team', 140),
            actor('enemy', 'enemy', 120),
        ];
        const next = selectNextBySpeed(actors, allPending, (a) => a.stats.speed);
        expect(next?.id).toBe('t1');
    });

    it('excludes actors whose pending count is 0', () => {
        const actors = [actor('t1', 'team', 140), actor('attacker', 'attacker', 100)];
        const next = selectNextBySpeed(
            actors,
            (id) => (id === 't1' ? 0 : 1),
            (a) => a.stats.speed
        );
        expect(next?.id).toBe('attacker');
    });

    it('breaks ties: player side before enemy', () => {
        const actors = [actor('enemy', 'enemy', 100), actor('attacker', 'attacker', 100)];
        const next = selectNextBySpeed(actors, allPending, (a) => a.stats.speed);
        expect(next?.id).toBe('attacker');
    });

    it('breaks ties within a side by input order', () => {
        const actors = [actor('t1', 'team', 100), actor('t2', 'team', 100)];
        const next = selectNextBySpeed(actors, allPending, (a) => a.stats.speed);
        expect(next?.id).toBe('t1');
    });

    it('uses the effectiveSpeedOf callback, not static actor.stats.speed', () => {
        // Static speed ranks t1 (140) > attacker (100), but the live callback inverts it.
        const actors = [actor('t1', 'team', 140), actor('attacker', 'attacker', 100)];
        const liveSpeed = (a: CombatActor) => (a.id === 'attacker' ? 999 : a.stats.speed);
        const next = selectNextBySpeed(actors, allPending, liveSpeed);
        expect(next?.id).toBe('attacker');
    });

    it('returns undefined when no actors have pending > 0', () => {
        const actors = [actor('t1', 'team', 140), actor('enemy', 'enemy', 120)];
        expect(
            selectNextBySpeed(
                actors,
                () => 0,
                (a) => a.stats.speed
            )
        ).toBeUndefined();
    });

    it('returns undefined for an empty actor list', () => {
        expect(selectNextBySpeed([], allPending, (a) => a.stats.speed)).toBeUndefined();
    });
});

describe('advanceChargeCadence', () => {
    const actorWith = (charges: number, chargeCount: number): CombatActor => {
        const a = createActor({
            id: 'a',
            side: 'player',
            kind: 'attacker',
            stats: { ...baseStats, hp: 1 },
            chargeCount,
        });
        a.charges = charges;
        return a;
    };

    it('increments charges when below cap', () => {
        const a = actorWith(1, 3);
        advanceChargeCadence(a, true);
        expect(a.charges).toBe(2);
    });

    it('resets charges to 0 when at cap', () => {
        const a = actorWith(3, 3);
        advanceChargeCadence(a, true);
        expect(a.charges).toBe(0);
    });

    it('is a no-op when hasChargedSkill is false', () => {
        const a = actorWith(2, 3);
        advanceChargeCadence(a, false);
        expect(a.charges).toBe(2);
    });

    it('is a no-op when chargeCount is 0 (belt-and-suspenders)', () => {
        const a = actorWith(0, 0);
        advanceChargeCadence(a, true);
        expect(a.charges).toBe(0);
    });
});

describe('orderByTurnPriority', () => {
    it('orders generic entries by speed descending', () => {
        const ordered = orderByTurnPriority([
            { name: 'Attacker', speed: 100, side: 'player' as const },
            { name: 'Grif', speed: 140, side: 'player' as const },
            { name: 'Enemy', speed: 120, side: 'enemy' as const },
        ]);
        expect(ordered.map((o) => o.name)).toEqual(['Grif', 'Enemy', 'Attacker']);
    });

    it('breaks ties: team before attacker (input order), player before enemy', () => {
        const ordered = orderByTurnPriority([
            { name: 'Grif', speed: 100, side: 'player' as const },
            { name: 'Thresh', speed: 100, side: 'player' as const },
            { name: 'Attacker', speed: 100, side: 'player' as const },
            { name: 'Enemy', speed: 100, side: 'enemy' as const },
        ]);
        expect(ordered.map((o) => o.name)).toEqual(['Grif', 'Thresh', 'Attacker', 'Enemy']);
    });

    it('does not mutate the input array', () => {
        const input = [
            { name: 'Attacker', speed: 100, side: 'player' as const },
            { name: 'Grif', speed: 140, side: 'player' as const },
        ];
        orderByTurnPriority(input);
        expect(input.map((o) => o.name)).toEqual(['Attacker', 'Grif']);
    });
});
