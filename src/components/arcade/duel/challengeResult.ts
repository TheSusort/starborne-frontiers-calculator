import type { ChallengeKind, DuelOutcome } from '../../../utils/arcade/types';
import type { DefenseSurvivabilityResult } from '../../../utils/calculators/defenseSurvivabilitySim';
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

/** A race side whose figure adds up round by round (damage dealt, healing done): `byRound` is the
 *  running sum of `perRound`, and `total` the calculator's own total. */
export function cumulativeSide(perRound: readonly number[], total: number): RaceSide {
    let sum = 0;
    return { byRound: perRound.map((v) => (sum += v)), total };
}

/** A tank race side over `rounds` rounds, read from a survivability run of `rounds + 1` rounds.
 *  A round's `hpPct` is read at the top of that round, so the HP left after round `r` is the
 *  reading entering round `r + 1`; nothing in the extra round reaches the readings before it.
 *  From the round the ship is destroyed in, its HP left is 0. */
export function hpLeftSide(
    run: Pick<DefenseSurvivabilityResult, 'rounds' | 'destroyedRound'>,
    rounds: number
): RaceSide {
    const byRound = Array.from({ length: rounds }, (_, i) => {
        const round = i + 1;
        if (run.destroyedRound !== undefined && run.destroyedRound <= round) return 0;
        return run.rounds[round]?.hpPct ?? 0;
    });
    return { byRound, total: byRound[rounds - 1] ?? 0 };
}

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
