import { describe, it, expect } from 'vitest';
import { createActor, selectNextActor, ActorStats } from '../state';

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
        const actor = createActor({ id: 'a', side: 'player', stats: { ...baseStats, hp: 30000 } });
        expect(actor.currentHp).toBe(30000);
    });

    it('sets turnMeter to 0', () => {
        const actor = createActor({ id: 'a', side: 'player', stats: baseStats });
        expect(actor.turnMeter).toBe(0);
    });

    it('initialises all DoT containers as empty arrays', () => {
        const actor = createActor({ id: 'a', side: 'enemy', stats: baseStats });
        expect(actor.corrosionEntries).toEqual([]);
        expect(actor.infernoEntries).toEqual([]);
        expect(actor.pendingBombs).toEqual([]);
        expect(actor.pendingAccumulators).toEqual([]);
    });

    it('preserves id and side from input', () => {
        const actor = createActor({ id: 'enemy', side: 'enemy', stats: baseStats });
        expect(actor.id).toBe('enemy');
        expect(actor.side).toBe('enemy');
    });
});

describe('selectNextActor', () => {
    it('selects attacker (speed 100) over enemy (speed 0) after ticks reach 1000', () => {
        const attacker = createActor({
            id: 'attacker',
            side: 'player',
            stats: { ...baseStats, speed: 100 },
        });
        const enemy = createActor({
            id: 'enemy',
            side: 'enemy',
            stats: { ...baseStats, speed: 0 },
        });
        const selected = selectNextActor([attacker, enemy]);
        expect(selected.id).toBe('attacker');
        expect(attacker.turnMeter).toBe(1000);
        expect(enemy.turnMeter).toBe(0);
    });

    it('selects attacker again after resetting its meter to 0', () => {
        const attacker = createActor({
            id: 'attacker',
            side: 'player',
            stats: { ...baseStats, speed: 100 },
        });
        const enemy = createActor({
            id: 'enemy',
            side: 'enemy',
            stats: { ...baseStats, speed: 0 },
        });

        // First selection
        selectNextActor([attacker, enemy]);
        attacker.turnMeter = 0;

        // Second selection
        const selected = selectNextActor([attacker, enemy]);
        expect(selected.id).toBe('attacker');
        expect(attacker.turnMeter).toBe(1000);
    });

    it('selects actor with highest meter when multiple are eligible', () => {
        const fast = createActor({
            id: 'fast',
            side: 'player',
            stats: { ...baseStats, speed: 200 },
        });
        const slow = createActor({
            id: 'slow',
            side: 'player',
            stats: { ...baseStats, speed: 100 },
        });
        const selected = selectNextActor([fast, slow]);
        expect(selected.id).toBe('fast');
    });

    it('throws (not hangs) when every actor has speed 0', () => {
        const a = createActor({ id: 'a', side: 'player', stats: { ...baseStats, speed: 0 } });
        const b = createActor({ id: 'b', side: 'enemy', stats: { ...baseStats, speed: 0 } });
        expect(() => selectNextActor([a, b])).toThrow(/10000 ticks/);
    });
});
