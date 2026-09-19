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

/**
 * The ship with only the slots the pool can fill emptied.
 *
 * `applySuggestionsToShip` leaves a slot the suggestions do not name on its current piece, so a
 * slot with no eligible candidate keeps what is equipped in every real run. Clearing every slot
 * here instead would drop that contribution from the bounds but not from the landed values —
 * which is what `optimizeImplants: false`, the default, produces for every implant.
 */
const strippedToPool = (ship: Ship, poolSlots: ReadonlySet<string>): Ship => {
    const equipment = { ...ship.equipment };
    const implants = { ...ship.implants };
    for (const slot of poolSlots) {
        delete equipment[slot];
        delete implants[slot];
    }
    return { ...ship, equipment, implants };
};

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
 * Three contributions are deliberately outside this: SET BONUSES (which need a matching pair and
 * so are not a per-slot choice), the cross-stat ultimate implants (CODE_GUARD, CIPHER_LINK), and
 * `filterTopImplantsPerSlot`, which narrows the implant pool the GA actually searches below the
 * one seen here whenever `optimizeImplants` is set — that direction only makes the bounds wider
 * than the search, never narrower. A build can therefore land outside these bounds. They bound
 * the SEARCH SPACE well enough to band it; they are not a promise about what any particular run
 * returns.
 */
export function statBoundsFromInventory({
    ship,
    availableInventory,
    stat,
    deps,
}: StatBoundsArgs): StatBounds {
    const bare = strippedToPool(ship, new Set(availableInventory.map((piece) => piece.slot)));
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
