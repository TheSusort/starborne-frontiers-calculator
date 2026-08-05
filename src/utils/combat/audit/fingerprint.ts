import type { BattleResult } from '../../calculators/battleSimulator';
import type { CombatLogEntry, CombatLogEntryKind } from '../log/types';
import type { FingerprintDiff } from './types';

/** Recurse into an entry list AND every entry's nested `reactions`, collecting the `kind` of
 *  every entry whose `actorId` matches. Mirrors `collectActorEntryKinds` (scripts/lib/kitBundle.ts)
 *  but walks the multi-round `BattleResult.combatLog` instead of a single flat log. */
function walkEntries(
    entries: CombatLogEntry[],
    actorId: string,
    acc: Set<CombatLogEntryKind>
): void {
    for (const e of entries) {
        if (e.actorId === actorId) acc.add(e.kind);
        if (e.reactions?.length) walkEntries(e.reactions, actorId, acc);
    }
}

/** The behavior fingerprint of one actor across a whole battle: the SET of distinct
 *  combat-log entry kinds it produced, in any round, start-of-round/turn/end-of-round,
 *  including nested reactive entries. Pure over an already-run `BattleResult`. */
export function fingerprintActor(result: BattleResult, actorId: string): Set<CombatLogEntryKind> {
    const acc = new Set<CombatLogEntryKind>();
    for (const round of result.combatLog) {
        walkEntries(round.startOfRound, actorId, acc);
        for (const turn of round.turns) walkEntries(turn.entries, actorId, acc);
        walkEntries(round.endOfRound, actorId, acc);
    }
    return acc;
}

/** Compare a ship's solo fingerprint against its in-composition fingerprint. Returns null when
 *  they're identical (no interference detected); otherwise reports what the ship stopped doing
 *  (`missingInComposition` — suppressed) and what it started doing that it never does solo
 *  (`extraInComposition` — spurious), keyed by the composition-side actorId. */
export function diffFingerprints(
    shipName: string,
    actorId: string,
    solo: Set<CombatLogEntryKind>,
    comp: Set<CombatLogEntryKind>
): FingerprintDiff | null {
    const missing = [...solo].filter((k) => !comp.has(k));
    const extra = [...comp].filter((k) => !solo.has(k));
    if (missing.length === 0 && extra.length === 0) return null;
    return { actorId, shipName, missingInComposition: missing, extraInComposition: extra };
}

/**
 * Consumer-facing differential entry point (Task 10 calls this). Fingerprints `shipName` in
 * each already-run `BattleResult` — via its OWN actorId in that result, since a ship's actorId
 * in a composition run need not match its solo-run actorId (roster-assigned) — and diffs them.
 *
 * PURE: does not run battles. The caller is responsible for producing `soloResult` and
 * `compResult` via `runSeededBattle(_, seed)` under the SAME seed; otherwise this compares RNG
 * divergence, not real interference. Diagnostic's `actorId` is the composition-side id, since
 * that's where a reported ship must be located to reproduce/inspect the finding.
 */
/** Recurse into an entry list AND every entry's nested `reactions`, collecting the `kind[:slot]`
 *  token of every entry whose `actorId` matches. The slot half is what distinguishes a
 *  CAST-sourced effect from a passive/reactive one: `buildCombatLog` spreads
 *  `ctx.consumePendingSkill()` (which carries `{skillName, slot}`) onto cast entries only, so a
 *  passive entry has no `slot`. Without that split, a ship with two sources for the same kind
 *  (Malvex: an active-slot shield grant AND a passive on-damaged shield grant) fingerprints
 *  identically whether or not the active one is correctly gated. `skillName` is deliberately NOT
 *  part of the token — it is the ship's own skill name, so it carries nothing the ship key doesn't,
 *  and including it would churn snapshots on a cosmetic rename. */
function walkEntryTokens(entries: CombatLogEntry[], actorId: string, acc: Set<string>): void {
    for (const e of entries) {
        if (e.actorId === actorId) acc.add(e.slot ? `${e.kind}:${e.slot}` : e.kind);
        if (e.reactions?.length) walkEntryTokens(e.reactions, actorId, acc);
    }
}

/** The behaviour fingerprint of one actor across a whole battle, as a SORTED array of
 *  `kind[:slot]` tokens. Sorted so entry order can never churn a snapshot; de-duplicated because
 *  it is a set of behaviours, not a count. Pure over an already-run `BattleResult`.
 *
 *  A REFINEMENT of `fingerprintActor`, not a replacement — that function is consumed by
 *  `ablation.ts`'s differential oracle, which compares bare kind-sets, so it stays as-is. */
export function fingerprintActorTokens(result: BattleResult, actorId: string): string[] {
    const acc = new Set<string>();
    for (const round of result.combatLog) {
        walkEntryTokens(round.startOfRound, actorId, acc);
        for (const turn of round.turns) walkEntryTokens(turn.entries, actorId, acc);
        walkEntryTokens(round.endOfRound, actorId, acc);
    }
    return [...acc].sort();
}

export function runDifferential(
    soloResult: BattleResult,
    compResult: BattleResult,
    shipName: string,
    soloActorId: string,
    compActorId: string
): FingerprintDiff | null {
    const solo = fingerprintActor(soloResult, soloActorId);
    const comp = fingerprintActor(compResult, compActorId);
    return diffFingerprints(shipName, compActorId, solo, comp);
}
