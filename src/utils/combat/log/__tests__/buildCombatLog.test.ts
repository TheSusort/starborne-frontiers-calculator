import { describe, expect, it } from 'vitest';
import { CombatEvent } from '../../events';
import { buildCombatLog } from '../buildCombatLog';

/** Minimal roster entry shape used by the builder */
interface RosterEntry {
    actorId: string;
    side: 'player' | 'enemy';
    name: string;
}

/** Helper to build typed CombatEvent fixtures */
function ev<T extends CombatEvent>(partial: T): T {
    return partial;
}

const roster: RosterEntry[] = [
    { actorId: 'A', side: 'player', name: 'Alpha' },
    { actorId: 'B', side: 'enemy', name: 'Beta' },
];

const initialCharge = new Map<string, { charge: number; max: number }>();

describe('buildCombatLog', () => {
    it('groups events into rounds and turns with a single-target attack entry', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 1000,
                didCrit: true,
                critHits: 1,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 1000,
                didCrit: true,
                isPrimaryTarget: true,
            }),
            ev({ type: 'hp-changed', targetId: 'B', round: 1, oldPct: 100, newPct: 60 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        expect(log).toHaveLength(1);
        const turn = log[0].turns[0];
        expect(turn.actorId).toBe('A');
        const entry = turn.entries[0];
        expect(entry.kind).toBe('attack');
        expect(entry.targets).toEqual([
            expect.objectContaining({
                targetId: 'B',
                amount: 1000,
                didCrit: true,
                resultingHpPct: 60,
            }),
        ]);
    });

    it('filters out turn-started events for actors not in roster', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'unknown-actor', round: 1 }),
            ev({ type: 'turn-ended', actorId: 'unknown-actor', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        expect(log).toHaveLength(1);
        expect(log[0].turns).toHaveLength(1);
        expect(log[0].turns[0].actorId).toBe('A');
    });

    it('handles multiple rounds', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
            ev({ type: 'round-started', round: 2 }),
            ev({ type: 'turn-started', actorId: 'B', round: 2 }),
            ev({ type: 'turn-ended', actorId: 'B', round: 2 }),
            ev({ type: 'round-ended', round: 2 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        expect(log).toHaveLength(2);
        expect(log[0].round).toBe(1);
        expect(log[0].turns[0].actorId).toBe('A');
        expect(log[1].round).toBe(2);
        expect(log[1].turns[0].actorId).toBe('B');
    });

    it('unknown event types are silently ignored (no-op)', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            // buff-applied has no handler yet — should not throw
            ev({ type: 'buff-applied', actorId: 'A', round: 1, buffName: 'Inspire', duration: 2 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        expect(() => buildCombatLog(events, roster, initialCharge)).not.toThrow();
        const log = buildCombatLog(events, roster, initialCharge);
        expect(log[0].turns[0].entries).toHaveLength(0);
    });

    it('hp-changed stamps resultingHpPct onto matching target without creating a standalone entry', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 500,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 500,
                isPrimaryTarget: true,
            }),
            ev({ type: 'hp-changed', targetId: 'B', round: 1, oldPct: 80, newPct: 55 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const turn = log[0].turns[0];
        expect(turn.entries).toHaveLength(1);
        expect(turn.entries[0].targets[0].resultingHpPct).toBe(55);
    });

    it('sets chargeBefore and chargeMax to 0 (placeholder for later task)', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const turn = log[0].turns[0];
        expect(turn.chargeBefore).toBe(0);
        expect(turn.chargeMax).toBe(0);
    });
});
