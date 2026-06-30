import type { CombatLogRound, CombatLogEntry } from '../types';

/** Recursively collect an entry and all its nested reactions. */
function visitEntry(entry: CombatLogEntry, out: CombatLogEntry[]): void {
    out.push(entry);
    for (const re of entry.reactions) visitEntry(re, out);
}

/** All entries within one round: turn entries + their nested reactions + endOfRound. */
export function flattenRound(round: CombatLogRound): CombatLogEntry[] {
    const out: CombatLogEntry[] = [];
    for (const turn of round.turns) for (const e of turn.entries) visitEntry(e, out);
    for (const e of round.endOfRound) visitEntry(e, out);
    return out;
}

/** All entries across all rounds: turn entries + their nested reactions + endOfRound. */
export function flattenCombatLog(result: { combatLog: CombatLogRound[] }): CombatLogEntry[] {
    const out: CombatLogEntry[] = [];
    for (const round of result.combatLog) {
        for (const turn of round.turns) for (const e of turn.entries) visitEntry(e, out);
        for (const e of round.endOfRound) visitEntry(e, out);
    }
    return out;
}
