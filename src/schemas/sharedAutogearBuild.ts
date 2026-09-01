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

// Magnitude guard on every number that crosses this trust boundary. A bare
// `z.number()` admits Number.MAX_VALUE, and Postgres stores jsonb numbers as
// `numeric` whose text output NEVER uses exponent notation: 1.7976931348623157e+308
// arrives as 23 characters and is served back to every viewer as 309, and 1e-308
// expands to ~326 characters of zeros. So an extreme-magnitude number is a payload
// amplifier — 250 of them (the array bounds below allow that) turn a ~20 KB build
// into ~90 KB on the wire.
//
// This window keeps the client's byte measurement and the database's within a
// hair of each other, which is what lets both layers share one 64 KB bound (see
// MAX_ARRAY_LENGTH below). 1e12 is a thousand times any real effectiveHp limit,
// and 1e-6 is far below any weight the UI can express, so nothing legitimate is
// near either edge. `.finite()` additionally rejects Infinity, which plain
// `z.number()` lets through (NaN it already rejects).
const MAX_NUMBER_MAGNITUDE = 1e12;
const MIN_NUMBER_MAGNITUDE = 1e-6;

const boundedNumberSchema = z
    .number()
    .finite()
    .refine((v) => Math.abs(v) <= MAX_NUMBER_MAGNITUDE, { message: 'Number magnitude too large' })
    .refine((v) => v === 0 || Math.abs(v) >= MIN_NUMBER_MAGNITUDE, {
        message: 'Number magnitude too small',
    });

const statPrioritySchema = z.object({
    stat: limitableStatSchema,
    weight: boundedNumberSchema.optional(),
    minLimit: boundedNumberSchema.optional(),
    maxLimit: boundedNumberSchema.optional(),
    hardRequirement: z.boolean().optional(),
});

// Gear-set keys and implant keys share the setPriorities list, disambiguated by
// `kind`: an entry with no `kind` (or `kind: undefined`) must name a gear set,
// and `kind: 'implant'` must name an implant — GEAR_SETS and IMPLANTS keys are
// not disjoint (e.g. 'AMBUSH' exists in both), so `kind` — not the key alone —
// decides which inventory a requirement is checked against.
// `count` is optional: a legacy recommendation row written before piece
// counts were captured has no recorded value (real production example:
// `[{ setName: 'DECIMATION' }]`). The decision is to display those without a
// count rather than invent one — see SharedSetPriority. The new write path
// (configToSharedBuild) always supplies a real count, so this is purely
// additive there.
const countSchema = z.number().int().min(0).max(6).optional();

const setPrioritySchema = z.union([
    z.object({
        setName: gearSetKeySchema,
        count: countSchema,
        kind: z.undefined().optional(),
    }),
    z.object({
        setName: implantKeySchema,
        count: countSchema,
        kind: z.literal('implant'),
    }),
]);

const statBonusSchema = z.object({
    stat: statNameSchema,
    percentage: boundedNumberSchema,
    mode: z.enum(['additive', 'multiplier']).optional(),
});

const fleetBuffSchema = z.object({
    stat: statNameSchema,
    percentage: boundedNumberSchema,
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
//
// Paired with a database-side size bound (issue #431):
// 20260901000001_bound_community_recommendation_payload_size.sql CHECKs
// octet_length(col::text) <= 65536 on shared_config and the three legacy jsonb
// columns, because this bound protects the DOM while `select('*')` still
// transfers a hostile row to every viewer.
//
// Both layers count the same thing — bytes of JSON text — which is only true
// because MAX_NUMBER_MAGNITUDE keeps Postgres' exponent-free numeric rendering
// from inflating the payload. Do not raise MAX_ARRAY_LENGTH or loosen the number
// window without re-measuring against that bound: sharedAutogearBuild.test.ts
// fails if the largest payload this schema admits creeps past half of it.
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
