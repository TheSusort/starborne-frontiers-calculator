import type { CombatEventBus } from './events';
import { accumulatorBurstDamage, bombBurstDamage, burstContainerWiped } from './state';
import type { CombatActor, PendingAccumulator, PendingBomb } from './state';
import type { DurationCutCandidate } from './statusEngine';

/**
 * Walks `holder`'s Bombs and Echoing Burst accumulators in ORDER OF APPLICATION — ascending
 * `appliedSeq` (absent → 0), Bombs before accumulators on an equal seq, each container in array
 * order — handing each entry to its container's step (a container with no step is not walked).
 * Bombs and Echoing Bursts that go off in the same step detonate in that order (R115).
 *
 * The containers are bound ONCE, before the walk. A step that bursts an entry splices it from the
 * bound array. A burst can reassign the live containers in two ways, and `burstContainerWiped`
 * tells them apart: the burst KILLS the holder (bomb-splash-on-death reassigns `pendingBombs` to
 * `[]`), and the walk goes on over the bound snapshot so every due entry still detonates; or the
 * burst triggers Cheat Death (the holder lives at 1 HP with both containers reassigned), and the
 * walk stops, so a wiped entry never detonates. A killed holder's Bombs still in the bound array
 * have already splashed at its death, so each one that is due detonates on it once and does not
 * splash again.
 */
export function walkTimedBurstsInApplicationOrder(
    holder: CombatActor,
    steps: {
        bomb?: (bomb: PendingBomb, bombs: PendingBomb[]) => void;
        accumulator?: (acc: PendingAccumulator, accs: PendingAccumulator[]) => void;
    }
): void {
    const bombs = holder.pendingBombs;
    const accs = holder.pendingAccumulators;
    type Item =
        | { seq: number; bomb: PendingBomb; acc?: undefined }
        | { seq: number; acc: PendingAccumulator; bomb?: undefined };
    const order: Item[] = [
        ...(steps.bomb ? bombs.map((bomb) => ({ seq: bomb.appliedSeq ?? 0, bomb })) : []),
        ...(steps.accumulator ? accs.map((acc) => ({ seq: acc.appliedSeq ?? 0, acc })) : []),
    ].sort((a, b) => a.seq - b.seq);
    for (const item of order) {
        if (
            burstContainerWiped(holder, bombs, holder.pendingBombs) ||
            burstContainerWiped(holder, accs, holder.pendingAccumulators)
        ) {
            break;
        }
        if (item.bomb) steps.bomb?.(item.bomb, bombs);
        else steps.accumulator?.(item.acc, accs);
    }
}

/** Removes `entry` from `container` if it is still there. */
export function spliceOut<T>(container: T[], entry: T): void {
    const at = container.indexOf(entry);
    if (at >= 0) container.splice(at, 1);
}

/**
 * Takes `turns` off one Bomb; one driven to <= 0 detonates there and then — see
 * `reduceBombsOnVictim` for the burst and its routing. Returns nothing; the caller counts.
 */
function cutBomb(
    victim: CombatActor,
    bombs: PendingBomb[],
    bomb: PendingBomb,
    turns: number,
    round: number,
    bus: CombatEventBus,
    detonatorId: string,
    forceDetonateBomb?: (victim: CombatActor, sourceId: string, damage: number) => void
): void {
    bomb.countdown -= turns;
    if (bomb.countdown > 0) return;
    const burst = bombBurstDamage(bomb);
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
    spliceOut(bombs, bomb);
}

/**
 * Takes `turns` off one accumulator; one driven to <= 0 bursts there and then — see
 * `reduceAccumulatorsOnVictim` for what it pays and how it lands.
 */
function cutAccumulator(
    victim: CombatActor,
    accs: PendingAccumulator[],
    acc: PendingAccumulator,
    turns: number,
    round: number,
    bus: CombatEventBus,
    forceDetonate?: (victim: CombatActor, sourceId: string, damage: number) => void
): void {
    acc.roundsRemaining -= turns;
    if (acc.roundsRemaining > 0) return;
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
    spliceOut(accs, acc);
}

/**
 * Lingshe's charged skill: "reduces all Bomb on the enemy targets by 1 turn." Decrements EVERY
 * pending bomb on `victim` (or only the `only` one) by `turns`; any bomb reaching <= 0 detonates
 * IMMEDIATELY for `bombBurstDamage`, the same payout as its natural expiry — crediting the bomb's
 * ORIGINAL applier (`bomb.sourceId`,
 * NOT this ability's caster) via a `bomb-detonated` bus emission (one event per detonating entry,
 * mirroring the enemy-turn `processBombs` shape) and, when `forceDetonateBomb` is supplied, the
 * SAME per-victim `applyVictimDamage` sink a natural detonation uses — so Barrier, Cheat-Death,
 * `destroyedRound`/`ship-destroyed`, and incoming-block/Lifeline all apply exactly as they would
 * to a natural countdown-0 burst (see `PlayerTurnArgs.forceDetonateBomb`'s doc comment). Absent
 * (no engine scope — standalone/unit-test callers), falls back to a bare shield-then-HP debit with
 * none of that. Deliberately NOT detonateContainers/detonate() — those credit the CASTER
 * unconditionally and consume the WHOLE container regardless of countdown.
 *
 * A Bomb is a Debuff, so a generic duration cut reaches it too, and one driven to 0 turns explodes
 * exactly like Lingshe's forced reduction (the per-Bomb step `cutBomb`). Bombs driven to 0
 * together detonate in order of application. Returns the number of bombs it shrank so the caller
 * can fold them into its "-N turn on X debuffs" tally.
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
    let shrunk = 0;
    walkTimedBurstsInApplicationOrder(victim, {
        bomb: (bomb, bombs) => {
            if (only !== undefined && bomb !== only) return;
            shrunk += 1;
            cutBomb(victim, bombs, bomb, turns, round, bus, detonatorId, forceDetonateBomb);
        },
    });
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
 * The Echoing Burst twin of `reduceBombsOnVictim`, for a duration cut that reaches an Echoing
 * Burst: takes `turns` off each accumulator on `victim` (or only the `only` one). One driven to 0
 * BURSTS there and then, as its natural expiry does (owner ruling R113), paying
 * `accumulatorBurstDamage` on everything gathered up to the cut — every direct hit the holder
 * took since the accumulator was applied (`gatherDirectHitIntoAccumulators`). The burst is
 * announced as an `accumulator-detonated` with the applier as `actorId` and lands through
 * `forceDetonate`, the engine's per-victim detonation sink credited to that applier. Absent (no
 * engine scope), a bare shield-then-HP debit. Several driven to 0 together burst in
 * order of application, and a Cheat Death one of them triggers stops the rest
 * (`walkTimedBurstsInApplicationOrder`). Returns the accumulators shortened; a non-positive /
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
    let shrunk = 0;
    walkTimedBurstsInApplicationOrder(victim, {
        accumulator: (acc, accs) => {
            if (only !== undefined && acc !== only) return;
            shrunk += 1;
            cutAccumulator(victim, accs, acc, delta, round, bus, forceDetonate);
        },
    });
    return shrunk;
}

/**
 * Heliodor's / Pestilence's "reduces the duration of all active Debuffs … by 1 turn" over the
 * timed-burst containers: takes `turns` off every Bomb (as `reduceBombsOnVictim`) and every Echoing
 * Burst accumulator (as `reduceAccumulatorsOnVictim`) on `victim` in ONE walk, so the ones driven
 * to 0 detonate in order of application whichever container they sit in (owner ruling R115), and
 * a Cheat Death the first of them triggers wipes the rest before they go off. Returns the Bombs
 * plus accumulators shortened; a non-positive / non-finite `turns` → 0.
 */
export function shortenTimedBurstsOnVictim(
    victim: CombatActor,
    turns: number,
    round: number,
    bus: CombatEventBus,
    detonatorId: string,
    forceDetonate?: (victim: CombatActor, sourceId: string, damage: number) => void
): number {
    const delta = Number.isFinite(turns) ? Math.trunc(turns) : 0;
    if (delta <= 0) return 0;
    let shrunk = 0;
    walkTimedBurstsInApplicationOrder(victim, {
        bomb: (bomb, bombs) => {
            shrunk += 1;
            cutBomb(victim, bombs, bomb, delta, round, bus, detonatorId, forceDetonate);
        },
        accumulator: (acc, accs) => {
            shrunk += 1;
            cutAccumulator(victim, accs, acc, delta, round, bus, forceDetonate);
        },
    });
    return shrunk;
}

/**
 * The Echoing Burst part of a single random duration cut's pool (Warpstrike, owner ruling R35):
 * one candidate per accumulator on `victim`, dated by its `appliedSeq` (absent → 0). The cut goes
 * through `reduceAccumulatorsOnVictim` for that accumulator alone, so one driven to 0 bursts
 * (owner ruling R113) on everything gathered up to the cut.
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
