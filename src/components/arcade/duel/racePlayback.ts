import type { RaceKind, RaceResult, RaceSide } from './challengeResult';
import { MAX_PLAYBACK_SECONDS } from './duelPlayback';

/** Each race round plays for this long, unless the race has so many rounds that the playback
 *  would run past `MAX_PLAYBACK_SECONDS`; then every round shrinks to fit. */
export const RACE_ROUND_SECONDS = 1;
export const raceRoundSeconds = (rounds: number) =>
    rounds > 0 ? Math.min(RACE_ROUND_SECONDS, MAX_PLAYBACK_SECONDS / rounds) : 0;

/** What a race compares, as its bars are labelled. */
export function raceFigureLabel(kind: RaceKind): string {
    switch (kind) {
        case 'dps':
            return 'Damage dealt';
        case 'heal':
            return 'Healing done';
        case 'tank':
            return 'HP left';
    }
}

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A race figure as shown beside its bar: HP left as a percentage, the others as a number. */
export const raceFigureText = (kind: RaceKind, value: number): string =>
    kind === 'tank' ? `${Math.round(value)}%` : NUMBER.format(value);

/** The figure `side` shows after round `round` (1-based); 0 before the first round. */
export const raceFigureAt = (side: RaceSide, round: number): number =>
    round <= 0 ? 0 : (side.byRound[Math.min(round, side.byRound.length) - 1] ?? 0);

/** How full a race bar is, 0..100. HP left is already a percentage; damage and healing fill
 *  against the larger of the two ships' highest figure, so the leader ends full. Two ships that
 *  score nothing show empty bars. */
export function raceBarFill(result: RaceResult, value: number): number {
    if (result.kind === 'tank') return Math.max(0, Math.min(100, value));
    const top = Math.max(0, ...result.flown.byRound, ...result.rival.byRound);
    return top > 0 ? Math.max(0, Math.min(100, (100 * value) / top)) : 0;
}

/** The stamp a race side shows once the race is over; none for a skipped race. */
export function raceStamp(result: RaceResult, side: 'flown' | 'rival'): 'WIN' | 'LOSE' | null {
    if (result.outcome === 'skipped') return null;
    const flownWon = result.outcome === 'win';
    return (side === 'flown') === flownWon ? 'WIN' : 'LOSE';
}
