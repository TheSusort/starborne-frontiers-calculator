import type { DuelEffect, DuelStakes } from '../../../utils/arcade/types';

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
