/**
 * Read the per-victim damage-dealt accounting off a `runCombat` result.
 *
 * `RoundData.perTargetDealt` is `attackerId -> victimId -> dealt` and is set only when non-empty, so
 * every reader has to walk rounds and default the missing levels. Against a real, positioned
 * opposing roster this is where a reactive-damage proc books its intake (engine.ts's
 * applyReactiveDamage → `creditDealt`), instead of on the credit-only `creditDamage` channel that
 * `__testTapCreditDamage` observes — so tests migrating an assertion between those two channels read
 * one of these.
 */
import type { RoundData } from '../../calculators/dpsSimulator';

export interface DealtEntry {
    sourceId: string;
    victimId: string;
    amount: number;
}

/** Every (source, victim, amount) triple across all rounds, in round order. */
export function dealtEntries(rounds: readonly RoundData[]): DealtEntry[] {
    const out: DealtEntry[] = [];
    for (const round of rounds) {
        for (const [sourceId, byVictim] of Object.entries(round.perTargetDealt ?? {})) {
            for (const [victimId, amount] of Object.entries(byVictim)) {
                out.push({ sourceId, victimId, amount });
            }
        }
    }
    return out;
}

/** Total dealt by `sourceId` across all victims and rounds (0 when it dealt nothing). */
export function dealtBy(rounds: readonly RoundData[], sourceId: string): number {
    return dealtEntries(rounds)
        .filter((e) => e.sourceId === sourceId)
        .reduce((sum, e) => sum + e.amount, 0);
}

/** Total dealt per source id across all victims and rounds. */
export function dealtBySource(rounds: readonly RoundData[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const e of dealtEntries(rounds)) {
        out.set(e.sourceId, (out.get(e.sourceId) ?? 0) + e.amount);
    }
    return out;
}
