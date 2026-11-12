import { BOUNTY_BOSSES, parseBossShipId } from '../../constants/bountyBosses';
import type { BoardState } from '../../components/simulator/PlacementBoard';

/** Repeated names collapsed to "Name ×N", in order of first appearance. */
export function groupLabels(names: readonly string[]): string[] {
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
}

/** One label per distinct ship on a board: a boss by its name and level, everything else by name,
 *  duplicates grouped. */
export function setupChipLabels(board: BoardState): string[] {
    const names = Object.values(board).flatMap((placement) => {
        if (!placement) return [];
        const boss = parseBossShipId(placement.ship.id);
        const bossName = boss && BOUNTY_BOSSES.find((candidate) => candidate.id === boss.id)?.name;
        return [boss && bossName ? `${bossName} Lv ${boss.level}` : placement.ship.name];
    });
    return groupLabels(names);
}
