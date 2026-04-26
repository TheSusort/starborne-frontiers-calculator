import { z } from 'zod';

// Permissive on extra fields (.passthrough()) — the game format may add new
// keys we don't use, and we don't want to break imports when it does.
// We only validate the fields importPlayerData.ts actually reads.

const attributeStatSchema = z.object({
    Attribute: z.string(),
    Type: z.string(),
    Value: z.number(),
});

const statEntrySchema = z.object({
    Level: z.number(),
    Attribute: attributeStatSchema,
});

const statBlockSchema = z
    .object({
        Initiative: z.number(),
        HullPoints: z.number(),
        Power: z.number(),
        Defense: z.number(),
        Manipulation: z.number(),
        Security: z.number(),
        CritChance: z.number(),
        CritBoost: z.number(),
        DefensePenetration: z.number().optional().default(0),
        ShieldPenetration: z.number().optional().default(0),
    })
    .passthrough();

const unitSchema = z
    .object({
        Id: z.string(),
        Name: z.string(),
        Faction: z.string(),
        Rarity: z.string(),
        ShipType: z.string(),
        Affinity: z.string(),
        Rank: z.number(),
        Level: z.number(),
        Refit: z.number(),
        Attributes: z
            .object({
                BaseWithLevelAndRank: statBlockSchema,
                Refit: z.array(
                    z
                        .object({
                            Attribute: z.string(),
                            Type: z.string(),
                            Value: z.number(),
                        })
                        .passthrough()
                ),
            })
            .passthrough(),
        Skills: z.array(z.string()),
    })
    .passthrough();

const equipmentSchema = z
    .object({
        Id: z.string(),
        EquippedOnUnit: z.string().nullable(),
        Slot: z.string(),
        Level: z.number(),
        Rank: z.number(),
        Set: z.string(),
        Rarity: z.string(),
        Locked: z.boolean(),
        CalibratedForUnitId: z.string().nullable(),
        CalibrationLevel: z.number().nullable(),
        MainStats: z.array(statEntrySchema),
        SubStats: z.array(statEntrySchema),
    })
    .passthrough();

const engineeringSchema = z
    .object({
        Type: z.string(),
        Attribute: z.string(),
        ModifierType: z.string(),
        Level: z.number(),
    })
    .passthrough();

export const exportedPlayDataSchema = z.object({
    Units: z.array(unitSchema),
    Equipment: z.array(equipmentSchema),
    Engineering: z.array(engineeringSchema),
});

export type ValidatedExportedPlayData = z.infer<typeof exportedPlayDataSchema>;

export function validateExportedPlayData(raw: unknown):
    | {
          success: true;
          data: ValidatedExportedPlayData;
      }
    | {
          success: false;
          error: string;
      } {
    const result = exportedPlayDataSchema.safeParse(raw);
    if (result.success) {
        return { success: true, data: result.data };
    }

    const issues = result.error.issues;
    const first = issues[0];
    const path = first.path.join('.');
    const summary = `Invalid game data: ${path ? `${path} — ` : ''}${first.message}`;
    return {
        success: false,
        error: `${summary} (${issues.length} total issue${issues.length > 1 ? 's' : ''})`,
    };
}
