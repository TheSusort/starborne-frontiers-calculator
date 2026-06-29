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

    // ─── Extra foundation-coverage tests ──────────────────────────────────────

    it('attacked with no open attack entry is silently dropped (no throw, no target)', () => {
        // No ability-performed before the attacked event — should not throw.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 500,
                isPrimaryTarget: true,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        expect(() => buildCombatLog(events, roster, initialCharge)).not.toThrow();
        const log = buildCombatLog(events, roster, initialCharge);
        // No entries because there was no ability-performed to open an attack entry.
        expect(log[0].turns[0].entries).toHaveLength(0);
    });

    it('two separate attacks on the same target in one turn — hp-changed stamps the most-recent entry', () => {
        // Attack 1: A → B (hp-changed: 80→60). Attack 2: A → B again (hp-changed: 60→40).
        // The second hp-changed should stamp the second entry's target, not the first.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            // First attack
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 300,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 300,
                isPrimaryTarget: true,
            }),
            ev({ type: 'hp-changed', targetId: 'B', round: 1, oldPct: 80, newPct: 60 }),
            // Second attack
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 200,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 200,
                isPrimaryTarget: true,
            }),
            ev({ type: 'hp-changed', targetId: 'B', round: 1, oldPct: 60, newPct: 40 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(2);
        // First attack stamped with 60, second with 40.
        expect(entries[0].targets[0].resultingHpPct).toBe(60);
        expect(entries[1].targets[0].resultingHpPct).toBe(40);
    });

    // ─── Behavior 1: AoE fan-out ───────────────────────────────────────────────

    it('AoE attack: primary (isPrimaryTarget) gets ability-performed damage, splash gets attacked.damage', () => {
        // ability-performed targets B (focus/primary), damage 1000.
        // attacked B (isPrimaryTarget: true, damage 1000).
        // attacked C (isPrimaryTarget: false, damage 500).
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
                isPrimaryTarget: true,
                didCrit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'C',
                round: 1,
                damage: 500,
                isPrimaryTarget: false,
                didCrit: false,
                shieldWasHit: false,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        // C is not in the base roster, but that's fine — it just means no turn opened for C.
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.kind).toBe('attack');
        expect(entry.targets).toHaveLength(2);

        const targetB = entry.targets.find((t) => t.targetId === 'B');
        const targetC = entry.targets.find((t) => t.targetId === 'C');

        expect(targetB).toBeDefined();
        expect(targetB!.amount).toBe(1000); // from ability-performed.damage
        expect(targetB!.didCrit).toBe(true);
        expect(targetB!.didHit).toBe(true);

        expect(targetC).toBeDefined();
        expect(targetC!.amount).toBe(500); // from attacked.damage (splash)
        expect(targetC!.didCrit).toBe(false);
        expect(targetC!.didHit).toBe(true);
    });

    // ─── Behavior 2: Multi-hit single-target dedup ────────────────────────────

    it('multi-hit on same target: exactly one target entry, amount not summed, didCrit ORed', () => {
        // Three attacked events for B with identical damage: 1000 each.
        // Should produce ONE target entry for B with amount 1000 (not 3000).
        // didCrit = true if any hit critted (third hit crits).
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
                didHit: true,
            }),
            // Hit 1 — no crit
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 1000,
                isPrimaryTarget: true,
                didCrit: false,
            }),
            // Hit 2 — no crit
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 1000,
                isPrimaryTarget: true,
                didCrit: false,
            }),
            // Hit 3 — crits
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 1000,
                isPrimaryTarget: true,
                didCrit: true,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        // Only ONE target entry for B.
        expect(entry.targets).toHaveLength(1);
        const targetB = entry.targets[0];
        expect(targetB.targetId).toBe('B');
        expect(targetB.amount).toBe(1000); // NOT 3000
        expect(targetB.didCrit).toBe(true); // any-hit OR
        expect(targetB.didHit).toBe(true);
    });

    // ─── Behavior 3: Full miss synthesis ──────────────────────────────────────

    it('full miss: synthesizes a single miss target from ability-performed when no attacked events follow', () => {
        // ability-performed with didHit: false, no attacked events.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                didHit: false,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.kind).toBe('attack');
        expect(entry.targets).toHaveLength(1);
        const target = entry.targets[0];
        expect(target.targetId).toBe('B');
        expect(target.didHit).toBe(false);
        expect(target.amount).toBeUndefined();
    });

    it('full miss synthesis fires even when miss is the last entry before round-ended (no turn-ended)', () => {
        // Edge case: stream ends without an explicit turn-ended (round-ended closes things).
        // Verify miss synthesis still fires.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                didHit: false,
            }),
            // No turn-ended — stream closes with round-ended only.
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.targets).toHaveLength(1);
        expect(entry.targets[0].didHit).toBe(false);
        expect(entry.targets[0].targetId).toBe('B');
    });

    // ─── Fix 2: shieldWasHit OR-accumulation on multi-hit ────────────────────

    it('multi-hit shield-break: shieldWasHit is true if ANY hit hit a shield', () => {
        // Hit 1: shieldWasHit false. Hit 2: shieldWasHit true.
        // The single deduped target entry should have shieldWasHit === true.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 800,
                didHit: true,
            }),
            // Hit 1 — shield not hit
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 800,
                isPrimaryTarget: true,
                didCrit: false,
                shieldWasHit: false,
            }),
            // Hit 2 — shield broken this hit
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 800,
                isPrimaryTarget: true,
                didCrit: false,
                shieldWasHit: true,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.targets).toHaveLength(1);
        expect(entry.targets[0].shieldWasHit).toBe(true);
    });

    // ─── Fix 1: mid-turn finalizeMissEntry + no state bleed ──────────────────

    it('miss-then-real-attack same turn: two entries, first synthesized miss, second real hit', () => {
        // ability-performed(B, didHit:false) with no attacked → miss entry for B.
        // Then ability-performed(C, damage 500, didHit:true) + attacked(C, 500, primary).
        // Turn should have 2 entries: miss for B and real hit for C.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            // First ability — misses B entirely (no attacked follows)
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                didHit: false,
            }),
            // Second ability — hits C (ability-performed replaces open entry; miss for B finalized first)
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'C',
                round: 1,
                abilityType: 'damage',
                damage: 500,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'C',
                round: 1,
                damage: 500,
                isPrimaryTarget: true,
                didCrit: false,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(2);

        // First entry: synthesized miss targeting B
        expect(entries[0].targets).toHaveLength(1);
        expect(entries[0].targets[0].targetId).toBe('B');
        expect(entries[0].targets[0].didHit).toBe(false);
        expect(entries[0].targets[0].amount).toBeUndefined();

        // Second entry: real hit on C with amount 500
        expect(entries[1].targets).toHaveLength(1);
        expect(entries[1].targets[0].targetId).toBe('C');
        expect(entries[1].targets[0].didHit).toBe(true);
        expect(entries[1].targets[0].amount).toBe(500);
    });

    // ─── Fix 1 guard: undefined didHit must NOT synthesize a miss ────────────

    it('undefined didHit does not synthesize a miss target (strict === false guard)', () => {
        // ability-performed with no didHit field at all (undefined), no attacked events.
        // The open attack entry should have zero targets — no miss is synthesized.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                // didHit intentionally omitted — undefined at runtime
            } as CombatEvent),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.targets).toHaveLength(0);
    });
});
