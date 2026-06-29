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
            // buff-expired has no handler — should not throw and produce no entry
            ev({ type: 'buff-expired', actorId: 'A', round: 1, buffName: 'Inspire' }),
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
            } as CombatEvent),
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
            } as CombatEvent),
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

    it('buff-applied: self-buff — actorId is the buff receiver, targets is empty, note has buffName', () => {
        const events: CombatEvent[] = [
            ev({ type: 'round-started', round: 1 }),
            ev({ type: 'turn-started', actorId: 'A', round: 1 }),
            ev({ type: 'buff-applied', actorId: 'A', round: 1, buffName: 'Inspire', duration: 2 }),
            ev({ type: 'turn-ended', actorId: 'A', round: 1 }),
            ev({ type: 'round-ended', round: 1 }),
        ];
        const log = buildCombatLog(events, roster, initialCharge);
        const entries = log[0].turns[0].entries;
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.kind).toBe('buff');
        expect(entry.actorId).toBe('A');
        expect(entry.targets).toEqual([]);
        expect(entry.note).toBe('Inspire');
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

    it('dot-applied: sourceId → actorId (inflicter), targetId → targets, note has dotType', () => {
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
        expect(entry.note).toContain('corrosion');
    });

    it('dot-ticked: targetId is both the actorId and target; amount is the damage; no skill consumed', () => {
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
                dotType: 'inferno',
                damage: 250,
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
        expect(dotEntry!.targets[0].amount).toBe(250);
        // skill-fired must NOT have been consumed by dot-ticked
        expect(dotEntry!.skillName).toBeUndefined();
        expect(dotEntry!.slot).toBeUndefined();
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

    it('ship-destroyed: actorId is the destroyed ship, killerId appears in note', () => {
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
        expect(entry.targets).toEqual([]);
        expect(entry.note).toContain('A'); // killerId in note
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
});
