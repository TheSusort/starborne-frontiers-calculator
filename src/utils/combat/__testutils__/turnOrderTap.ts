/**
 * Run `runCombat` with an event tap that records the per-round turn order and every death.
 *
 * WHY THIS EXISTS AS A SHARED UTIL. Turn ORDER is the only observable that separates
 * turn-granular termination from round-granular termination: both produce the same
 * `rounds.length`, and only the absence of a later-scheduled actor's `turn-started` shows the
 * round was cut mid-walk. `dummyReachability.test.ts` had this inline first; it is imported from
 * here rather than from that file because importing a `.test.ts` module executes its `describe`
 * blocks as a side effect — the suites would run twice, under two files, with two different seeds.
 */
import { runCombat } from '../engine';
import type { CombatEngineInput } from '../engine';
import { createEventBus } from '../events';

export interface TurnOrderTap {
    result: ReturnType<typeof runCombat>;
    /** Actor ids that emitted `turn-started` in `round`, in emission order. */
    actorsThatTookTurns: (round: number) => string[];
    /** Every actor id that emitted `ship-destroyed`, in order. */
    destroyed: () => string[];
}

export const collectTurns = (input: CombatEngineInput): TurnOrderTap => {
    const bus = createEventBus();
    const turnsByRound = new Map<number, string[]>();
    const destroyedIds: string[] = [];
    bus.on('turn-started', (e) => {
        turnsByRound.set(e.round, [...(turnsByRound.get(e.round) ?? []), e.actorId]);
    });
    bus.on('ship-destroyed', (e) => destroyedIds.push(e.actorId));
    const result = runCombat({ ...input, bus });
    return {
        result,
        actorsThatTookTurns: (round: number): string[] => turnsByRound.get(round) ?? [],
        destroyed: (): string[] => destroyedIds,
    };
};
