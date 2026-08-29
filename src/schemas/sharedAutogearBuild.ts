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

/** Gear set keys only — used by setPriorities entries with no `kind` (or `kind: undefined`). */
const gearSetKeySchema = z
    .string()
    .refine((v) => isKeyOf(GEAR_SETS, v), { message: 'Unknown gear set' });

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

// Gear-set keys and implant keys share the setPriorities list, disambiguated by
// `kind`: an entry with no `kind` (or `kind: undefined`) must name a gear set,
// and `kind: 'implant'` must name an implant — GEAR_SETS and IMPLANTS keys are
// not disjoint (e.g. 'AMBUSH' exists in both), so `kind` — not the key alone —
// decides which inventory a requirement is checked against.
const setPrioritySchema = z.union([
    z.object({
        setName: gearSetKeySchema,
        count: z.number().int().min(0).max(6),
        kind: z.undefined().optional(),
    }),
    z.object({
        setName: implantKeySchema,
        count: z.number().int().min(0).max(6),
        kind: z.literal('implant'),
    }),
]);

const statBonusSchema = z.object({
    stat: statNameSchema,
    percentage: z.number(),
    mode: z.enum(['additive', 'multiplier']).optional(),
});

const fleetBuffSchema = z.object({
    stat: statNameSchema,
    percentage: z.number(),
});

// Cardinality guard, not a business rule: this table's INSERT policy admits any
// authenticated user and SELECT is public, so a hostile row can otherwise carry
// an array of any length — every element here is individually valid, so shape
// checks alone don't stop it. The bound is deliberately set well above any
// configuration the real UI can produce (setPriorities alone covers all 27
// GEAR_SETS keys plus implants, and fleetBuffs has no natural ceiling since
// duplicate-stat buffs from stacking sources are legitimate) — it exists only
// to cap the row size any viewer has to validate and render, not to reject a
// real build.
const MAX_ARRAY_LENGTH = 50;

// Object schemas strip unknown keys by default (zod's .strip()), which is what
// we want for a foreign payload: sanitise rather than reject on an extra field.
export const sharedAutogearBuildSchema = z.object({
    version: z.literal(1),
    shipRole: shipRoleSchema,
    statPriorities: z.array(statPrioritySchema).max(MAX_ARRAY_LENGTH),
    setPriorities: z.array(setPrioritySchema).max(MAX_ARRAY_LENGTH),
    statBonuses: z.array(statBonusSchema).max(MAX_ARRAY_LENGTH),
    fleetBuffs: z.array(fleetBuffSchema).max(MAX_ARRAY_LENGTH),
    excludedImplantTypes: z.array(implantKeySchema).max(MAX_ARRAY_LENGTH),
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
