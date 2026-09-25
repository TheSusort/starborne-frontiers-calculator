import { isEquipmentSlotName } from '../../constants/gearTypes';
import { toRarityName } from '../../constants/rarities';
import { GearPiece } from '../../types/gear';

/**
 * The single coercion every stored gear read applies, whichever trust boundary it crosses (a
 * Supabase `inventory_items` row, the IndexedDB inventory cache, a sign-in migration or re-upload).
 * Keeps the piece — it is the player's own gear, so it is never dropped (#569, following the
 * ship policy in `normaliseShipIdentity`):
 * - `rarity` lowercases with a `'common'` fallback (`toRarityName`).
 * - `slot` and `setBonus` stay the raw stored strings (see `GearPiece.slot`'s doc). Nothing
 *   rewrites them. An unrecognised slot warns, since autogear then skips the piece; an
 *   unrecognised set is silent, like an unrecognised `Ship.faction` — it just grants no bonus.
 *
 * Idempotent: normalising an already-normalised piece returns the same values.
 */
/** A piece as JSON or a Supabase row can actually hold it — the coerced fields are unchecked. */
export type StoredGearPiece = Omit<GearPiece, 'slot' | 'rarity' | 'setBonus'> & {
    slot: unknown;
    rarity: unknown;
    setBonus: unknown;
};

export const normaliseGearFields = (piece: StoredGearPiece): GearPiece => {
    const slot = typeof piece.slot === 'string' ? piece.slot : '';
    const setBonus = typeof piece.setBonus === 'string' ? piece.setBonus : null;

    if (!isEquipmentSlotName(slot)) {
        console.warn(
            `Gear piece ${piece.id} has an unrecognised slot "${slot}"; ` +
                `it is kept but autogear will not use it.`
        );
    }

    return {
        ...piece,
        slot,
        setBonus,
        rarity: toRarityName(typeof piece.rarity === 'string' ? piece.rarity : ''),
    };
};
