export interface ActiveBuff {
    buffName: string;
    turnsRemaining: number | 'recurring';
}

export interface BuffTimelineEntry {
    round: number;
    activeSelfBuffs: ActiveBuff[];
    activeEnemyDebuffs: ActiveBuff[];
}

/** Returns 1-based round numbers when the charged skill fires. Mirrors simulateDPS counter logic. */
export function computeChargeSchedule(
    chargeCount: number,
    startCharged: boolean,
    totalRounds: number
): number[] {
    if (chargeCount <= 0) return [];
    const chargedRounds: number[] = [];
    let charges = startCharged ? chargeCount : 0;
    for (let r = 1; r <= totalRounds; r++) {
        if (charges >= chargeCount) {
            chargedRounds.push(r);
            charges = 0;
        } else {
            charges += 1;
        }
    }
    return chargedRounds;
}
