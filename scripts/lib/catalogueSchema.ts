/**
 * Zod schemas for the official unit catalogue (starborne.com/frontiers/units). Objects strip
 * unknown keys: only the fields named here are read downstream, so new upstream fields pass
 * through harmlessly while a removed or retyped field fails the parse.
 */
import { z } from 'zod';

export const segmentSchema = z.object({
    text: z.string(),
    effectId: z.string().optional(),
    color: z.string().optional(),
});
export type Segment = z.infer<typeof segmentSchema>;

const levelSchema = z.object({
    level: z.number().int(),
    kind: z.enum(['Active', 'Charged', 'Passive']),
    descriptionSegments: z.array(segmentSchema),
    chargesRequired: z.number().int().optional(),
});

const skillSchema = z.object({
    id: z.string(),
    levels: z.array(levelSchema).min(1),
});
export type CatalogueSkill = z.infer<typeof skillSchema>;

const statsSchema = z.object({
    HullPoints: z.number(),
    Power: z.number(),
    Defense: z.number(),
    Manipulation: z.number(),
    Security: z.number(),
    Initiative: z.number(),
    CritChance: z.number(),
    CritBoost: z.number(),
});

/** Mirrors `isAscensionStat` in src/utils/ship/referenceShip.ts (refit levels 0..6). */
const ascensionStatSchema = z.object({
    level: z.number().int().min(0).max(6),
    attribute: z.string(),
    type: z.string(),
    value: z.number(),
});

export const catalogueUnitSchema = z.object({
    id: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    rarity: z.string(),
    faction: z.string(),
    affinity: z.string(),
    role: z.string(),
    images: z.object({ avatar: z.string(), bigPortrait: z.string().optional() }),
    stats: statsSchema,
    ascensionStats: z.array(ascensionStatSchema),
    skills: z.array(skillSchema).min(1),
    ascensionSkills: z.array(skillSchema),
});
export type CatalogueUnit = z.infer<typeof catalogueUnitSchema>;

export const catalogueUnitPayloadSchema = z.object({ unit: catalogueUnitSchema });

export const manifestSchema = z.object({
    build: z.string(),
    gameVersion: z.string(),
    unitCount: z.number().int(),
    unitsSha256: z.string(),
    statusEffectsSha256: z.string(),
    localeSha256: z.object({ en: z.string() }),
});
export type CatalogueManifest = z.infer<typeof manifestSchema>;

export const indexDataSchema = z.object({
    buildId: z.string(),
    props: z.object({
        pageProps: z.object({
            manifest: manifestSchema,
            units: z
                .array(z.object({ id: z.string(), slug: z.string(), name: z.string() }))
                .min(1),
        }),
    }),
});
