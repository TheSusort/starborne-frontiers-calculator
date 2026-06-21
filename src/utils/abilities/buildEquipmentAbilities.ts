/**
 * buildEquipmentAbilities
 *
 * Turns a ship's equipped gear sets + implants into a list of Ability objects
 * that the combat engine can consume.
 *
 * Gear-set abilities are resolved via GEAR_SET_ABILITIES (currently: Leech).
 * Implant abilities are resolved via IMPLANT_ABILITIES (currently: Bloodthirst).
 *
 * D-PR1 approach (registry, not text-parsing): effect values are baked from the
 * source data in implants.ts / gearSets.ts per the registries above. A variant's
 * `description` is used only as a PRESENCE gate (stat-only variants have none and are
 * skipped) — its text is NOT parsed. A future PR may add a text-parse path for
 * implants whose phrasing the skill parser can handle; until then, new effects need a
 * registry entry. Merged into the passive slot by buildShipAbilitiesWithEquipment.
 *
 * It is pure: no side effects, no throws out of the function.
 *
 * Modeling note: noCrit:true on the Leech set heal — a derived-from-damage leech
 * doesn't roll its own heal-crit; flagged as a modeling choice for reviewer confirmation.
 */

import { GEAR_SETS } from '../../constants/gearSets';
import { IMPLANTS } from '../../constants/implants';
import { GearPiece } from '../../types/gear';
import { Ability } from '../../types/abilities';
import { Ship } from '../../types/ship';

// ---------------------------------------------------------------------------
// Gear-set ability registry (D-PR1: Leech only)
// ---------------------------------------------------------------------------

const GEAR_SET_ABILITIES: Partial<Record<string, () => Omit<Ability, 'id'>>> = {
    LEECH: () => ({
        type: 'heal',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'heal', pct: 15, basis: 'damage-dealt', leechScope: 'all', noCrit: true },
        autoFilled: true,
    }),
};

// ---------------------------------------------------------------------------
// Implant ability registry (D-PR1: Bloodthirst only)
// ---------------------------------------------------------------------------
//
// Each entry maps an implant name to a per-rarity builder.  A builder returns
// an Ability (minus `id`) or undefined when the rarity is unsupported.

type ImplantAbilityBuilder = (rarity: string) => Omit<Ability, 'id'> | undefined;

const BLOODTHIRST_HEAL_PCT: Record<string, number> = {
    uncommon: 12,
    epic: 17,
    legendary: 20,
};

const BLOODTHIRST_PROC_CHANCE: Record<string, number> = {
    uncommon: 0.12,
    epic: 0.17,
    legendary: 0.2,
};

const IMPLANT_ABILITIES: Partial<Record<string, ImplantAbilityBuilder>> = {
    BLOODTHIRST: (rarity) => {
        const pct = BLOODTHIRST_HEAL_PCT[rarity];
        const procChance = BLOODTHIRST_PROC_CHANCE[rarity];
        if (pct === undefined) return undefined;
        return {
            type: 'heal',
            target: 'self',
            trigger: 'on-crit',
            conditions: [],
            procChance,
            config: {
                type: 'heal',
                pct,
                basis: 'damage-dealt',
            },
            autoFilled: true,
        };
    },
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Resolve a ship's active gear-set effects + implant effects into Ability[].
 *
 * @param ship          The ship whose equipment and implants to inspect.
 * @param getGearPiece  Inventory lookup — maps a gear id to a GearPiece (or undefined).
 */
export function buildEquipmentAbilities(
    ship: Ship,
    getGearPiece: (id: string) => GearPiece | undefined
): Ability[] {
    const abilities: Ability[] = [];

    // ------------------------------------------------------------------
    // 1. Active gear sets
    // ------------------------------------------------------------------
    // GEAR_SETS is a static constant — no runtime throws expected, so no per-set guard.
    const setCounts: Record<string, number> = {};
    for (const gearId of Object.values(ship.equipment ?? {})) {
        if (!gearId) continue;
        const piece = getGearPiece(gearId);
        if (!piece?.setBonus) continue;
        setCounts[piece.setBonus] = (setCounts[piece.setBonus] ?? 0) + 1;
    }

    for (const [setName, count] of Object.entries(setCounts)) {
        const minPieces = GEAR_SETS[setName]?.minPieces ?? 2;
        if (count < minPieces) continue;

        const builder = GEAR_SET_ABILITIES[setName];
        if (!builder) continue;

        const partial = builder();
        abilities.push({ id: `equip-set-${setName}`, ...partial });
    }

    // ------------------------------------------------------------------
    // 2. Implants
    // ------------------------------------------------------------------
    for (const gearId of Object.values(ship.implants ?? {})) {
        if (!gearId) continue;

        try {
            const piece = getGearPiece(gearId);
            if (!piece?.setBonus) continue;

            const implantName = piece.setBonus;
            const implantData = IMPLANTS[implantName];
            if (!implantData) continue;

            const variant = implantData.variants.find((v) => v.rarity === piece.rarity);
            if (!variant?.description) continue;

            // Try the per-implant builder first (handles cases the text parser can't).
            const builder = IMPLANT_ABILITIES[implantName];
            if (builder) {
                const partial = builder(piece.rarity);
                if (!partial) continue;
                abilities.push({
                    ...partial,
                    // Suffix the unique gear-piece id so two copies of the same implant get
                    // distinct ability ids — the proc-rate gate keys on (owner, ability.id),
                    // so a shared id would collapse independent procs into one gate.
                    id: `equip-implant-${implantName}-${gearId}`,
                });
                continue;
            }

            // For implants not in the registry: the description text could not be
            // reliably parsed for D-PR1 (the text parser lacks the "N% chance" proc-gate
            // stamping path for reactive triggers). Skip gracefully — no ability emitted,
            // no throw.
        } catch {
            // Per-piece errors never surface out of this function.
        }
    }

    return abilities;
}
