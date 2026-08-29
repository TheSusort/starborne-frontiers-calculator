import { z } from 'zod';
import { STATS, DERIVED_STAT_LABELS } from '../constants/stats';
import { GEAR_SETS } from '../constants/gearSets';
import { IMPLANTS } from '../constants/implants';
import { SHIP_TYPES } from '../constants/shipTypes';
import type { SharedAutogearBuild } from '../types/communityRecommendation';

// `key in RECORD` is unsafe here: these are plain objects, so 'toString' and
// friends would pass. Own-property only.
const isKeyOf = (record: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(record, key);

/** Real gear/base stats — valid for stat bonuses and fleet buffs. */
const statNameSchema = z.string().refine((v) => isKeyOf(STATS, v), { message: 'Unknown stat' });

/** Base stats plus derived limit stats (effectiveHp) — valid for stat priorities. */
const limitableStatSchema = z
    .string()
    .refine((v) => isKeyOf(STATS, v) || isKeyOf(DERIVED_STAT_LABELS, v), {
        message: 'Unknown limit stat',
    });

/** Gear set keys and implant keys share the setPriorities list (kind: 'implant'). */
const setNameSchema = z
    .string()
    .refine((v) => isKeyOf(GEAR_SETS, v) || isKeyOf(IMPLANTS, v), { message: 'Unknown set' });

const implantKeySchema = z
    .string()
    .refine((v) => isKeyOf(IMPLANTS, v), { message: 'Unknown implant' });

const shipRoleSchema = z
    .string()
    .refine((v) => isKeyOf(SHIP_TYPES, v), { message: 'Unknown ship role' });

const statPrioritySchema = z.object({
    stat: limitableStatSchema,
    weight: z.number().optional(),
    minLimit: z.number().optional(),
    maxLimit: z.number().optional(),
    hardRequirement: z.boolean().optional(),
});

const setPrioritySchema = z.object({
    setName: setNameSchema,
    count: z.number().int().min(0).max(6),
    kind: z.literal('implant').optional(),
});

const statBonusSchema = z.object({
    stat: statNameSchema,
    percentage: z.number(),
    mode: z.enum(['additive', 'multiplier']).optional(),
});

const fleetBuffSchema = z.object({
    stat: statNameSchema,
    percentage: z.number(),
});

// Object schemas strip unknown keys by default (zod's .strip()), which is what
// we want for a foreign payload: sanitise rather than reject on an extra field.
export const sharedAutogearBuildSchema = z.object({
    version: z.literal(1),
    shipRole: shipRoleSchema,
    statPriorities: z.array(statPrioritySchema),
    setPriorities: z.array(setPrioritySchema),
    statBonuses: z.array(statBonusSchema),
    fleetBuffs: z.array(fleetBuffSchema),
    excludedImplantTypes: z.array(implantKeySchema),
    optimizeImplants: z.boolean(),
});

/**
 * Validate an untrusted shared build. Returns null rather than throwing —
 * callers fall back to the legacy columns or drop the row.
 *
 * This runs on every row read from `community_recommendations.shared_config`,
 * which is authored by other users and ends up in the autogear engine.
 */
export const validateSharedAutogearBuild = (raw: unknown): SharedAutogearBuild | null => {
    const result = sharedAutogearBuildSchema.safeParse(raw);
    return result.success ? (result.data as SharedAutogearBuild) : null;
};
