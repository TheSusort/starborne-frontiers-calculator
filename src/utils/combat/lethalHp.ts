import type { CombatActor } from './state';
import { recordDestroyed } from './state';
import type { StatusEngine } from './statusEngine';
import type { CombatEvent, CombatEventBus } from './events';
import { selfBuffNamesForOwners } from './triggers';
import { CHEAT_DEATH_BUFFS } from './cheatDeathBuffs';

export interface LethalHpOpts {
    round: number;
    statusEngine: StatusEngine;
    /** Per-combat consumption flag set — NOT a store mutation (Cheat Death is 'recurring'). */
    cheatDeathConsumed: Set<string>;
    /**
     * Display-only: remember the round it was spent so the chip is dropped from rounds AFTER
     * this one (see hideSpentCheatDeath). First write wins — the cheatDeathConsumed flag above
     * already blocks any second intercept, so this is set-once.
     */
    cheatDeathConsumedRound: Map<string, number>;
    bus: CombatEventBus;
    /** Routes the LOG-ONLY twin through the caller's deferral buffer. */
    emitConsequenceLog: (ev: CombatEvent) => void;
    /** Stamped on the log twin. Undefined outside a turn. */
    actingActorId: string | undefined;
    killerId?: string;
    byDirectDamage?: boolean;
}

/**
 * Resolve an actor that has just reached 0 HP: Cheat-Death intercept, else record the destroy.
 *
 * ONE death path for the whole engine. `applyVictimDamage` and the Reversed Repairs reversal
 * (#362) both call it — a hand-copied second path is the shape that produced the one-directional
 * defects in #306.
 *
 * Bomb death-splash deliberately stays at the `applyVictimDamage` call site: it recurses back into
 * `applyVictimDamage`, so it cannot live here, and per R5 the reversal path must not splash at all.
 * Callers gate their splash on a `'destroyed'` return.
 *
 * Returns `'alive'` when the victim is above 0 — safe to call unconditionally.
 */
export function resolveLethalHp(
    victim: CombatActor,
    opts: LethalHpOpts
): 'cheat-death' | 'destroyed' | 'alive' {
    if (victim.currentHp > 0) return 'alive';
    const targetId = victim.id;
    // Detection MUST go through selfBuffNamesForOwners, NOT snapshot().activeSelfBuffs:
    // a real (Yazid/Tycho/Hayyan-granted) Cheat Death is an ability-sourced recurring
    // self-buff that surfaces via activeAbilityStatuses('self', …, ownerId) — snapshot's
    // activeSelfBuffs only carries SCHEDULED always-active buffs, and only for the
    // 'attacker' owner (empty for any other owner). Since the heal target's owner id is
    // often a team-actor id (not 'attacker'), snapshot alone misses both the
    // ability-sourced case AND the non-attacker-owner case. selfBuffNamesForOwners
    // aggregates snapshot + timed + active ability self statuses keyed by the actor's
    // own id, covering every Cheat Death source.
    const carriesCheatDeath = selfBuffNamesForOwners(opts.statusEngine, [targetId]).some((n) =>
        CHEAT_DEATH_BUFFS.has(n)
    );
    if (carriesCheatDeath && !opts.cheatDeathConsumed.has(targetId)) {
        // Floor HP at 1 — this overrides the `Math.max(0, …)` clamp that just set currentHp to
        // 0. That clamp lives in the caller, not in this file, so neither side documents the
        // coupling without this note.
        victim.currentHp = 1;
        opts.cheatDeathConsumed.add(targetId);
        if (!opts.cheatDeathConsumedRound.has(targetId)) {
            opts.cheatDeathConsumedRound.set(targetId, opts.round);
        }
        opts.statusEngine.clearRemovable(targetId);
        // Actor-state DoT stacks (Corrosion/Inferno/generic) are NOT StatusEngine entries, so
        // clearRemovable doesn't touch them — wipe them here so the survivor takes no further
        // ticks. These are the SAME arrays the turn-start DoT-tick intake reads
        // (corrosionEntries/infernoEntries/genericDoTEntries). Filter, don't clear — an
        // `unremovable` stack (Acidic Decay) survives this wipe and keeps ticking. Bombs
        // (Blast, treated as persistent here) and accumulators are intentionally left untouched.
        victim.corrosionEntries = victim.corrosionEntries.filter((e) => e.unremovable);
        victim.infernoEntries = victim.infernoEntries.filter((e) => e.unremovable);
        victim.genericDoTEntries = victim.genericDoTEntries.filter((e) => e.unremovable);
        // Real event INLINE for its combat listener (Yazid on-cheat-death-activated) — keeps
        // listener timing byte-identical. The LOG-ONLY twin carries the nesting.
        opts.bus.emit({ type: 'cheat-death-activated', actorId: targetId, round: opts.round });
        opts.emitConsequenceLog({
            type: 'cheat-death-log',
            actorId: targetId,
            round: opts.round,
            reactive: true,
            duringTurnOf: opts.actingActorId,
            triggerActorId: opts.actingActorId,
        });
        return 'cheat-death';
    }
    // First reach 0 (no intercept) → record the destroyed round and emit ship-destroyed once
    // (idempotent via the per-actor destroyedRound field). That idempotency is load-bearing: the
    // caller's corpse-re-hit handling relies on a second lethal resolution being a no-op. The
    // healing result reads the destroyed round back off the heal target's runtime
    // `destroyedRound` field at the result site — no side-specific scalar write is needed here.
    recordDestroyed(victim, opts.round, opts.bus, opts.killerId, opts.byDirectDamage);
    return 'destroyed';
}
