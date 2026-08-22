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
    /** Display-only: the round a save was spent, so the chip drops from later rounds. */
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
    // Detection MUST go through selfBuffNamesForOwners, NOT snapshot().activeSelfBuffs: a real
    // Cheat Death is an ability-sourced recurring self-buff, and the heal target's owner id is
    // often a team-actor id — snapshot alone misses both cases.
    const carriesCheatDeath = selfBuffNamesForOwners(opts.statusEngine, [targetId]).some((n) =>
        CHEAT_DEATH_BUFFS.has(n)
    );
    if (carriesCheatDeath && !opts.cheatDeathConsumed.has(targetId)) {
        victim.currentHp = 1;
        opts.cheatDeathConsumed.add(targetId);
        if (!opts.cheatDeathConsumedRound.has(targetId)) {
            opts.cheatDeathConsumedRound.set(targetId, opts.round);
        }
        opts.statusEngine.clearRemovable(targetId);
        // Actor-state DoT stacks are NOT StatusEngine entries, so clearRemovable misses them.
        // SP-E: filter, don't clear — an `unremovable` stack (Acidic Decay) keeps ticking.
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
    recordDestroyed(victim, opts.round, opts.bus, opts.killerId, opts.byDirectDamage);
    return 'destroyed';
}
