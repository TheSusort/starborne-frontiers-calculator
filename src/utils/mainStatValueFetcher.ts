import {
    PERCENTAGE_STATS,
    FLAT_ATK_DEF,
    FLAT_HP,
    HACK_SEC_STATS,
    SPD_STATS,
} from '../constants/mainStatValues';
import { StatName, StatType } from '../types/stats';

export const calculateMainStatValue = (
    statName: StatName,
    statType: StatType,
    stars: number,
    level: number
): number => {
    let table;

    if (statType === 'percentage') {
        table = PERCENTAGE_STATS;
    } else if (statName === 'hp') {
        table = FLAT_HP;
    } else if (statName === 'speed') {
        table = SPD_STATS;
    } else if (['hack', 'sec'].includes(statName)) {
        table = HACK_SEC_STATS;
    } else {
        table = FLAT_ATK_DEF;
    }

    if (!table[stars]?.[level]) {
        return 0;
    }

    return table[stars][level];
};
