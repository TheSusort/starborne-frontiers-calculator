import { z } from 'zod';

// Permissive on extra fields (.passthrough()) — the game format may add new
// keys we don't use, and we don't want to break imports when it does.
// We only validate the fields importPlayerData.ts actually reads.

// Upper bounds on every array and string the import reads. These guard against a hostile or
// corrupt upload, not the game format: each is roughly 10x the largest real export measured
// (a whale account: ~2.8k units, ~12k equipment, 16 refit attributes, 21 skills, 4 substats,
// 82-char strings). Raise a bound if a real export ever trips it.
export const IMPORT_LIMITS = {
    units: 30_000,
    equipment: 150_000,
    engineering: 500,
    refitAttributes: 200,
    skills: 250,
    statsPerGear: 50,
    stringLength: 512,
} as const;

const boundedString = () => z.string().max(IMPORT_LIMITS.stringLength);

const attributeStatSchema = z.object({
    Attribute: boundedString(),
    Type: boundedString(),
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
        Id: boundedString(),
        Name: boundedString(),
        Faction: boundedString(),
        Rarity: boundedString(),
        ShipType: boundedString(),
        Affinity: boundedString(),
        Rank: z.number(),
        Level: z.number(),
        Refit: z.number(),
        Attributes: z
            .object({
                BaseWithLevelAndRank: statBlockSchema,
                Refit: z
                    .array(
                        z
                            .object({
                                Attribute: boundedString(),
                                Type: boundedString(),
                                Value: z.number(),
                            })
                            .passthrough()
                    )
                    .max(IMPORT_LIMITS.refitAttributes),
            })
            .passthrough(),
        Skills: z.array(boundedString()).max(IMPORT_LIMITS.skills),
    })
    .passthrough();

const equipmentSchema = z
    .object({
        Id: boundedString(),
        EquippedOnUnit: boundedString().nullable(),
        Slot: boundedString(),
        Level: z.number(),
        Rank: z.number(),
        Set: boundedString(),
        Rarity: boundedString(),
        Locked: z.boolean(),
        CalibratedForUnitId: boundedString().nullable(),
        CalibrationLevel: z.number().nullable(),
        MainStats: z.array(statEntrySchema).max(IMPORT_LIMITS.statsPerGear),
        SubStats: z.array(statEntrySchema).max(IMPORT_LIMITS.statsPerGear),
    })
    .passthrough();

const engineeringSchema = z
    .object({
        Type: boundedString(),
        Attribute: boundedString(),
        ModifierType: boundedString(),
        Level: z.number(),
    })
    .passthrough();

export const exportedPlayDataSchema = z.object({
    Units: z.array(unitSchema).max(IMPORT_LIMITS.units),
    Equipment: z.array(equipmentSchema).max(IMPORT_LIMITS.equipment),
    Engineering: z.array(engineeringSchema).max(IMPORT_LIMITS.engineering),
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
