import { z } from 'zod';
import { STATS, DERIVED_STAT_LABELS } from '../constants/stats';
import { GEAR_SETS } from '../constants/gearSets';
import { IMPLANTS } from '../constants/implants';
import { SHIP_TYPES } from '../constants/shipTypes';
import type { LimitableStat } from '../types/stats';
import type { BasisTerm, CustomFormula, RoleBasis } from '../types/autogear';
import type { SharedAutogearBuild } from '../types/communityRecommendation';
import {
    isBasisStat,
    formulaHasUsableRow,
    usableBasisTerms,
} from '../utils/autogear/customFormula';

// `key in RECORD` is unsafe here: these are plain objects, so 'toString' and
// friends would pass. Own-property only.
const isKeyOf = (record: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(record, key);

/** Real gear/base stats — valid for fleet buffs, which model an actual in-game buff on an
 *  actual stat. NOT used for stat bonuses; those accept derived stats too. */
const statNameSchema = z.string().refine((v) => isKeyOf(STATS, v), { message: 'Unknown stat' });

/** Base stats plus derived stats (effectiveHp, directDamage) — valid for stat priorities
 *  AND stat bonuses. A strict superset of statNameSchema, so widening a field to this
 *  never invalidates previously-stored data. */
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

// Non-nullable on its own; `shipRole` and `customFormula.seededFrom` each wrap it in
// `.nullable()`/`.optional()` at the point where null/absence is meaningful.
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
export const MAX_NUMBER_MAGNITUDE = 1e12;
export const MIN_NUMBER_MAGNITUDE = 1e-6;

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
    stat: limitableStatSchema,
    percentage: boundedNumberSchema,
    mode: z.enum(['additive', 'multiplier']).optional(),
});

const fleetBuffSchema = z.object({
    stat: statNameSchema,
    percentage: boundedNumberSchema,
});

/** A basis term's stat: must be a real `BaseStats` key the scorer can read a value for.
 *  `isBasisStat` is the scorer's own predicate (`usableBasis` in
 *  utils/autogear/customFormula.ts) — reused rather than re-derived so this schema can
 *  never accept a term the scorer would silently drop (a stat with no
 *  `MULTIPLIER_NORMALIZERS` entry, or `directDamage`/`effectiveHp`, which have an entry
 *  but are derived stats, not basis terms). */
const basisStatSchema = z
    .string()
    .refine((v) => isBasisStat(v as LimitableStat), { message: 'Invalid basis stat' });

// A handful of terms per row and rows per formula is already generous against real usage —
// `CUSTOM_FORMULA_SEEDS`' largest entry has 4 rows, and a derived basis carries at most a
// couple of factors — and keeps a maximal customFormula well under the payload's byte
// ceiling below. Raising these needs re-measuring against that ceiling, same as
// MAX_ARRAY_LENGTH. Exported (with MAX/MIN_NUMBER_MAGNITUDE above) so `basisTermDraft.ts`'s
// authoring validator enforces the SAME caps a saved equation will be checked against at share
// time — a player should never be able to save an equation this schema then refuses to share.
const MAX_FORMULA_ROWS = 8;
export const MAX_BASIS_TERMS = 5;

// A basis weight must be non-negative in addition to `boundedNumberSchema`'s finiteness —
// matching `usableBasis`'s own filter, so a term the scorer would silently drop (a negative
// or non-finite weight) is rejected here instead, on the way in.
const basisTermSchema = z.object({
    stat: basisStatSchema,
    weight: boundedNumberSchema.refine((v) => v >= 0, {
        message: 'Basis weight must be non-negative',
    }),
});

// The axis a `roleBasis` measures — mirrors `RoleBasis['produces']` in types/autogear.ts.
const basisProducesSchema = z.enum(['damage', 'repair', 'shield']);

// Ties this enum to `RoleBasis['produces']` at compile time: if that union gains or loses a
// member without a matching edit here, this assignment fails `tsc --noEmit` instead of the
// new axis silently failing to share (rejected as an unrecognised value, or — the other
// direction — no longer validated at all).
type AssertSameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _basisProducesTiedToRoleBasis: AssertSameUnion<
    z.infer<typeof basisProducesSchema>,
    RoleBasis['produces']
> = true;

// Reuses `usableBasisTerms`, the scorer's own gate (`priorityScore.ts` calls it on
// `roleBasis.terms` at score time), so a `roleBasis` this schema admits can never be one the
// scorer would silently treat as absent (an empty array, or every term weighing 0 — every
// individual term's stat/weight is already checked by `basisTermSchema` above).
const roleBasisSchema = z
    .object({
        produces: basisProducesSchema,
        terms: z.array(basisTermSchema).max(MAX_BASIS_TERMS),
    })
    .refine((data) => usableBasisTerms(data.terms as BasisTerm[]) !== undefined, {
        message: 'Role basis has no usable term',
    });

const coreImportanceSchema = z.union([z.literal(0.5), z.literal(1), z.literal(2)]);

// A basis on a row that isn't `kind: 'core'`/`direction: 'max'` is inert (the scorer's
// `usableBasis` only honours that combination) rather than corrupt, so it is not rejected
// here — only the basis's own entries are validated.
const customFormulaRowSchema = z.object({
    stat: limitableStatSchema,
    kind: z.enum(['core', 'bonus']),
    direction: z.enum(['max', 'min']),
    importance: coreImportanceSchema.optional(),
    percentage: boundedNumberSchema.optional(),
    basis: z.array(basisTermSchema).max(MAX_BASIS_TERMS).optional(),
});

const customFormulaSchema = z.object({
    rows: z.array(customFormulaRowSchema).max(MAX_FORMULA_ROWS),
    seededFrom: shipRoleSchema.optional(),
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
// Shared by both versions so the six build-shaping arrays never drift between them.
const buildListFields = {
    statPriorities: z.array(statPrioritySchema).max(MAX_ARRAY_LENGTH),
    setPriorities: z.array(setPrioritySchema).max(MAX_ARRAY_LENGTH),
    statBonuses: z.array(statBonusSchema).max(MAX_ARRAY_LENGTH),
    fleetBuffs: z.array(fleetBuffSchema).max(MAX_ARRAY_LENGTH),
    excludedImplantTypes: z.array(implantKeySchema).max(MAX_ARRAY_LENGTH),
    optimizeImplants: z.boolean(),
};

// A role build with no customFormula: non-null role, no `customFormula` key. This is the
// version production's live bundle (1.68.0, a single non-discriminated `z.object` with
// `version: z.literal(1)`) can read — that schema strips unknown keys by default, so an
// optional `roleBasis` here is fully forward-compatible: an old bundle reads every other field
// and silently drops the equation it has no reader for, rather than falling back to the legacy
// columns (see `configToSharedBuild`'s version choice, communityBuild.ts).
const sharedAutogearBuildV1Schema = z.object({
    version: z.literal(1),
    shipRole: shipRoleSchema,
    ...buildListFields,
    roleBasis: roleBasisSchema.optional(),
});

// Custom mode: `shipRole: null` plus a `customFormula`. `shipRole` non-null is still legal
// here too — Custom mode is what makes the difference, not the version number.
const sharedAutogearBuildV2Schema = z.object({
    version: z.literal(2),
    shipRole: shipRoleSchema.nullable(),
    ...buildListFields,
    customFormula: customFormulaSchema.optional(),
    roleBasis: roleBasisSchema.optional(),
});

const versionedSharedAutogearBuildSchema = z.discriminatedUnion('version', [
    sharedAutogearBuildV1Schema,
    sharedAutogearBuildV2Schema,
]);

// A build with neither a role nor a usable formula scores every candidate identically —
// `partitionScoreableShips` would class the importing ship as unscoreable and the optimizer
// would hand back arbitrary gear with no error. Only reachable on a v2 build: v1's `shipRole`
// is never null. `formulaHasUsableRow` is the scorer's own gate (utils/autogear/customFormula.ts)
// reused here so this check can never drift from what actually makes a formula scoreable.
export const sharedAutogearBuildSchema = versionedSharedAutogearBuildSchema.superRefine(
    (data, ctx) => {
        if (
            data.version === 2 &&
            !data.shipRole &&
            !formulaHasUsableRow(data.customFormula as CustomFormula | undefined)
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'A build needs either a ship role or a usable custom formula',
            });
        }
    }
);

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

/**
 * True when a `ZodIssue` from `sharedAutogearBuildSchema` is specifically about a basis's own
 * caps — more than `MAX_BASIS_TERMS` terms in a `roleBasis`/`customFormula` row's `basis`, or a
 * basis term's weight outside `boundedNumberSchema`'s magnitude window or its non-negative
 * requirement. Read by `code` and `path` only, never by `message`, so rewording a schema message
 * can never silently stop this from firing (or start firing on an unrelated issue).
 *
 * A basis-owned `weight`/array path always has a `terms` (roleBasis) or `basis` (custom formula
 * row) ancestor segment; every other bounded-number field on this schema (statPriority.weight,
 * statBonus/fleetBuff.percentage, customFormulaRow.percentage) does not, so this only classifies
 * an issue actually raised by a basis's own constraints.
 */
export const isSharedBuildBasisCapIssue = (issue: z.ZodIssue): boolean => {
    const { path, code } = issue;
    const last = path[path.length - 1];
    const hasBasisAncestor = path.some((segment) => segment === 'terms' || segment === 'basis');
    if (!hasBasisAncestor) return false;
    if ((last === 'terms' || last === 'basis') && code === z.ZodIssueCode.too_big) return true;
    return last === 'weight' && code === z.ZodIssueCode.custom;
};
