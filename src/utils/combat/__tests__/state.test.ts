import { describe, it, expect } from 'vitest';
import {
    createActor,
    selectNextActor,
    buildTurnQueue,
    orderByTurnPriority,
    advanceChargeCadence,
    ActorStats,
    CombatActor,
    TURN_METER_THRESHOLD,
    MAX_SELECTION_TICKS,
} from '../state';

const baseStats: ActorStats = {
    attack: 10000,
    crit: 50,
    critDamage: 150,
    defensePenetration: 0,
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
        const input = [actor('attacker', 'attacker', 100), actor('t1', 'team', 140)];
        buildTurnQueue(input);
        expect(input.map((a) => a.id)).toEqual(['attacker', 't1']);
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
