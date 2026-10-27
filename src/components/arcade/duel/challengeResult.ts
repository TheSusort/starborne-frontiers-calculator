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
 *  empty/0 for a skipped race. `endRound` is the round the ship's task ended: the default enemy
 *  fell (dps) or the ship was destroyed (tank, heal); absent while it ran the whole race. */
export interface RaceSide {
    byRound: number[];
    total: number;
    endRound?: number;
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
    const destroyed = run.destroyedRound !== undefined && run.destroyedRound <= rounds;
    return {
        byRound,
        total: byRound[rounds - 1] ?? 0,
        ...(destroyed ? { endRound: run.destroyedRound } : {}),
    };
}

/** Both sides of a race of at most `rounds` rounds, cut or held to the race's length. A `tank`
 *  race ends at the first destruction, and each side's `total` becomes its HP left then; any
 *  other race ends, when both ships' tasks ended, at the later `endRound`. Otherwise the race runs
 *  all `rounds`. A side shorter than the race holds its last figure (0 if it has none). */
export function endRace(
    kind: RaceKind,
    flown: RaceSide,
    rival: RaceSide,
    rounds: number
): [RaceSide, RaceSide] {
    const ends = [flown.endRound, rival.endRound].filter((r): r is number => r !== undefined);
    const length =
        kind === 'tank'
            ? Math.min(rounds, ...ends)
            : ends.length === 2
              ? Math.min(rounds, Math.max(...ends))
              : rounds;
    const fit = (side: RaceSide): RaceSide => {
        const byRound = Array.from(
            { length },
            (_, i) => side.byRound[Math.min(i, side.byRound.length - 1)] ?? 0
        );
        return kind === 'tank'
            ? { ...side, byRound, total: byRound[length - 1] ?? 0 }
            : { ...side, byRound };
    };
    return [fit(flown), fit(rival)];
}

/** The higher figure wins. Equal figures go to the ship whose task ended better: in `dps` the
 *  earlier kill (a kill beats none), in `tank` and `heal` the later destruction (surviving beats
 *  both). Still equal, including two ships that both score 0 and never end, is a draw. */
export function raceOutcome(
    kind: RaceKind,
    flown: RaceSide,
    rival: RaceSide
): 'win' | 'lose' | 'draw' {
    if (flown.total !== rival.total) return flown.total > rival.total ? 'win' : 'lose';
    const a = flown.endRound ?? Infinity;
    const b = rival.endRound ?? Infinity;
    if (a === b) return 'draw';
    return (kind === 'dps' ? a < b : a > b) ? 'win' : 'lose';
}

/** A challenge that applies no stakes, with nothing to play back. */
export function skippedChallenge(kind: RaceKind): RaceResult;
export function skippedChallenge(kind: ChallengeKind): ChallengeResult;
export function skippedChallenge(kind: ChallengeKind): ChallengeResult {
    if (kind === 'duel' || kind === 'team') return { kind, outcome: 'skipped', beats: [] };
    const empty = (): RaceSide => ({ byRound: [], total: 0 });
    return { kind, outcome: 'skipped', flown: empty(), rival: empty() };
}
