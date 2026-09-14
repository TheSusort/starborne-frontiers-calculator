import { z } from 'zod';
import { SQUAD_LEADERS } from '../constants/squadLeaders';
import { OVERRIDABLE_STATS, OVERRIDE_MIN } from '../utils/simulator/statOverrides';
import { ALL_POSITIONS } from '../utils/targeting/board';
import {
    SETUP_NAME_MAX_LENGTH,
    SIMULATOR_SETUP_VERSION,
    type SimulatorSetup,
} from '../utils/simulator/simulatorSetup';
import { MAX_RUN_COUNT, MIN_RUN_COUNT } from '../utils/simulator/seedRunInputs';

// `z.record` over an enum key is EXHAUSTIVE — it requires every key present. A board and an
// override set are both sparse by design, so both take `partialRecord`.
/** Far above any stat the game produces, and low enough that a restored setup cannot make the
 *  engine do arithmetic on absurd magnitudes. */
const MAX_OVERRIDE_VALUE = 1e9;

// Bounded to what the stat editor itself can produce. A stored override is user-editable, and it
// flows straight into the engine, where a below-floor value produces a meaningless fight with no
// error — an actor built at 0 HP starts on the corpse path.
const overridesSchema = z
    .partialRecord(
        z.enum(OVERRIDABLE_STATS),
        z.number().finite().nonnegative().max(MAX_OVERRIDE_VALUE)
    )
    .refine(
        (overrides) =>
            Object.entries(overrides ?? {}).every(
                ([stat, value]) =>
                    value === undefined ||
                    value >= (OVERRIDE_MIN[stat as keyof typeof OVERRIDE_MIN] ?? 0)
            ),
        { message: 'Override below the stat floor' }
    )
    .optional();

const placementSchema = z.object({
    shipId: z.string().min(1).max(200),
    overrides: overridesSchema,
});

const boardSchema = z.partialRecord(z.enum(ALL_POSITIONS), placementSchema);

// `key in SQUAD_LEADERS` would admit 'toString'; own-property only, matching
// sharedAutogearBuild.ts.
const isKeyOf = (record: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(record, key);

const squadLeaderSchema = z
    .object({
        faction: z.string(),
        name: z.string(),
        stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .refine(
        (value) =>
            isKeyOf(SQUAD_LEADERS, value.faction) &&
            !!SQUAD_LEADERS[value.faction]?.some((leader) => leader.name === value.name),
        { message: 'Unknown squad leader' }
    )
    .optional();

const setupSchema = z.object({
    version: z.literal(SIMULATOR_SETUP_VERSION),
    name: z.string().min(1).max(SETUP_NAME_MAX_LENGTH),
    playerBoard: boardSchema,
    enemyBoard: boardSchema,
    playerSquadLeader: squadLeaderSchema,
    enemySquadLeader: squadLeaderSchema,
    // The same bounds `clampSeed` and `clampRunCount` enforce on the controls. Stored values do
    // not pass through those clamps on the way back in, and an out-of-range run count restores a
    // sweep-sized workload onto a button the user thinks runs one fight.
    seed: z
        .number()
        .int()
        .min(0)
        .max(2 ** 31 - 1),
    runCount: z.number().int().min(MIN_RUN_COUNT).max(MAX_RUN_COUNT),
    savedAt: z.number().finite(),
});

/** `null` for anything a stored setup must not become: a wrong version, an unknown position or
 *  override stat, a leader this build no longer ships. A rejected value is discarded, never
 *  repaired — a partially-valid setup would load a board that looks complete and is not. */
export function parseSimulatorSetup(value: unknown): SimulatorSetup | null {
    const result = setupSchema.safeParse(value);
    return result.success ? result.data : null;
}

/** One bad entry drops only itself; the rest of a saved list survives. */
export function parseSimulatorSetupList(value: unknown): SimulatorSetup[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        const parsed = parseSimulatorSetup(entry);
        return parsed ? [parsed] : [];
    });
}
