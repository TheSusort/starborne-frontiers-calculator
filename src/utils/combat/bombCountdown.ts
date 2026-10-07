import type { CombatEventBus } from './events';
import { accumulatorBurstDamage, burstContainerWiped } from './state';
import type { CombatActor, PendingAccumulator, PendingBomb } from './state';
import type { DurationCutCandidate } from './statusEngine';

/**
 * Lingshe's charged skill: "reduces all Bomb on the enemy targets by 1 turn." Decrements EVERY
 * pending bomb on `victim` (or only the `only` one) by `turns`; any bomb reaching <= 0 detonates
 * IMMEDIATELY using the EXACT `processBombs` burst formula (engine.ts) — stacks * damagePerStack *
 * affinityMult * (1 + detonationDamageModifier / 100) — crediting the bomb's ORIGINAL applier (`bomb.sourceId`,
 * NOT this ability's caster) via a `bomb-detonated` bus emission (one event per detonating entry,
 * mirroring the enemy-turn `processBombs` shape) and, when `forceDetonateBomb` is supplied, the
 * SAME per-victim `applyVictimDamage` sink a natural detonation uses — so Barrier, Cheat-Death,
 * `destroyedRound`/`ship-destroyed`, and incoming-block/Lifeline all apply exactly as they would
 * to a natural countdown-0 burst (see `PlayerTurnArgs.forceDetonateBomb`'s doc comment). Absent
 * (no engine scope — standalone/unit-test callers), falls back to a bare shield-then-HP debit with
 * none of that. Deliberately NOT detonateContainers/detonate() — those credit the CASTER
 * unconditionally and consume the WHOLE container regardless of countdown.
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
    forceDetonateBomb?: (victim: CombatActor, sourceId: string, damage: number) => void,
    // Shrink this one bomb only (a single random duration cut, `bombDurationCutCandidates`);
    // absent → every bomb on the victim.
    only?: PendingBomb
): number {
    // Bind the array reference ONCE, exactly as the sibling `processBombs` does. A forced
    // detonation can reassign `victim.pendingBombs` under this loop in two ways, and
    // `burstContainerWiped` tells them apart. The burst KILLS the victim: the engine's
    // bomb-splash-on-death reassigns it to `[]`, and the walk goes on over this pre-death snapshot
    // so every countdown-0 bomb detonates, matching the natural burst on an actor's own turn
    // (interaction-audit FINDING-002: Lingshe + a multi-bomb planter). The burst triggers Cheat
    // Death: the victim lives at 1 HP with its Bombs wiped, so the walk stops and a wiped Bomb
    // never detonates. `.splice` on this reference stays correct in the survive case (same object
    // as the live field) and is a harmless no-op on the detached snapshot in the death case.
    const bombs = victim.pendingBombs;
    let shrunk = 0;
    for (let i = bombs.length - 1; i >= 0; i--) {
        if (burstContainerWiped(victim, bombs, victim.pendingBombs)) break;
        const bomb = bombs[i];
        if (only !== undefined && bomb !== only) continue;
        shrunk += 1;
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

/**
 * The Bomb half of a single random duration cut's pool (Warpstrike, owner ruling R35): one
 * candidate per Bomb STACK on `victim` (R26), dated by its `appliedSeq` (absent → 0). Cutting a
 * stack of a multi-stack Bomb splits it off as a one-stack copy (same `appliedSeq` and applier)
 * inserted after it, so the other stacks keep their countdown; the cut stack then goes through
 * `reduceBombsOnVictim` alone, and detonates if driven to 0 (the 2026-07-31 user-verified rule).
 */
export function bombDurationCutCandidates(
    victim: CombatActor,
    round: number,
    bus: CombatEventBus,
    detonatorId: string,
    forceDetonateBomb?: (victim: CombatActor, sourceId: string, damage: number) => void
): DurationCutCandidate[] {
    const bombs = victim.pendingBombs;
    const out: DurationCutCandidate[] = [];
    for (const bomb of bombs) {
        for (let s = 0; s < bomb.stacks; s++) {
            out.push({
                seq: bomb.appliedSeq ?? 0,
                cut: (turns) => {
                    const at = bombs.indexOf(bomb);
                    if (at < 0) return;
                    let cutStack = bomb;
                    if (bomb.stacks > 1) {
                        bomb.stacks -= 1;
                        cutStack = { ...bomb, stacks: 1 };
                        bombs.splice(at + 1, 0, cutStack);
                    }
                    reduceBombsOnVictim(
                        victim,
                        turns,
                        round,
                        bus,
                        detonatorId,
                        forceDetonateBomb,
                        cutStack
                    );
                },
            });
        }
    }
    return out;
}

/**
 * The Echoing Burst twin of `reduceBombsOnVictim`, for the duration cuts that reach every debuff
 * (Heliodor's / Pestilence's "reduces the duration of all active Debuffs"): takes `turns` off each
 * accumulator on `victim` (or only the `only` one). One driven to 0 BURSTS there and then, as its
 * natural expiry does (owner ruling R113): it pays `accumulatorBurstDamage` — what it has gathered
 * so far, since a cut is not the holder's turn start that gathers the round's damage — announced
 * as an `accumulator-detonated` with the applier as `actorId`, and lands through
 * `forceDetonate`, the engine's per-victim detonation sink credited to that applier. Absent (no
 * engine scope), a bare shield-then-HP debit. The walk stops once a burst's Cheat Death wipes
 * the container (`burstContainerWiped`). Returns the accumulators shortened; a non-positive /
 * non-finite `turns` → 0.
 */
export function reduceAccumulatorsOnVictim(
    victim: CombatActor,
    turns: number,
    round: number,
    bus: CombatEventBus,
    forceDetonate?: (victim: CombatActor, sourceId: string, damage: number) => void,
    // Shrink this one accumulator only (`accumulatorDurationCutCandidates`); absent → all.
    only?: PendingAccumulator
): number {
    const delta = Number.isFinite(turns) ? Math.trunc(turns) : 0;
    if (delta <= 0) return 0;
    const accs = victim.pendingAccumulators;
    let shrunk = 0;
    for (let i = accs.length - 1; i >= 0; i--) {
        if (burstContainerWiped(victim, accs, victim.pendingAccumulators)) break;
        const acc = accs[i];
        if (only !== undefined && acc !== only) continue;
        shrunk += 1;
        acc.roundsRemaining -= delta;
        if (acc.roundsRemaining > 0) continue;
        const damage = accumulatorBurstDamage(acc);
        bus.emit({
            type: 'accumulator-detonated',
            actorId: acc.sourceId,
            victimId: victim.id,
            round,
            damage,
        });
        if (forceDetonate) {
            forceDetonate(victim, acc.sourceId, damage);
        } else {
            const shieldDrain = Math.min(victim.shieldPool, damage);
            victim.shieldPool -= shieldDrain;
            victim.currentHp = Math.max(0, victim.currentHp - (damage - shieldDrain));
        }
        accs.splice(i, 1);
    }
    return shrunk;
}

/**
 * The Echoing Burst part of a single random duration cut's pool (Warpstrike, owner ruling R35):
 * one candidate per accumulator on `victim`, dated by its `appliedSeq` (absent → 0). The cut goes
 * through `reduceAccumulatorsOnVictim` for that accumulator alone, so one driven to 0 bursts
 * (owner ruling R113).
 */
export function accumulatorDurationCutCandidates(
    victim: CombatActor,
    round: number,
    bus: CombatEventBus,
    forceDetonate?: (victim: CombatActor, sourceId: string, damage: number) => void
): DurationCutCandidate[] {
    return victim.pendingAccumulators.map((acc) => ({
        seq: acc.appliedSeq ?? 0,
        cut: (turns) => {
            reduceAccumulatorsOnVictim(victim, turns, round, bus, forceDetonate, acc);
        },
    }));
}
