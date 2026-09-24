/**
 * A verbatim copy of `sharedAutogearBuildSchema` as it exists on `origin/production` at
 * `bd22289af845dd3736fa263aa77213e7cbf4912d` (1.68.0, `git show
 * origin/production:src/schemas/sharedAutogearBuild.ts`) — the schema the currently-deployed
 * bundle actually validates a `shared_config` row against. Only the four relative import paths
 * are re-pathed one level deeper (this file lives in `schemas/__fixtures__/`, the original in
 * `schemas/`); every other line, including comments, is unchanged.
 *
 * This exists so `sharedAutogearBuild.test.ts` can assert against the REAL deployed reader
 * rather than a description of it — a gitignored scratch copy of the same content would pass
 * here but fail on any other checkout or inside the pre-commit hook on a fresh worktree, so this
 * copy is committed instead. Re-generate it (and bump the SHA above) if production's schema ever
 * changes before this repo's `version: 1` writer stops needing to stay readable by it (#552).
 */
import { z } from 'zod';
import { STATS, DERIVED_STAT_LABELS } from '../../constants/stats';
import { GEAR_SETS } from '../../constants/gearSets';
import { IMPLANTS } from '../../constants/implants';
import { SHIP_TYPES } from '../../constants/shipTypes';

const isKeyOf = (record: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(record, key);

const statNameSchema = z.string().refine((v) => isKeyOf(STATS, v), { message: 'Unknown stat' });

const limitableStatSchema = z
    .string()
    .refine((v) => isKeyOf(STATS, v) || isKeyOf(DERIVED_STAT_LABELS, v), {
        message: 'Unknown limit stat',
    });

const gearSetKeySchema = z
    .string()
    .refine((v) => isKeyOf(GEAR_SETS, v), { message: 'Unknown gear set' });

const implantKeySchema = z
    .string()
    .refine((v) => isKeyOf(IMPLANTS, v), { message: 'Unknown implant' });

const shipRoleSchema = z
    .string()
    .refine((v) => isKeyOf(SHIP_TYPES, v), { message: 'Unknown ship role' });

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

const MAX_ARRAY_LENGTH = 50;

// Object schemas strip unknown keys by default (zod's .strip()), which is what
// we want for a foreign payload: sanitise rather than reject on an extra field.
export const productionSharedAutogearBuildSchema = z.object({
    version: z.literal(1),
    shipRole: shipRoleSchema,
    statPriorities: z.array(statPrioritySchema).max(MAX_ARRAY_LENGTH),
    setPriorities: z.array(setPrioritySchema).max(MAX_ARRAY_LENGTH),
    statBonuses: z.array(statBonusSchema).max(MAX_ARRAY_LENGTH),
    fleetBuffs: z.array(fleetBuffSchema).max(MAX_ARRAY_LENGTH),
    excludedImplantTypes: z.array(implantKeySchema).max(MAX_ARRAY_LENGTH),
    optimizeImplants: z.boolean(),
});

export const validateProductionSharedAutogearBuild = (raw: unknown) => {
    const result = productionSharedAutogearBuildSchema.safeParse(raw);
    return result.success ? result.data : null;
};
