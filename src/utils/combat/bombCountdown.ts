import type { CombatEventBus } from './events';
import type { CombatActor } from './state';

/**
 * Lingshe's charged skill: "reduces all Bombs on the enemy targets by N turn(s), Bombs
 * reduced to 0 turns by this skill will detonate." Decrements EVERY pending bomb on `victim` by
 * `turns`; any bomb reaching <= 0 detonates IMMEDIATELY using the EXACT `processBombs` burst
 * formula (engine.ts) — stacks * damagePerStack * affinityMult * (1 + detonationDamageModifier
 * / 100) — crediting the bomb's ORIGINAL applier (`bomb.sourceId`, NOT this ability's caster) via
 * a `bomb-detonated` bus emission (one event per detonating entry, mirroring the enemy-turn
 * `processBombs` shape) and, when `forceDetonateBomb` is supplied, the SAME per-victim
 * `applyVictimDamage` sink a natural detonation uses — so Barrier, Cheat-Death, `destroyedRound`/
 * `ship-destroyed`, and incoming-block/Lifeline all apply exactly as they would to a natural
 * countdown-0 burst (see `PlayerTurnArgs.forceDetonateBomb`'s doc comment). Absent (no engine
 * scope — standalone/unit-test callers), falls back to a bare shield-then-HP debit with none of
 * that. Deliberately NOT detonateContainers/detonate() — those credit the CASTER unconditionally
 * and consume the WHOLE container regardless of countdown.
 *
 * Also the shared implementation for the generic duration-shrink over bombs (triggers.ts's
 * `cleanse` / `reduce-duration` branch — Heliodor's "reduces the duration of all active Debuffs on
 * itself by 1 turn"): a Bomb is a Debuff, so a shrink reaches it, and one driven to 0 turns
 * explodes exactly like Lingshe's forced reduction. Returns the number of bombs it shrank so the
 * caller can fold them into its "-N turn on X debuffs" tally.
 *
 * Lives in its own module rather than beside its first caller in playerTurn.ts: triggers.ts needs
 * it too, and playerTurn.ts already imports values FROM triggers.ts — importing back would close a
 * runtime cycle.
 */
export function reduceBombsOnVictim(
    victim: CombatActor,
    turns: number,
    round: number,
    bus: CombatEventBus,
    // The actor whose bomb-countdown-reduce cast is forcing this detonation (Lingshe),
    // or the caster of the duration-shrink that drove the bomb to 0 (Heliodor). Distinct from
    // `bomb.sourceId` (the ORIGINAL applier, kept as `actorId` for attribution) — it becomes the
    // event's `detonatorId` so Lingshe's on-self-bomb-detonated Stealth grant fires for a burst SHE
    // caused even on bombs another ship applied.
    detonatorId: string,
    forceDetonateBomb?: (victim: CombatActor, sourceId: string, damage: number) => void
): number {
    // Bind the array reference ONCE, exactly as the sibling `processBombs` does with its
    // `args.pendingBombs` param. A forced detonation can kill the victim, and the engine's
    // bomb-splash-on-death then REASSIGNS `victim.pendingBombs = []` (not an in-place mutation).
    // Re-reading the live field mid-loop would strand this index into that emptied array and throw
    // (interaction-audit FINDING-002: Lingshe + a multi-bomb planter). Holding the pre-death
    // snapshot lets every countdown-0 bomb detonate, matching the natural burst on an actor's own
    // turn. `.splice` on this reference stays correct in the survive case (same object as the live
    // field) and is a harmless no-op on the detached snapshot in the death case.
    const bombs = victim.pendingBombs;
    const shrunk = bombs.length;
    for (let i = bombs.length - 1; i >= 0; i--) {
        const bomb = bombs[i];
        bomb.countdown -= turns;
        if (bomb.countdown > 0) continue;
        const burst =
            bomb.stacks *
            bomb.damagePerStack *
            bomb.affinityMult *
            (1 + bomb.detonationDamageModifier / 100);
        bus.emit({
            type: 'bomb-detonated',
            actorId: bomb.sourceId,
            victimId: victim.id,
            detonatorId,
            round,
            stacks: bomb.stacks,
            damage: burst,
        });
        if (forceDetonateBomb) {
            forceDetonateBomb(victim, bomb.sourceId, burst);
        } else {
            const shieldDrain = Math.min(victim.shieldPool, burst);
            victim.shieldPool -= shieldDrain;
            victim.currentHp = Math.max(0, victim.currentHp - (burst - shieldDrain));
        }
        bombs.splice(i, 1);
    }
    return shrunk;
}
