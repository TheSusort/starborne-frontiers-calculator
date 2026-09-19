import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { GearSuggestion } from '../../../types/autogear';
import type { LimitableStat } from '../../../types/stats';
import type { CombatStatsDeps } from '../../ship/combatStats';
import { shipFinalStats } from '../../ship/combatStats';
import { resolveLimitStatValue } from '../priorityScore';
import { applySuggestionsToShip } from './candidateShip';

export interface StatBounds {
    /** The lowest value of the tuned stat a loadout drawn from this pool reaches. */
    floor: number;
    /** The highest value of the tuned stat a loadout drawn from this pool reaches. */
    ceiling: number;
}

export interface StatBoundsArgs {
    ship: Ship;
    /** The pool the optimizer itself would draw from — `availableInventoryForShip`'s output,
     *  never the raw inventory, or the bounds describe gear no run can equip. */
    availableInventory: readonly GearPiece[];
    stat: LimitableStat;
    /** `getGearPiece` must be the RUN's own getter (upgraded-stats and assumed-calibration
     *  already applied), so the bounds describe the same pieces the run will score. */
    deps: CombatStatsDeps;
}

const stripped = (ship: Ship): Ship => ({ ...ship, equipment: {}, implants: {} });

const suggestion = (slotName: string, gearId: string): GearSuggestion => ({
    slotName,
    gearId,
    score: 0,
});

/**
 * The range of `stat` a loadout built from `availableInventory` can reach.
 *
 * Each piece belongs to exactly one slot and `calculateTotalStats` resolves a gear percentage
 * against the PRE-GEAR stat block, so one piece's contribution to `stat` never depends on what
 * fills the other slots. That makes per-slot extremes compose: the cheapest piece in every slot
 * is a real buildable loadout and its value is the floor, and the same for the ceiling.
 *
 * Two contributions are deliberately outside this: SET BONUSES (which need a matching pair and
 * so are not a per-slot choice) and the cross-stat ultimate implants (CODE_GUARD, CIPHER_LINK).
 * A build can therefore land slightly outside these bounds. They bound the SEARCH SPACE well
 * enough to band it; they are not a promise about what any particular run returns.
 */
export function statBoundsFromInventory({
    ship,
    availableInventory,
    stat,
    deps,
}: StatBoundsArgs): StatBounds {
    const bare = stripped(ship);
    const baseline = resolveLimitStatValue(shipFinalStats(bare, deps), stat);

    const valueWith = (slotName: string, gearId: string): number =>
        resolveLimitStatValue(
            shipFinalStats(applySuggestionsToShip(bare, [suggestion(slotName, gearId)]), deps),
            stat
        );

    interface SlotExtremes {
        lowest: { id: string; contribution: number };
        highest: { id: string; contribution: number };
    }
    const bySlot = new Map<string, SlotExtremes>();
    for (const piece of availableInventory) {
        const entry = { id: piece.id, contribution: valueWith(piece.slot, piece.id) - baseline };
        const current = bySlot.get(piece.slot);
        if (!current) {
            bySlot.set(piece.slot, { lowest: entry, highest: entry });
            continue;
        }
        if (entry.contribution < current.lowest.contribution) current.lowest = entry;
        if (entry.contribution > current.highest.contribution) current.highest = entry;
    }

    const extremes = [...bySlot.entries()];
    const evaluate = (picks: GearSuggestion[]): number =>
        resolveLimitStatValue(shipFinalStats(applySuggestionsToShip(bare, picks), deps), stat);

    return {
        floor: evaluate(extremes.map(([slot, picks]) => suggestion(slot, picks.lowest.id))),
        ceiling: evaluate(extremes.map(([slot, picks]) => suggestion(slot, picks.highest.id))),
    };
}
