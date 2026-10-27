import type { ChallengeKind, DuelOutcome } from '../../../utils/arcade/types';
import type { DuelResult } from './runDuel';

/**
 * What an arcade challenge produced. Kept apart from `runChallenge`, which pulls in the
 * calculators, so the game can name and build results without loading them.
 */

/** The challenges won by racing the gate ship at the same task rather than fighting it. */
export type RaceKind = Extract<ChallengeKind, 'dps' | 'heal' | 'tank'>;

/** One ship's run at a race. `byRound[i]` is the compared figure after round `i + 1` (damage
 *  dealt or healing done so far, or HP% left); `total` is the figure the race compares. Both are
 *  empty/0 for a skipped race. */
export interface RaceSide {
    byRound: number[];
    total: number;
}

export interface RaceResult {
    kind: RaceKind;
    outcome: DuelOutcome;
    flown: RaceSide;
    rival: RaceSide;
}

/** A `duel` or `team` fight, played back turn by turn. */
export interface FightResult extends DuelResult {
    kind: Extract<ChallengeKind, 'duel' | 'team'>;
}

export type ChallengeResult = FightResult | RaceResult;

export const isRace = (result: ChallengeResult): result is RaceResult =>
    result.kind === 'dps' || result.kind === 'heal' || result.kind === 'tank';

/** The flown ship wins when its figure is at least the rival's: ties go to the flown ship, so
 *  two ships that both score 0 is a win. */
export const raceOutcome = (flown: RaceSide, rival: RaceSide): 'win' | 'lose' =>
    flown.total >= rival.total ? 'win' : 'lose';

/** A challenge that applies no stakes, with nothing to play back. */
export function skippedChallenge(kind: RaceKind): RaceResult;
export function skippedChallenge(kind: ChallengeKind): ChallengeResult;
export function skippedChallenge(kind: ChallengeKind): ChallengeResult {
    if (kind === 'duel' || kind === 'team') return { kind, outcome: 'skipped', beats: [] };
    const empty = (): RaceSide => ({ byRound: [], total: 0 });
    return { kind, outcome: 'skipped', flown: empty(), rival: empty() };
}
