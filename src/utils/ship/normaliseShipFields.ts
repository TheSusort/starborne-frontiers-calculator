import { RarityName, toRarityName } from '../../constants/rarities';
import { ShipTypeName, isShipTypeName, toShipTypeName } from '../../constants/shipTypes';
import { toAffinityName } from '../../constants/affinities';
import { AffinityName, Ship } from '../../types/ship';

/** The fields this coerces, plus `id`/`name` for the fallback-type warning. Matches both a raw
 *  Supabase row (`RawShipData`, whose `rarity`/`type`/`affinity` are untyped `string`/`string |
 *  null` columns) and a `Ship` loaded from localStorage — JSON has no way to enforce `Ship`'s
 *  narrower field types at rest, so a stored value can carry the same raw shape as a DB row. */
export interface RawShipIdentityFields {
    id: string;
    name: string;
    rarity: string;
    type: string;
    affinity?: string | null;
}

interface NormalisedShipIdentity {
    rarity: RarityName;
    type: ShipTypeName;
    affinity: AffinityName | undefined;
}

/**
 * The single rarity/type/affinity coercion every ship read applies, whichever trust boundary it
 * crosses (a Supabase row, a `StorageKey.SHIPS` localStorage read, a JSON backup restore). Keeps
 * the ship — the #565 policy — rather than dropping it: `rarity` lowercases with a `'common'`
 * fallback, `type` uppercases with an `'ATTACKER'` fallback (warning, since it changes autogear's
 * scoring formula for that ship), `affinity` becomes `undefined` when unreadable rather than
 * fabricated. `faction` is untouched; it stays the raw stored string (see `RawShipData`'s doc).
 */
export const normaliseShipIdentity = (ship: RawShipIdentityFields): NormalisedShipIdentity => {
    const rawType = String(ship.type ?? '');
    if (!isShipTypeName(rawType.toUpperCase())) {
        console.warn(
            `Ship "${ship.name}" (${ship.id}) has an unrecognised type "${ship.type}"; ` +
                `defaulting to ATTACKER. Its autogear scoring is wrong until the stored ` +
                `type is corrected.`
        );
    }

    return {
        rarity: toRarityName(String(ship.rarity ?? '')),
        type: toShipTypeName(rawType),
        affinity: toAffinityName(ship.affinity ?? null),
    };
};

/**
 * Applies `normaliseShipIdentity` to an already-Ship-shaped value — the localStorage read
 * (`ShipsContext`'s unauthenticated path) and `migratePlayerData`/`reuploadLocalDataToSupabase`,
 * none of which go through `transformShipData`'s Supabase-row construction. Idempotent:
 * normalising an already-normalised ship returns the same values.
 */
export const normaliseShipFields = (ship: Ship): Ship => ({
    ...ship,
    ...normaliseShipIdentity(ship),
});
