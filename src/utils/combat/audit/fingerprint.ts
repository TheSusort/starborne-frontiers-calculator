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
