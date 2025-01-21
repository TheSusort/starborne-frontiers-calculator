import {
    PERCENTAGE_STATS,
    FLAT_ATK_DEF,
    FLAT_HP,
    HACK_SEC_STATS,
    SPD_STATS,
} from '../constants/mainStatValues';
import { StatName, StatType } from '../types/stats';

export function calculateMainStatValue(
    statName: StatName,
    type: StatType,
    stars: number,
    level: number
): number {
    let table;

    if (type === 'percentage') {
        table = PERCENTAGE_STATS;
    } else if (statName === 'hp') {
        table = FLAT_HP;
    } else if (statName === 'speed') {
        table = SPD_STATS;
    } else if (statName === 'hacking' || statName === 'security') {
        table = HACK_SEC_STATS;
    } else {
        table = FLAT_ATK_DEF;
    }

    if (!table[stars]?.[level]) {
        return 0;
    }

    return table[stars][level];
}
