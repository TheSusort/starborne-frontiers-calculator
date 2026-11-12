import type { BattleResult } from '../calculators/battleSimulator';
import type { ActorTotals } from './seededRuns';

type Roster = BattleResult['roster'];
type Side = 'player' | 'enemy';

/** Whole number with thousands separators, the form every result number is shown in. */
export const formatWhole = (value: number): string => Math.round(value).toLocaleString('en-US');

/** A display name per actor. A name that appears more than once on one side gets a `#n` suffix in
 *  roster order, so its rows stay distinguishable; the same name on opposite sides is not a
 *  duplicate. */
export function rosterLabels(roster: Roster): Map<string, string> {
    const counts = new Map<string, number>();
    for (const entry of roster) {
        const key = `${entry.side}:${entry.name}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const entry of roster) {
        const key = `${entry.side}:${entry.name}`;
        const index = (seen.get(key) ?? 0) + 1;
        seen.set(key, index);
        labels.set(
            entry.actorId,
            (counts.get(key) ?? 0) > 1 ? `${entry.name} #${index}` : entry.name
        );
    }
    return labels;
}

export interface TopDamage {
    label: string;
    damage: number;
}

/** The highest `damageDealt` on each side, or `null` for a side with no rostered ship. */
export function topDamageBySide(
    roster: Roster,
    totalsByActor: Record<string, ActorTotals>
): Record<Side, TopDamage | null> {
    const labels = rosterLabels(roster);
    const top: Record<Side, TopDamage | null> = { player: null, enemy: null };
    for (const entry of roster) {
        const damage = totalsByActor[entry.actorId]?.damageDealt ?? 0;
        const current = top[entry.side];
        if (current === null || damage > current.damage) {
            top[entry.side] = { label: labels.get(entry.actorId) ?? entry.name, damage };
        }
    }
    return top;
}
