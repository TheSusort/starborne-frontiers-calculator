import { z } from 'zod';

/**
 * A restore file is user-supplied and crosses a trust boundary, so the sections
 * that feed typed consumers are validated before anything is written.
 *
 * DELIBERATELY PERMISSIVE. `InventoryProvider` and `reuploadLocalDataToSupabase`
 * need an array of objects that have an `id`; everything else they read is
 * optional or defaulted. Validating the full `GearPiece` shape here would reject
 * legitimate older backups whose gear predates a field, and a rejected section is
 * silently not restored — so an over-strict schema is itself a way to lose a
 * user's inventory. Tighten this only alongside a migration for the shapes it
 * would start rejecting.
 */
const backupGearSchema = z.looseObject({
    id: z.string().min(1),
});

export const backupInventorySchema = z.array(backupGearSchema);

/**
 * Returns the parsed inventory section, or null when the section is not a shape
 * the app can consume. Callers must skip a null section rather than cache it.
 */
export const parseBackupInventory = (raw: unknown): unknown[] | null => {
    const result = backupInventorySchema.safeParse(raw);
    return result.success ? (raw as unknown[]) : null;
};
