import type { ChallengeKind, DuelEffect, DuelStakes } from '../../../utils/arcade/types';

export function stakesBanner(stakes: DuelStakes): string {
    switch (stakes) {
        case 'win-or-die':
            return 'WIN OR DIE';
        case 'bonus-or-penalty':
            return 'CREDITS ON THE LINE';
        case 'power-up':
            return 'POWER-UP';
    }
}

/** A challenge's short name: its format for the fights, its task for the races. */
export function challengeLabel(challenge: ChallengeKind): string {
    switch (challenge) {
        case 'duel':
            return '1v1';
        case 'team':
            return '3v3';
        case 'dps':
            return 'DPS';
        case 'tank':
            return 'TANK';
        case 'heal':
            return 'HEAL';
    }
}

/** "TANK · WIN OR DIE": the challenge and what rides on it. */
export const challengeBanner = (challenge: ChallengeKind, stakes: DuelStakes): string =>
    `${challengeLabel(challenge)} · ${stakesBanner(stakes)}`;

export function effectText(effect: DuelEffect): string {
    switch (effect.kind) {
        case 'bonus':
            return `+${effect.amount}`;
        case 'credits':
            if (effect.delta > 0) return `+${effect.delta} credits`;
            if (effect.delta < 0) return `−${-effect.delta} credits`;
            return 'No credits lost';
        case 'shield':
            return 'Shield!';
        case 'magnet':
            return 'Magnet!';
        case 'shield-absorbed':
            return 'Shield absorbed the defeat';
        case 'game-over':
            return 'Destroyed';
        case 'none':
            return 'No reward';
    }
}

/** How long the outcome stays up before the run moves on by itself. */
export const DUEL_RESULT_HOLD_MS = 1500;

/** What follows the playback: the outcome held for `DUEL_RESULT_HOLD_MS`, or, for a loss that ends
 *  the run, no outcome card at all (the summary closes straight into the ship's explosion). */
export const afterPlayback = (effect: DuelEffect | null): 'hold' | 'close' =>
    effect?.kind === 'game-over' ? 'close' : 'hold';
