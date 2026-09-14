import { z } from 'zod';
import { SQUAD_LEADERS } from '../constants/squadLeaders';
import { OVERRIDABLE_STATS } from '../utils/simulator/statOverrides';
import { ALL_POSITIONS } from '../utils/targeting/board';
import { SIMULATOR_SETUP_VERSION, type SimulatorSetup } from '../utils/simulator/simulatorSetup';

// `z.record` over an enum key is EXHAUSTIVE — it requires every key present. A board and an
// override set are both sparse by design, so both take `partialRecord`.
const overridesSchema = z.partialRecord(z.enum(OVERRIDABLE_STATS), z.number().finite()).optional();

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
    name: z.string().min(1).max(120),
    playerBoard: boardSchema,
    enemyBoard: boardSchema,
    playerSquadLeader: squadLeaderSchema,
    enemySquadLeader: squadLeaderSchema,
    seed: z.number().int().finite(),
    runCount: z.number().int().finite(),
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
