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
            // unknown-event-type has no handler — should not throw and produce no entry
            ev({ type: 'unknown-event-type', actorId: 'A', round: 1 } as unknown as CombatEvent),
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

    it('stamps equal-percent hp-changed events from fully absorbed hits', () => {
        // The engine intentionally emits hp-changed even when oldPct === newPct (a fully
        // shield-absorbed hit), so the builder must still match it onto the open target
        // rather than dropping it or spawning a standalone entry.
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
            ev({ type: 'hp-changed', targetId: 'B', round: 1, oldPct: 80, newPct: 80 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const turn = log[0].turns[0];
        expect(turn.entries).toHaveLength(1);
        expect(turn.entries[0].targets[0].resultingHpPct).toBe(80);
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
        // No miss is synthesized (strict === false guard) — and since the entry then has
        // zero targets and was not a miss, Task 4's phantom-row suppression removes it
        // entirely (a bug that loosely treated undefined as a miss would instead leave a
        // synthesized-miss entry behind, which would NOT be pruned).
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
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        expect(log[0].turns[0].entries).toHaveLength(0);
    });

    // ─── Behavior 1: Charge header reconstruction ─────────────────────────────

    it('chargeBefore is seeded from initialCharge and read at turn-started (before later charge-changed)', () => {
        // Actor A seeded {charge:1, max:3}.
        // turn-started A fires first — chargeBefore should be 1.
        // charge-changed A (old:1, new:2, reason:'gen') fires AFTER turn-started — must NOT change chargeBefore.
        const ic = new Map([['A', { charge: 1, max: 3 }]]);
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'charge-changed',
                actorId: 'A',
                round: 1,
                oldCharge: 1,
                newCharge: 2,
                reason: 'gen',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, ic);
        const turn = log[0].turns[0];
        expect(turn.chargeBefore).toBe(1);
        expect(turn.chargeMax).toBe(3);
    });

    it('actor seeded with charge:0, max:0 → chargeMax is 0', () => {
        const ic = new Map([['A', { charge: 0, max: 0 }]]);
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, ic);
        const turn = log[0].turns[0];
        expect(turn.chargeBefore).toBe(0);
        expect(turn.chargeMax).toBe(0);
    });

    it('actor NOT in initialCharge → chargeBefore 0, chargeMax 0 (no throw)', () => {
        // Empty initialCharge map — actor A not present.
        const ic = new Map<string, { charge: number; max: number }>();
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        expect(() => buildCombatLog(events, roster, ic)).not.toThrow();
        const log = buildCombatLog(events, roster, ic);
        const turn = log[0].turns[0];
        expect(turn.chargeBefore).toBe(0);
        expect(turn.chargeMax).toBe(0);
    });

    it('running charge accumulates across turns (second turn sees updated charge)', () => {
        // Round 1: A turn → charge-changed(1→2). Round 2: A turn → chargeBefore should be 2.
        const ic = new Map([['A', { charge: 1, max: 3 }]]);
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'charge-changed',
                actorId: 'A',
                round: 1,
                oldCharge: 1,
                newCharge: 2,
                reason: 'gen',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
            ev({ type: 'round-started', round: 2 }),
            ev({ type: 'turn-started', actorId: 'A', round: 2 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 2 }),
            ev({ type: 'round-ended', round: 2 }),
        ];
        const log = buildCombatLog(events, roster, ic);
        expect(log[0].turns[0].chargeBefore).toBe(1);
        expect(log[1].turns[0].chargeBefore).toBe(2);
    });

    // ─── Behavior 2: charge-changed log entry ────────────────────────────────

    it('charge-changed with reason gen produces an entry with note "charge 1→2"', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'charge-changed',
                actorId: 'A',
                round: 1,
                oldCharge: 1,
                newCharge: 2,
                reason: 'gen',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        const chargeEntry = entries.find((e) => e.kind === 'charge-changed');
        expect(chargeEntry).toBeDefined();
        expect(chargeEntry!.actorId).toBe('A');
        expect(chargeEntry!.note).toBe('charge 1→2');
        expect(chargeEntry!.targets).toEqual([]);
        expect(chargeEntry!.reactions).toEqual([]);
    });

    it('charge-changed with reason cast-reset produces note "charge reset (2→0)"', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'charge-changed',
                actorId: 'A',
                round: 1,
                oldCharge: 2,
                newCharge: 0,
                reason: 'cast-reset',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const chargeEntry = log[0].turns[0].entries.find((e) => e.kind === 'charge-changed');
        expect(chargeEntry).toBeDefined();
        expect(chargeEntry!.note).toBe('charge reset (2→0)');
    });

    it('charge-changed with reason manip produces note containing "manip" and "1→2"', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'charge-changed',
                actorId: 'A',
                round: 1,
                oldCharge: 1,
                newCharge: 2,
                reason: 'manip',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const chargeEntry = log[0].turns[0].entries.find((e) => e.kind === 'charge-changed');
        expect(chargeEntry).toBeDefined();
        expect(chargeEntry!.note).toContain('manip');
        expect(chargeEntry!.note).toContain('1→2');
    });

    // ─── Behavior 3: skill-fired correlation ─────────────────────────────────

    it('skill-fired then ability-performed → attack entry has skillName and slot stamped', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'skill-fired',
                actorId: 'A',
                round: 1,
                slot: 'charged',
                skillName: 'Devastation',
            }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 1000,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 1000,
                isPrimaryTarget: true,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.kind).toBe('attack');
        expect(entry.skillName).toBe('Devastation');
        expect(entry.slot).toBe('charged');
    });

    it('no skill-fired before ability-performed → entry skillName and slot are undefined', () => {
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
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.skillName).toBeUndefined();
        expect(entry.slot).toBeUndefined();
    });

    // ─── Fix 4: pre-turn-started charge-changed IS included in chargeBefore ───

    it('charge-changed immediately before turn-started is included in chargeBefore', () => {
        // Actor A seeded {charge:1, max:3}.
        // charge-changed(A, old:1→new:2) fires BEFORE turn-started(A).
        // chargeBefore should be 2 (the pre-turn change folded into runningCharge before openTurn).
        const ic = new Map([['A', { charge: 1, max: 3 }]]);
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({
                type: 'charge-changed',
                actorId: 'A',
                round: 1,
                oldCharge: 1,
                newCharge: 2,
                reason: 'gen',
            }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, ic);
        const turn = log[0].turns[0];
        // Pre-turn-started change IS included: chargeBefore reflects the updated runningCharge.
        expect(turn.chargeBefore).toBe(2);
        expect(turn.chargeMax).toBe(3);
    });

    it('skill-fired in turn A does not stamp an entry in turn B', () => {
        // skill-fired fires in turn A (no ability-performed follows in that turn).
        // Turn B has ability-performed — it should NOT pick up turn A's pending skill.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'skill-fired',
                actorId: 'A',
                round: 1,
                slot: 'active',
                skillName: 'Strike',
            }),
            // No ability-performed for A — pending should be cleared at turn boundary.
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'turn-started', actorId: 'B', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'B',
                targetId: 'A',
                round: 1,
                abilityType: 'damage',
                damage: 200,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'B',
                targetId: 'A',
                round: 1,
                damage: 200,
                isPrimaryTarget: true,
            }),
            ev({ type: 'turn-ended', actorId: 'B', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const turnB = log[0].turns[1];
        expect(turnB.actorId).toBe('B');
        const entry = turnB.entries[0];
        expect(entry.skillName).toBeUndefined();
        expect(entry.slot).toBeUndefined();
    });

    // ─── Effect event handlers ────────────────────────────────────────────────

    it('heal-performed: perTarget fan-out produces one target per recipient with amount', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'heal-performed',
                casterId: 'A',
                targets: ['B', 'C'],
                round: 1,
                amount: 450,
                perTarget: [
                    { targetId: 'B', amount: 300, didCrit: true },
                    { targetId: 'C', amount: 150 },
                ],
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.kind).toBe('heal');
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toHaveLength(2);
        const targetB = entry.targets.find((t) => t.targetId === 'B');
        const targetC = entry.targets.find((t) => t.targetId === 'C');
        expect(targetB).toBeDefined();
        expect(targetB!.amount).toBe(300);
        expect(targetB!.didCrit).toBe(true);
        expect(targetC).toBeDefined();
        expect(targetC!.amount).toBe(150);
        expect(targetC!.didCrit).toBeUndefined();
    });

    it('heal-performed: skill-fired stamps skillName and slot on heal entry', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'skill-fired',
                actorId: 'A',
                round: 1,
                slot: 'active',
                skillName: 'Restore',
            }),
            ev({
                type: 'heal-performed',
                casterId: 'A',
                targets: ['B'],
                round: 1,
                amount: 200,
                perTarget: [{ targetId: 'B', amount: 200 }],
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.kind).toBe('heal');
        expect(entry.skillName).toBe('Restore');
        expect(entry.slot).toBe('active');
    });

    it('heal-performed: falls back gracefully when perTarget is absent (uses targets array)', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'heal-performed',
                casterId: 'A',
                targets: ['B'],
                round: 1,
                amount: 100,
                // perTarget intentionally omitted (older/hand-crafted event)
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        expect(() => buildCombatLog(events, roster, initialCharge)).not.toThrow();
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.kind).toBe('heal');
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toHaveLength(1);
        expect(entry.targets[0].targetId).toBe('B');
    });

    it('shield-applied: perTarget fan-out produces one target per recipient with amount', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'shield-applied',
                granterId: 'A',
                recipientIds: ['B', 'C'],
                round: 1,
                amount: 800,
                perTarget: [
                    { targetId: 'B', amount: 500 },
                    { targetId: 'C', amount: 300 },
                ],
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.kind).toBe('shield');
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toHaveLength(2);
        const targetB = entry.targets.find((t) => t.targetId === 'B');
        const targetC = entry.targets.find((t) => t.targetId === 'C');
        expect(targetB!.amount).toBe(500);
        expect(targetC!.amount).toBe(300);
    });

    it('shield-applied: falls back to recipientIds when perTarget is absent', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'shield-applied',
                granterId: 'A',
                recipientIds: ['B'],
                round: 1,
                amount: 400,
                // perTarget intentionally omitted
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        expect(() => buildCombatLog(events, roster, initialCharge)).not.toThrow();
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.kind).toBe('shield');
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toHaveLength(1);
        expect(entry.targets[0].targetId).toBe('B');
    });

    it('buff-applied: self-buff — actorId is the granter (same as receiver), recipient in targets', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'buff-applied',
                actorId: 'A',
                granterId: 'A',
                round: 1,
                buffName: 'Inspire',
                duration: 2,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.kind).toBe('buff');
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toEqual([{ targetId: 'A' }]);
        expect(entry.note).toBe('Inspire');
    });

    it('buff-applied: ally grant — actorId is the GRANTER, not the receiver; receiver is the target', () => {
        // The defect this whole change exists for: pre-change this entry booked to 'B' (the
        // receiver), so a ship whose kit only ever buffs OTHERS produced no entries of its own
        // and read as dead in an actor-scoped fingerprint.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'buff-applied',
                actorId: 'B',
                granterId: 'A',
                round: 1,
                buffName: 'Hacking Up II',
                duration: 1,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toEqual([{ targetId: 'B' }]);
        expect(entry.note).toBe('Hacking Up II');
    });

    it('buff-applied: no granterId — falls back to the receiver (fixture compatibility)', () => {
        // granterId is optional so statusEngine unit fixtures need not restate it. An event
        // without one must behave exactly as it did before this change.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'buff-applied', actorId: 'A', round: 1, buffName: 'Inspire', duration: 2 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toEqual([{ targetId: 'A' }]);
    });

    it('debuff-applied: actorId is sourceId (the INFLICTER), not the victim; target contains victim', () => {
        // Correctness point: debuff actor = inflicter, NOT victim.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'debuff-applied',
                sourceId: 'A',
                targetId: 'B',
                round: 1,
                buffName: 'Defense Shred',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.kind).toBe('debuff');
        expect(entry.actorId).toBe('A'); // inflicter, NOT 'B'
        expect(entry.targets).toHaveLength(1);
        expect(entry.targets[0].targetId).toBe('B');
        expect(entry.note).toBe('Defense Shred');
    });

    it('dot-applied: sourceId → actorId (inflicter), targetId → targets, note has dotType + tier', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'dot-applied',
                sourceId: 'A',
                targetId: 'B',
                round: 1,
                dotType: 'corrosion',
                stacks: 2,
                tier: 6, // Corrosion II magnitude → 'II'
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.kind).toBe('dot-applied');
        expect(entry.actorId).toBe('A'); // sourceId, inflicter
        expect(entry.targets).toHaveLength(1);
        expect(entry.targets[0].targetId).toBe('B');
        expect(entry.note).toBe('corrosion II ×2');
    });

    it('dot-applied: bomb carries no tier numeral (untiered display)', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'dot-applied',
                sourceId: 'A',
                targetId: 'B',
                round: 1,
                dotType: 'bomb',
                stacks: 1,
                tier: 200,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.note).toBe('bomb ×1');
    });

    it('dot-ticked: targetId is both the actorId and target; amount is the damage; note is "{dotType} ×{stacks}"; no skill consumed', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            // skill-fired before dot-ticked — should NOT be consumed (dot-ticked is not a cast)
            ev({
                type: 'skill-fired',
                actorId: 'A',
                round: 1,
                slot: 'active',
                skillName: 'Strike',
            }),
            ev({
                type: 'dot-ticked',
                targetId: 'B',
                round: 1,
                dotType: 'corrosion',
                damage: 1234,
                stacks: 3,
                tier: 9, // Corrosion III magnitude → 'III'
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        // 2 entries: charge/skill-consumed-by-ability? No — skill-fired doesn't produce
        // an entry; dot-ticked is 1 entry + charge-changed (if any). Just 1 entry here.
        const dotEntry = entries.find((e) => e.kind === 'dot-ticked');
        expect(dotEntry).toBeDefined();
        expect(dotEntry!.actorId).toBe('B'); // ticked target is the actor
        expect(dotEntry!.targets).toHaveLength(1);
        expect(dotEntry!.targets[0].targetId).toBe('B');
        expect(dotEntry!.targets[0].amount).toBe(1234);
        expect(dotEntry!.note).toBe('corrosion III ×3');
        // skill-fired must NOT have been consumed by dot-ticked
        expect(dotEntry!.skillName).toBeUndefined();
        expect(dotEntry!.slot).toBeUndefined();
    });

    it('dot-detonated: maps to a detonation entry on the victim carrying the burst damage', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'dot-detonated', targetId: 'B', round: 1, damage: 5000 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries.find((e) => e.kind === 'detonation');
        expect(entry).toBeDefined();
        expect(entry!.actorId).toBe('B');
        expect(entry!.targets).toEqual([{ targetId: 'B', amount: 5000 }]);
        expect(entry!.note).toBe('DoT detonated');
    });

    it('bomb-detonated: maps to a bomb entry on the detonator with stacks note and total damage', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'bomb-detonated',
                actorId: 'A',
                victimId: 'B',
                round: 1,
                stacks: 3,
                damage: 9000,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries.find((e) => e.kind === 'bomb');
        expect(entry).toBeDefined();
        expect(entry!.actorId).toBe('A');
        expect(entry!.note).toBe('bombs detonated ×3');
        expect(entry!.targets[0].amount).toBe(9000);
    });

    it('control-applied: casterId → actorId, targets empty, note has effect', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'control-applied',
                casterId: 'A',
                effect: 'stasis',
                round: 1,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.kind).toBe('control');
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toEqual([]);
        expect(entry.note).toBe('stasis');
    });

    it('cleanse-performed: casterId → actorId, targets empty, note has count', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'cleanse-performed',
                casterId: 'A',
                count: 2,
                round: 1,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.kind).toBe('cleanse');
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toEqual([]);
        expect(entry.note).toContain('2');
    });

    it('purge-performed: casterId → actorId, targetId in targets, note has count', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'purge-performed',
                casterId: 'A',
                targetId: 'B',
                count: 3,
                round: 1,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.kind).toBe('purge');
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toHaveLength(1);
        expect(entry.targets[0].targetId).toBe('B');
        expect(entry.note).toContain('3');
    });

    it('ship-destroyed: actorId is the destroyed ship, killerId carried as a target (not baked into note)', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ship-destroyed',
                actorId: 'B',
                round: 1,
                killerId: 'A',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.kind).toBe('death');
        expect(entry.actorId).toBe('B'); // the destroyed ship
        // Killer is carried as a target so the RENDERER can resolve it to a ship name via nameOf,
        // instead of a raw id baked into the note string.
        expect(entry.targets).toEqual([{ targetId: 'A' }]);
        expect(entry.note).toBeUndefined();
    });

    // ─── Reaction nesting + endOfRound fallback ───────────────────────────────

    it('reaction nests under the most-recent non-reactive trigger entry in the correct turn', () => {
        // During A's turn, A attacks B. Then B's reactive counter (ability-performed,
        // stamped duringTurnOf:'A') hits A back. The counter must NOT be a top-level
        // entry; it must nest under A's attack with its target/amount populated.
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
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 1000,
                isPrimaryTarget: true,
            }),
            // B's reactive counterattack — stamped.
            ev({
                type: 'ability-performed',
                actorId: 'B',
                targetId: 'A',
                round: 1,
                abilityType: 'damage',
                damage: 400,
                didHit: true,
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            }),
            ev({
                type: 'attacked',
                attackerId: 'B',
                targetId: 'A',
                round: 1,
                damage: 400,
                isPrimaryTarget: true,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const turn = log[0].turns[0];
        expect(turn.actorId).toBe('A');
        // Only ONE top-level entry: A's attack.
        expect(turn.entries).toHaveLength(1);
        const attack = turn.entries[0];
        expect(attack.actorId).toBe('A');
        // The counter is nested under A's attack.
        expect(attack.reactions).toHaveLength(1);
        const counter = attack.reactions[0];
        expect(counter.kind).toBe('attack');
        expect(counter.actorId).toBe('B');
        // Same-object-reference: the following attacked filled the nested entry's target.
        expect(counter.targets).toHaveLength(1);
        expect(counter.targets[0].targetId).toBe('A');
        expect(counter.targets[0].amount).toBe(400);
    });

    it('round-end-drained reaction still nests under its trigger turn (not endOfRound)', () => {
        // Same counter, but positioned AFTER turn-ended A / before round-ended.
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
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 1000,
                isPrimaryTarget: true,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            // Reaction drained at round-end — no current turn, but stamped duringTurnOf:'A'.
            ev({
                type: 'ability-performed',
                actorId: 'B',
                targetId: 'A',
                round: 1,
                abilityType: 'damage',
                damage: 400,
                didHit: true,
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            }),
            ev({
                type: 'attacked',
                attackerId: 'B',
                targetId: 'A',
                round: 1,
                damage: 400,
                isPrimaryTarget: true,
            }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const round = log[0];
        expect(round.endOfRound).toHaveLength(0);
        const turn = round.turns[0];
        expect(turn.entries).toHaveLength(1);
        expect(turn.entries[0].reactions).toHaveLength(1);
        expect(turn.entries[0].reactions[0].actorId).toBe('B');
        expect(turn.entries[0].reactions[0].targets[0].amount).toBe(400);
    });

    it('a reactive (stamped) charge-changed nests under its trigger instead of the active turn', () => {
        // A's attack triggers B's on-attacked self-charge-gain reactive. The charge-changed is
        // emitted through the reactive-stamping bus (duringTurnOf:'A'), so it must nest under
        // A's attack — not surface as a top-level charge entry in A's turn.
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
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 1000,
                isPrimaryTarget: true,
            }),
            ev({
                type: 'charge-changed',
                actorId: 'B',
                round: 1,
                oldCharge: 0,
                newCharge: 1,
                reason: 'manip',
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const turn = log[0].turns[0];
        // Only A's attack is top-level; the charge delta is NOT a sibling entry.
        expect(turn.entries).toHaveLength(1);
        expect(turn.entries[0].kind).toBe('attack');
        expect(turn.entries[0].reactions).toHaveLength(1);
        const reaction = turn.entries[0].reactions[0];
        expect(reaction.kind).toBe('charge-changed');
        expect(reaction.actorId).toBe('B');
    });

    it('unstamped round-end event → endOfRound (no current turn, no crash)', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            // dot-ticked AFTER the last turn-ended — no stamp.
            ev({
                type: 'dot-ticked',
                targetId: 'B',
                round: 1,
                dotType: 'inferno',
                damage: 250,
                stacks: 2,
            }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        expect(() => buildCombatLog(events, roster, initialCharge)).not.toThrow();
        const log = buildCombatLog(events, roster, initialCharge);
        const round = log[0];
        // No turn entries (the dot ticked outside a turn).
        expect(round.turns[0].entries).toHaveLength(0);
        // Landed in endOfRound.
        expect(round.endOfRound).toHaveLength(1);
        expect(round.endOfRound[0].kind).toBe('dot-ticked');
        expect(round.endOfRound[0].targets[0].amount).toBe(250);
    });

    it('ordering invariant: re-homing a reaction does not reorder parent entries', () => {
        // Two non-reactive parents in A's turn. A reaction stamped duringTurnOf:'A'
        // re-homes onto the most-recent non-reactive parent (parent 2). The two parents
        // keep their original order.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            // Parent 1
            ev({ type: 'buff-applied', actorId: 'A', round: 1, buffName: 'Inspire', duration: 2 }),
            // Parent 2
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
            // Reaction — nests under most-recent non-reactive entry (parent 2).
            ev({
                type: 'buff-applied',
                actorId: 'B',
                round: 1,
                buffName: 'Counter',
                duration: 1,
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const turn = log[0].turns[0];
        expect(turn.entries).toHaveLength(2);
        // Parents keep original order.
        expect(turn.entries[0].kind).toBe('buff');
        expect(turn.entries[0].note).toBe('Inspire');
        expect(turn.entries[1].kind).toBe('attack');
        // Reaction nested under parent 2 (most-recent non-reactive).
        expect(turn.entries[0].reactions).toHaveLength(0);
        expect(turn.entries[1].reactions).toHaveLength(1);
        expect(turn.entries[1].reactions[0].kind).toBe('buff');
        expect(turn.entries[1].reactions[0].note).toBe('Counter');
    });

    it("stamped event whose OPEN turn has no non-reactive trigger yet → that turn's entries", () => {
        // A turn opens for A but has produced NO non-reactive entry yet, then a stamped
        // reaction arrives. There is nothing to nest under, but the turn EXISTS and the
        // effect belongs to it — this is the `start-of-turn` grant window (SP-G G2 drains
        // buff/shield/heal grants before the acting owner casts). It becomes a top-level
        // entry of A's turn. Previously it was exiled to endOfRound, which detached the
        // SHIELD gear set's per-turn pool from the ship that generated it.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'buff-applied',
                actorId: 'B',
                round: 1,
                buffName: 'Counter',
                duration: 1,
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        expect(() => buildCombatLog(events, roster, initialCharge)).not.toThrow();
        const log = buildCombatLog(events, roster, initialCharge);
        const round = log[0];
        expect(round.endOfRound).toHaveLength(0);
        expect(round.turns[0].entries).toHaveLength(1);
        expect(round.turns[0].entries[0].kind).toBe('buff');
        expect(round.turns[0].entries[0].note).toBe('Counter');
    });

    it('stamped event naming a turn that does NOT exist this round → endOfRound (no crash)', () => {
        // The turn-less drain windows (post-round death drain, round-ended reactives) stamp
        // `duringTurnOf` with an actor that took no turn this round. There is no turn to attach
        // to, so endOfRound remains the correct fallback.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({
                type: 'buff-applied',
                actorId: 'B',
                round: 1,
                buffName: 'Counter',
                duration: 1,
                reactive: true,
                duringTurnOf: 'Z',
                triggerActorId: 'Z',
            }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        expect(() => buildCombatLog(events, roster, initialCharge)).not.toThrow();
        const log = buildCombatLog(events, roster, initialCharge);
        const round = log[0];
        expect(round.turns[0].entries).toHaveLength(0);
        expect(round.endOfRound).toHaveLength(1);
        expect(round.endOfRound[0].kind).toBe('buff');
        expect(round.endOfRound[0].note).toBe('Counter');
    });

    it('unknown stamped event type is a no-op (no entry, no throw)', () => {
        // unknown-event-type has no handler. Stamped — the stamp logic must not throw.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 100,
                didHit: true,
            }),
            ev({
                type: 'unknown-event-type',
                actorId: 'A',
                round: 1,
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            } as unknown as CombatEvent),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        expect(() => buildCombatLog(events, roster, initialCharge)).not.toThrow();
        const log = buildCombatLog(events, roster, initialCharge);
        const turn = log[0].turns[0];
        // The ability-performed never received an attacked event, so it closes with zero
        // targets and (didHit: true, not a miss) gets pruned by Task 4's phantom-row
        // suppression. The stamped unknown-event-type produced nothing (no throw, no entries).
        expect(turn.entries).toHaveLength(0);
        expect(log[0].endOfRound).toHaveLength(0);
    });

    // ─── Fix 1: resultingHpPct on nested reaction targets ────────────────────

    it('counterattack hp-changed stamps the nested reaction target, not the original attacker entry', () => {
        // A attacks B (B's hp drops). B reactive-counters A (A's hp drops to 75%).
        // The nested counter entry's target (A) must have resultingHpPct === 75.
        // A's original attack entry's target (B) must still have its own resultingHpPct.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            // A attacks B
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
            ev({ type: 'hp-changed', targetId: 'B', round: 1, oldPct: 100, newPct: 60 }),
            // B's reactive counterattack targets A
            ev({
                type: 'ability-performed',
                actorId: 'B',
                targetId: 'A',
                round: 1,
                abilityType: 'damage',
                damage: 300,
                didHit: true,
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            }),
            ev({
                type: 'attacked',
                attackerId: 'B',
                targetId: 'A',
                round: 1,
                damage: 300,
                isPrimaryTarget: true,
            }),
            // hp-changed for A — must stamp the nested counter entry, not B's target in the outer entry
            ev({ type: 'hp-changed', targetId: 'A', round: 1, oldPct: 100, newPct: 75 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const turn = log[0].turns[0];
        // Only one top-level entry: A's attack.
        expect(turn.entries).toHaveLength(1);
        const outerAttack = turn.entries[0];
        expect(outerAttack.actorId).toBe('A');
        // B's HP stamped on the outer attack's target.
        expect(outerAttack.targets[0].targetId).toBe('B');
        expect(outerAttack.targets[0].resultingHpPct).toBe(60);
        // Counter is nested.
        expect(outerAttack.reactions).toHaveLength(1);
        const counter = outerAttack.reactions[0];
        expect(counter.actorId).toBe('B');
        expect(counter.targets).toHaveLength(1);
        expect(counter.targets[0].targetId).toBe('A');
        // Key assertion: A's hp-changed must stamp the NESTED counter target, not bleed elsewhere.
        expect(counter.targets[0].resultingHpPct).toBe(75);
    });

    it('ship-destroyed: no killerId — no note or note without killer reference', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ship-destroyed',
                actorId: 'B',
                round: 1,
                // killerId intentionally absent
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        expect(() => buildCombatLog(events, roster, initialCharge)).not.toThrow();
        const log = buildCombatLog(events, roster, initialCharge);
        const entry = log[0].turns[0].entries[0];
        expect(entry.kind).toBe('death');
        expect(entry.actorId).toBe('B');
        expect(entry.targets).toEqual([]);
    });

    // ─── Log-only reactive damage / heal (drain-time procs that emit no ability/heal event) ───
    it('reactive-damage-performed nests under the trigger turn as an attack entry', () => {
        // A crits B on A's turn; a reaction (stamped duringTurnOf:'A') deals damage to B. The
        // reactive-damage-performed carries its own target — no follow-up `attacked` event.
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
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 1000,
                isPrimaryTarget: true,
            }),
            ev({
                type: 'reactive-damage-performed',
                sourceId: 'A',
                targetId: 'B',
                round: 1,
                amount: 600,
                didCrit: false,
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const turn = log[0].turns[0];
        // Only ONE top-level entry: A's attack. The reactive damage nests under it.
        expect(turn.entries).toHaveLength(1);
        const attack = turn.entries[0];
        expect(attack.reactions).toHaveLength(1);
        const reaction = attack.reactions[0];
        expect(reaction.kind).toBe('attack');
        expect(reaction.actorId).toBe('A');
        expect(reaction.targets).toEqual([
            expect.objectContaining({ targetId: 'B', amount: 600, didHit: true }),
        ]);
    });

    it('reactive-heal-performed nests under the trigger turn as a heal entry', () => {
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
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 1000,
                isPrimaryTarget: true,
            }),
            ev({
                type: 'reactive-heal-performed',
                casterId: 'B',
                round: 1,
                amount: 1152,
                perTarget: [{ targetId: 'A', amount: 1152 }],
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const attack = log[0].turns[0].entries[0];
        expect(attack.reactions).toHaveLength(1);
        const reaction = attack.reactions[0];
        expect(reaction.kind).toBe('heal');
        expect(reaction.actorId).toBe('B');
        expect(reaction.targets).toEqual([
            expect.objectContaining({ targetId: 'A', amount: 1152 }),
        ]);
    });

    // ─── Task 4: suppress phantom empty attack row on buff-only turns ────────

    it('does not emit an empty attack entry for a buff-only cast (no attacked event)', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'A',
                round: 1,
                abilityType: 'buff',
                didHit: true,
            }),
            ev({
                type: 'buff-applied',
                actorId: 'A',
                round: 1,
                buffName: 'Attack Up',
                duration: 2,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const rounds = buildCombatLog(
            events,
            [{ actorId: 'A', side: 'player', name: 'A' }],
            new Map()
        );
        const turn = rounds[0].turns[0];
        // Only the buff entry remains — no empty attack row.
        expect(turn.entries.map((e) => e.kind)).toEqual(['buff']);
    });

    it('still renders a genuine miss (targeted attack that missed)', () => {
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
        const rounds = buildCombatLog(
            events,
            [
                { actorId: 'A', side: 'player', name: 'A' },
                { actorId: 'B', side: 'enemy', name: 'B' },
            ],
            new Map()
        );
        const turn = rounds[0].turns[0];
        expect(turn.entries).toHaveLength(1);
        expect(turn.entries[0].kind).toBe('attack');
        expect(turn.entries[0].targets[0].didHit).toBe(false); // miss target synthesized
    });
});

// ---------------------------------------------------------------------------
// Task 6c: the LOG-ONLY stats-snapshot event decorates the turn it belongs to
// (no entry is created — it is a property on CombatLogTurn, not a CombatLogEntry).
// ---------------------------------------------------------------------------

describe('buildCombatLog — stats-snapshot (Task 6c)', () => {
    it('attaches a stats-snapshot to the turn it belongs to', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'stats-snapshot',
                actorId: 'A',
                round: 1,
                stats: {
                    attack: 5000,
                    defence: 3000,
                    crit: 70,
                    critDamage: 150,
                    defensePenetration: 0,
                    speed: 120,
                    hacking: 200,
                    security: 100,
                    currentHp: 40000,
                    maxHp: 50000,
                    shieldPool: 0,
                },
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const rounds = buildCombatLog(
            events,
            [{ actorId: 'A', side: 'player', name: 'A' }],
            new Map()
        );
        expect(rounds[0].turns[0].statsSnapshot?.attack).toBe(5000);
        expect(rounds[0].turns[0].statsSnapshot?.currentHp).toBe(40000);
        // No entry is created for the snapshot — it decorates the turn only.
        expect(rounds[0].turns[0].entries).toHaveLength(0);
    });

    it('does not attach the snapshot to a turn belonging to a different actor', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'turn-started', actorId: 'B', round: 1 }),
            ev({
                type: 'stats-snapshot',
                actorId: 'A', // stale/mismatched actorId — must not leak onto B's turn
                round: 1,
                stats: {
                    attack: 1,
                    defence: 1,
                    crit: 1,
                    critDamage: 1,
                    defensePenetration: 1,
                    speed: 1,
                    hacking: 1,
                    security: 1,
                    currentHp: 1,
                    maxHp: 1,
                    shieldPool: 1,
                },
            }),
            ev({ type: 'turn-ended', actorId: 'B', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const rounds = buildCombatLog(
            events,
            [
                { actorId: 'A', side: 'player', name: 'A' },
                { actorId: 'B', side: 'enemy', name: 'B' },
            ],
            new Map()
        );
        expect(rounds[0].turns[0].statsSnapshot).toBeUndefined();
        expect(rounds[0].turns[1].statsSnapshot).toBeUndefined();
    });

    it('renders a buff-expired event as a status line in the owner turn', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'buff-expired', actorId: 'A', round: 1, buffName: 'Shield Wall' }),
        ];
        const rounds = buildCombatLog(events, roster, initialCharge);
        const entries = rounds[0].turns[0].entries;
        const expired = entries.find((e) => e.kind === 'buff-expired');
        expect(expired).toBeDefined();
        expect(expired!.actorId).toBe('A');
        expect(expired!.note).toBe('Shield Wall expired');
    });

    it('renders a debuff-resisted event with source and target', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'debuff-resisted',
                sourceId: 'A',
                targetId: 'B',
                round: 1,
                buffName: 'Stun',
            }),
        ];
        const rounds = buildCombatLog(events, roster, initialCharge);
        const resisted = rounds[0].turns[0].entries.find((e) => e.kind === 'debuff-resisted');
        expect(resisted).toBeDefined();
        expect(resisted!.actorId).toBe('A');
        expect(resisted!.targets[0].targetId).toBe('B');
        expect(resisted!.note).toBe('Stun');
    });

    it('renders a debuff-resisted event with no source (falls back to target)', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'debuff-resisted', targetId: 'B', round: 1, buffName: 'Stun' }),
        ];
        const rounds = buildCombatLog(events, roster, initialCharge);
        const resisted = rounds[0].turns[0].entries.find((e) => e.kind === 'debuff-resisted');
        expect(resisted).toBeDefined();
        expect(resisted!.actorId).toBe('B');
        expect(resisted!.targets[0].targetId).toBe('B');
    });

    it('nests a stamped shield-destroyed under the triggering attack', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 5000,
                didCrit: false,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 5000,
                didCrit: false,
                isPrimaryTarget: true,
            }),
            // Emitted after the attack entry exists (defer-flush), stamped to A's turn.
            // The engine emits the LOG-ONLY twin (`shield-destroyed-log`) through the
            // defer-flush buffer; the REAL `shield-destroyed` emits inline for its
            // combat listener (AEGIS) and carries no log entry (see decoupling test below).
            ev({
                type: 'shield-destroyed-log',
                victimId: 'B',
                round: 1,
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            }),
        ];
        const rounds = buildCombatLog(events, roster, initialCharge);
        const attack = rounds[0].turns[0].entries.find((e) => e.kind === 'attack');
        expect(attack).toBeDefined();
        const nested = attack!.reactions.find((r) => r.kind === 'shield-destroyed');
        expect(nested).toBeDefined();
        expect(nested!.actorId).toBe('B');
    });

    it('the real shield-destroyed event produces NO log entry (only the -log twin does)', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'shield-destroyed', victimId: 'B', round: 1 }),
        ];
        const rounds = buildCombatLog(events, roster, initialCharge);
        const all = rounds[0].turns.flatMap((t) => t.entries).concat(rounds[0].endOfRound);
        expect(all.some((e) => e.kind === 'shield-destroyed')).toBe(false);
    });

    it('nests a stamped cheat-death-activated under the triggering attack', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 9999,
                didCrit: false,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 9999,
                didCrit: false,
                isPrimaryTarget: true,
            }),
            // Emitted after the attack entry exists (defer-flush), stamped to A's turn.
            // The engine emits the LOG-ONLY twin (`cheat-death-log`) through the defer-flush
            // buffer; the REAL `cheat-death-activated` emits inline for its combat listener
            // (Yazid) and carries no log entry (see decoupling test below).
            ev({
                type: 'cheat-death-log',
                actorId: 'B',
                round: 1,
                reactive: true,
                duringTurnOf: 'A',
                triggerActorId: 'A',
            }),
        ];
        const rounds = buildCombatLog(events, roster, initialCharge);
        const attack = rounds[0].turns[0].entries.find((e) => e.kind === 'attack');
        expect(attack).toBeDefined();
        const nested = attack!.reactions.find((r) => r.kind === 'cheat-death');
        expect(nested).toBeDefined();
        expect(nested!.actorId).toBe('B');
    });

    it('the real cheat-death-activated event produces NO log entry (only the -log twin does)', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'cheat-death-activated', actorId: 'B', round: 1 }),
        ];
        const rounds = buildCombatLog(events, roster, initialCharge);
        const all = rounds[0].turns.flatMap((t) => t.entries).concat(rounds[0].endOfRound);
        expect(all.some((e) => e.kind === 'cheat-death')).toBe(false);
    });
});

/**
 * Turn-entry display order — USER-REPORTED: the attack line printed LAST, under its own
 * consequences, because a positional cast's `ability-performed` is deliberately deferred until
 * after the per-victim apply (so it can report the true per-victim crit outcome):
 *
 *     Butcher: charge 0→1
 *     Butcher → Enemy Heliodor: Inferno II resisted
 *     Enemy Heliodor: destroyed by Butcher          <- killed by an attack not yet printed
 *     Butcher [active] → Enemy Heliodor: 64,450 (crit)
 *     Butcher: Attack Up III expired
 *
 * The builder does no sorting of its own — entry order WAS emission order — so this is corrected
 * at the presentation layer: what the skill did, then charge, then consequences. The engine's
 * emission order is untouched (reaction nesting and the reflect-log flush depend on it).
 */
describe('buildCombatLog — turn entry display order', () => {
    it('orders a turn skill-effects -> charge -> consequences, whatever the emission order', () => {
        // Emitted in the exact order the engine produces for a positional killing blow.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'charge-changed',
                actorId: 'A',
                round: 1,
                oldCharge: 0,
                newCharge: 1,
                reason: 'gen',
            }),
            ev({
                type: 'debuff-resisted',
                sourceId: 'A',
                targetId: 'B',
                round: 1,
                buffName: 'Inferno II',
            }),
            ev({ type: 'ship-destroyed', actorId: 'B', round: 1, killerId: 'A' }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 64450,
                didCrit: true,
                critHits: 1,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 64450,
                didCrit: true,
                isPrimaryTarget: true,
            }),
            ev({ type: 'buff-expired', actorId: 'A', round: 1, buffName: 'Attack Up III' }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];

        const turn = buildCombatLog(events, roster, initialCharge)[0].turns[0];
        expect(turn.entries.map((e) => e.kind)).toEqual([
            'attack', // what the skill did
            'charge-changed', // charge bookkeeping
            'debuff-resisted', // consequences, in emission order among themselves
            'death',
            'buff-expired',
        ]);
    });

    it('keeps reactions nested under their trigger when that trigger is reordered', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'charge-changed',
                actorId: 'A',
                round: 1,
                oldCharge: 0,
                newCharge: 1,
                reason: 'gen',
            }),
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
            // A reaction to that attack, stamped into A's turn.
            ev({
                type: 'reactive-damage-performed',
                sourceId: 'B',
                targetId: 'A',
                round: 1,
                amount: 620,
                reactive: true,
                duringTurnOf: 'A',
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];

        const turn = buildCombatLog(events, roster, initialCharge)[0].turns[0];
        // The attack hoists above the charge row, carrying its reaction with it — the reaction is
        // never promoted to a top-level entry by the sort.
        expect(turn.entries.map((e) => e.kind)).toEqual(['attack', 'charge-changed']);
        expect(turn.entries[0].reactions.map((r) => r.actorId)).toEqual(['B']);
    });
});

// ─── PR2 Task 1: sticky skill tag across sub-attack rows ─────────────────────

describe('buildCombatLog — sticky skill tag across sub-attack rows', () => {
    it('every ability-performed in one cast carries the skill name and slot', () => {
        // Three sub-attack rows from ONE skill-fired, each followed by its own attacked.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({
                type: 'skill-fired',
                actorId: 'A',
                round: 1,
                slot: 'active',
                skillName: 'Volley',
            }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 10,
                didCrit: false,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 10,
                isPrimaryTarget: true,
            }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 10,
                didCrit: false,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 10,
                isPrimaryTarget: true,
            }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 10,
                didCrit: false,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 10,
                isPrimaryTarget: true,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];

        const log = buildCombatLog(events, roster, initialCharge);
        const attacks = log[0].turns[0].entries.filter((e) => e.kind === 'attack');

        expect(attacks).toHaveLength(3);
        for (const a of attacks) {
            expect(a.skillName).toBe('Volley');
            expect(a.slot).toBe('active');
        }
    });

    it('a NEW skill-fired replaces the sticky tag', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'skill-fired', actorId: 'A', round: 1, slot: 'active', skillName: 'First' }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 10,
                didCrit: false,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 10,
                isPrimaryTarget: true,
            }),
            ev({
                type: 'skill-fired',
                actorId: 'A',
                round: 1,
                slot: 'charged',
                skillName: 'Second',
            }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 10,
                didCrit: false,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 10,
                isPrimaryTarget: true,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];

        const log = buildCombatLog(events, roster, initialCharge);
        const attacks = log[0].turns[0].entries.filter((e) => e.kind === 'attack');

        expect(attacks.map((a) => a.skillName)).toEqual(['First', 'Second']);
        expect(attacks.map((a) => a.slot)).toEqual(['active', 'charged']);
    });

    it('a second cast whose debuff clause resolves FIRST is not mislabelled with the previous skill', () => {
        // The gap the sibling test above cannot see. `currentSkillTag()` latches `pendingSkill`,
        // but eight other handlers still `consumePendingSkill()` — so an intra-cast debuff written
        // ahead of the damage clause consumes it before this cast's first `ability-performed`.
        // Without an explicit clear on `skill-fired`, the latch still held 'First' and the second
        // attack row was labelled with the FIRST skill's name.
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'skill-fired', actorId: 'A', round: 1, slot: 'active', skillName: 'First' }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 10,
                didCrit: false,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 10,
                isPrimaryTarget: true,
            }),
            ev({
                type: 'skill-fired',
                actorId: 'A',
                round: 1,
                slot: 'charged',
                skillName: 'Second',
            }),
            // The clause-order case: this consumes `pendingSkill` before the damage clause lands.
            ev({
                type: 'debuff-applied',
                sourceId: 'A',
                targetId: 'B',
                round: 1,
                buffName: 'Attack Down I',
            }),
            ev({
                type: 'ability-performed',
                actorId: 'A',
                targetId: 'B',
                round: 1,
                abilityType: 'damage',
                damage: 10,
                didCrit: false,
                didHit: true,
            }),
            ev({
                type: 'attacked',
                attackerId: 'A',
                targetId: 'B',
                round: 1,
                damage: 10,
                isPrimaryTarget: true,
            }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];

        const log = buildCombatLog(events, roster, initialCharge);
        const attacks = log[0].turns[0].entries.filter((e) => e.kind === 'attack');

        // The second row must NOT read 'First'. It may carry 'Second' or no tag at all
        // (the debuff handler consumed the pending tag) — what must never happen is the
        // previous cast's identity leaking onto it.
        expect(attacks).toHaveLength(2);
        expect(attacks[0].skillName).toBe('First');
        expect(attacks[1].skillName).not.toBe('First');
    });
});

// ─── PR6: no visible attack row for a cast bound to a non-roster target ──────

/**
 * The hazard (multi-hit full-walk epic, PR6). `willApplyPositionally` requires
 * `target != null && pattern != null`, so a `hits > 1` cast with NO targeting data is NOT deferred
 * to the engine and emits inline — N `ability-performed`, all naming the engine's vestigial `enemy`
 * sink, and no `attacked` at all (the player-side `attacked` emit lives only on the positional
 * apply). Each opens an attack row the renderer has no name to put in.
 *
 * WHY EVERY FIXTURE HERE NESTS A REACTION. `finalizeMissEntry`'s phantom-row splice already removes
 * a target-less row when nothing nested under it, so the bare 3-hit stream produces an empty turn
 * with or without this guard — an assertion on it would observe nothing. `reactions.length === 0`
 * is the exact condition under which that splice declines to prune, and a per-sub-attack rider's
 * drained grant (`on-deal-damage`, `on-crit`, `on-ally-crit`) is precisely such a nested reaction.
 * So the stamped `buff-applied` after each sub-attack is not decoration: it is the only shape in
 * which the target-less rows actually survive to be seen.
 */
describe('buildCombatLog — target-less rows from a non-roster-bound cast', () => {
    /** One sub-attack: the event plus the stamped grant a rider drains for it. */
    const subAttack = (targetId: string, withAttacked: boolean): CombatEvent[] => [
        ev({
            type: 'ability-performed',
            actorId: 'A',
            targetId,
            round: 1,
            abilityType: 'damage',
            damage: 10000,
            didCrit: false,
            didHit: true,
        }),
        ...(withAttacked
            ? [
                  ev({
                      type: 'attacked',
                      attackerId: 'A',
                      targetId,
                      round: 1,
                      damage: 10000,
                      isPrimaryTarget: true,
                  }),
              ]
            : []),
        ev({
            type: 'buff-applied',
            actorId: 'A',
            round: 1,
            buffName: 'Rider',
            duringTurnOf: 'A',
            triggerActorId: 'A',
        } as CombatEvent),
    ];

    const cast = (targetId: string, withAttacked: boolean): CombatEvent[] => [
        ev({ type: 'round-started', round: 1 }),
        ev({ type: 'turn-started', actorId: 'A', round: 1 }),
        ev({ type: 'skill-fired', actorId: 'A', round: 1, slot: 'active', skillName: 'Volley' }),
        ...subAttack(targetId, withAttacked),
        ...subAttack(targetId, withAttacked),
        ...subAttack(targetId, withAttacked),
        ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
        ev({ type: 'round-ended', round: 1 }),
    ];

    /**
     * The COMPANION, and it is written first on purpose: a guard that suppressed every row would
     * pass the dummy-sink assertion below while silently deleting the real log. A positioned
     * 3-hit cast must keep all three of its rows, each naming its victim.
     */
    it('a positioned 3-hit cast still produces its three named attack rows', () => {
        const turn = buildCombatLog(cast('B', true), roster, initialCharge)[0].turns[0];
        const attacks = turn.entries.filter((e) => e.kind === 'attack');

        expect(attacks).toHaveLength(3);
        for (const a of attacks) {
            expect(a.targets.map((t) => t.targetId)).toEqual(['B']);
            expect(a.skillName).toBe('Volley');
            // The rider's grant stays nested under its own sub-attack.
            expect(a.reactions.map((r) => r.note)).toEqual(['Rider']);
        }
    });

    it('a 3-hit cast bound to the dummy sink leaves no attack row in the log', () => {
        const turn = buildCombatLog(cast('dummy-sink', false), roster, initialCharge)[0].turns[0];

        expect(turn.entries.filter((e) => e.kind === 'attack')).toHaveLength(0);
        // …and no attack row survives NESTED either — pruning a parent must not be faked by
        // demoting it into someone else's `.reactions[]`.
        for (const e of turn.entries) {
            expect(e.reactions.filter((r) => r.kind === 'attack')).toHaveLength(0);
        }
    });

    /** The riders themselves must stay visible — the guard drops the row, not its contents. */
    it('keeps the drained rider grants when the parent row is suppressed', () => {
        const turn = buildCombatLog(cast('dummy-sink', false), roster, initialCharge)[0].turns[0];
        const notes = turn.entries.filter((e) => e.kind === 'buff').map((e) => e.note);

        expect(notes).toEqual(['Rider', 'Rider', 'Rider']);
    });

    /**
     * ISOLATES THE ROSTER AXIS. The two fixtures above differ from each other on TWO axes at
     * once — roster membership ('B' vs 'dummy-sink') AND presence of an `attacked` event
     * (true vs false) — so neither one alone pins the `!ctx.rosterIds.has(...)` disjunct: a
     * mutant that deleted the roster check and always pruned would still pass both, because
     * the companion test never reaches the second guard (its `attacked` event populates
     * `targets`, so `targets.length === 0` already fails) and the dummy-sink test still gets
     * pruned by the same mutant for the same (right) reason.
     *
     * This fixture holds cardinality fixed at "no `attacked` event" (matching the dummy-sink
     * case) and flips only roster membership back to a real roster member ('B'). A target-less
     * row bound to a ROSTER member must still survive on the strength of its nested rider
     * grant — the `reactions.length === 0` reprieve applies, and the roster-membership
     * override must NOT fire for it.
     */
    it('a roster-bound cast with no attacked event still keeps its target-less rows', () => {
        const turn = buildCombatLog(cast('B', false), roster, initialCharge)[0].turns[0];
        const attacks = turn.entries.filter((e) => e.kind === 'attack');

        expect(attacks).toHaveLength(3);
        for (const a of attacks) {
            expect(a.targets).toHaveLength(0);
            expect(a.reactions.map((r) => r.note)).toEqual(['Rider']);
        }
    });
});

/**
 * #362 R11 — "EVERY reversal writes its own combat-log row", the APPLIER-LESS one included.
 *
 * `reversed-repair-log` books to `e.applierId ?? e.victimId`. The `?? e.victimId` half is the
 * SCHEDULED channel: a Reversed Repairs hand-ticked in the calculator's enemy-debuff picker was
 * never cast by anyone, so the event carries no `applierId` (`reversedRepairs.ts` models that as a
 * legitimate state, not an error). Before #362 fix-wave-2 that fallback was executed by zero tests
 * — mutating it to `e.applierId!` left the whole suite green — so R11's own coverage stopped at
 * the rows that HAVE an applier.
 *
 * The two shapes are asserted side by side so the fallback is measured against the normal path
 * rather than in isolation: same victim, same amount, same healer, differing only in `applierId`.
 */
describe('buildCombatLog: reversed-repair rows (#362 R11)', () => {
    const reversalEvents = (applierId?: string): CombatEvent[] => [
        ev({ type: 'round-started', round: 1 }),
        ev({ type: 'turn-started', actorId: 'A', round: 1 }),
        ev({
            type: 'reversed-repair-log',
            victimId: 'B',
            ...(applierId !== undefined ? { applierId } : {}),
            healerId: 'A',
            amount: 4321,
            round: 1,
        }),
        ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
        ev({ type: 'round-ended', round: 1 }),
    ];

    const rowFrom = (applierId?: string) =>
        buildCombatLog(reversalEvents(applierId), roster, initialCharge)[0].turns[0].entries.find(
            (e) => e.kind === 'reversed-repair'
        );

    // THE INSTRUMENT: with an applier, the row books to it — this is the shape every other R11
    // test in the branch exercises, and it is what makes the applier-less assertion below a
    // measurement of the fallback rather than of the handler existing at all.
    it('books to the APPLIER when the status has one', () => {
        const row = rowFrom('A');
        expect(row).toBeDefined();
        expect(row!.actorId).toBe('A');
        expect(row!.targets).toEqual([{ targetId: 'B', amount: 4321 }]);
        expect(row!.healerId).toBe('A');
    });

    // THE FALLBACK: no applier, and the row still exists — R11 admits no silent reversal — booked
    // to the VICTIM so the formatter renders the self-line rather than a source → target line
    // with an undefined source. It must NOT fall back to the healer: that is the attribution R7′
    // rejects, and `healerId` carries the healer already, on its own display-only axis.
    it('falls back to the VICTIM when the scheduled channel supplies no applier', () => {
        const row = rowFrom(undefined);
        expect(row).toBeDefined();
        expect(row!.actorId).toBe('B');
        expect(row!.actorId).not.toBe('A'); // explicitly not the healer
        expect(row!.targets).toEqual([{ targetId: 'B', amount: 4321 }]);
        // The healer survives the applier's absence — the two ids are on different axes.
        expect(row!.healerId).toBe('A');
    });
});
