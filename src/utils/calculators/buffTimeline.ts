import { SelectedGameBuff } from '../../types/calculator';

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

const ROMAN_SUFFIX = /\s+(I{1,3}|IV|V)$/;
const TIER_VALUES: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

function deriveFamilyKey(name: string): { familyKey: string; tier: number } {
    const m = ROMAN_SUFFIX.exec(name);
    if (!m) return { familyKey: name, tier: 0 };
    return { familyKey: name.slice(0, m.index), tier: TIER_VALUES[m[1]] };
}

function isAlwaysActive(buff: SelectedGameBuff): boolean {
    return (
        !buff.skillSource ||
        buff.skillSource.startsWith('passive') ||
        buff.skillDuration === null ||
        buff.skillDuration === undefined ||
        buff.skillDuration === 'recurring'
    );
}

interface BuffState {
    buffName: string;
    turnsRemaining: number;
    tier: number;
}

/** Runs the per-round buff state machine and returns one entry per round. */
export function computeBuffTimeline(
    selfBuffs: SelectedGameBuff[],
    enemyDebuffs: SelectedGameBuff[],
    chargeCount: number,
    startCharged: boolean,
    totalRounds: number
): BuffTimelineEntry[] {
    const chargedSet = new Set(computeChargeSchedule(chargeCount, startCharged, totalRounds));

    const alwaysSelf = selfBuffs.filter(isAlwaysActive);
    const timedSelf = selfBuffs.filter((b) => !isAlwaysActive(b));
    const alwaysEnemy = enemyDebuffs.filter(isAlwaysActive);
    const timedEnemy = enemyDebuffs.filter((b) => !isAlwaysActive(b));

    const selfMap = new Map<string, BuffState>();
    const enemyMap = new Map<string, BuffState>();
    const entries: BuffTimelineEntry[] = [];

    for (let r = 1; r <= totalRounds; r++) {
        // Step 1: Decrement and expire
        const selfExpired: string[] = [];
        for (const [key, s] of selfMap) {
            s.turnsRemaining -= 1;
            if (s.turnsRemaining <= 0) selfExpired.push(key);
        }
        selfExpired.forEach((k) => selfMap.delete(k));

        const enemyExpired: string[] = [];
        for (const [key, s] of enemyMap) {
            s.turnsRemaining -= 1;
            if (s.turnsRemaining <= 0) enemyExpired.push(key);
        }
        enemyExpired.forEach((k) => enemyMap.delete(k));

        // Step 2: Determine skill fired this round
        const skillFired: 'active' | 'charge' = chargedSet.has(r) ? 'charge' : 'active';

        // Step 3: Apply timed buffs from fired skill
        const applyBuffs = (buffs: SelectedGameBuff[], map: Map<string, BuffState>) => {
            for (const buff of buffs) {
                if (buff.skillSource !== skillFired) continue;
                if (typeof buff.skillDuration !== 'number') continue;
                const { familyKey, tier } = deriveFamilyKey(buff.buffName);
                const existing = map.get(familyKey);
                if (existing && existing.tier >= tier) continue;
                map.set(familyKey, {
                    buffName: buff.buffName,
                    turnsRemaining: buff.skillDuration,
                    tier,
                });
            }
        };
        applyBuffs(timedSelf, selfMap);
        applyBuffs(timedEnemy, enemyMap);

        // Step 4: Snapshot — always-active buffs injected as 'recurring'
        entries.push({
            round: r,
            activeSelfBuffs: [
                ...alwaysSelf.map((b) => ({
                    buffName: b.buffName,
                    turnsRemaining: 'recurring' as const,
                })),
                ...[...selfMap.values()].map((s) => ({
                    buffName: s.buffName,
                    turnsRemaining: s.turnsRemaining,
                })),
            ],
            activeEnemyDebuffs: [
                ...alwaysEnemy.map((b) => ({
                    buffName: b.buffName,
                    turnsRemaining: 'recurring' as const,
                })),
                ...[...enemyMap.values()].map((s) => ({
                    buffName: s.buffName,
                    turnsRemaining: s.turnsRemaining,
                })),
            ],
        });
    }

    return entries;
}
