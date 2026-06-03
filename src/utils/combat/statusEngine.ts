import { SelectedGameBuff } from '../../types/calculator';
import { computeChargeSchedule } from './chargeSchedule';

export interface ActiveBuff {
    buffName: string;
    turnsRemaining: number | 'recurring';
    stacks?: number; // defined for accumulating buffs; current stack count
}

export interface StatusEngineInput {
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
    chargeCount: number;
    startCharged: boolean;
    totalRounds: number;
}

export interface StatusEngine {
    /** Advance to round r (1-based, strictly sequential) and return the round's
     *  active lists — same contents as the old computeBuffTimeline entry. */
    step(round: number): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] };
}

const ROMAN_SUFFIX = /\s+(I{1,3}|IV|V)$/;
const TIER_VALUES: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
// DoTs stack independently — Inferno I and Inferno II can both be active simultaneously.
// Each tier is its own entity, not a family where higher replaces lower.
const DOT_PREFIXES = new Set(['Corrosion', 'Inferno', 'Bomb']);

function deriveFamilyKey(name: string): { familyKey: string; tier: number } {
    if (DOT_PREFIXES.has(name.split(' ')[0])) return { familyKey: name, tier: 0 };
    const m = ROMAN_SUFFIX.exec(name);
    if (!m) return { familyKey: name, tier: 0 };
    return { familyKey: name.slice(0, m.index), tier: TIER_VALUES[m[1]] };
}

function isAccumulating(buff: SelectedGameBuff): boolean {
    return !!buff.stackTrigger && buff.isStackable;
}

function isAlwaysActive(buff: SelectedGameBuff): boolean {
    if (isAccumulating(buff)) return false;
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

interface AccumulatingState {
    buffName: string;
    stacks: number;
    maxStacks: number | undefined;
    rate: number;
    trigger: 'per-round' | 'per-active' | 'per-charge';
}

/**
 * Incremental status machine — ports computeBuffTimeline's semantics exactly,
 * exposed as per-round stepping instead of a precomputed array. Everything that
 * was loop-preamble in computeBuffTimeline is closure state here; the loop body
 * becomes step(r).
 */
export function createStatusEngine(input: StatusEngineInput): StatusEngine {
    const { selfBuffs, enemyDebuffs, chargeCount, startCharged, totalRounds } = input;

    const chargedSet = new Set(computeChargeSchedule(chargeCount, startCharged, totalRounds));

    // Categorized collections — kept as named closure variables (not inlined) so
    // Task 6 can append ability-sourced statuses to them later.
    const alwaysSelf = selfBuffs.filter((b) => !isAccumulating(b) && isAlwaysActive(b));
    const timedSelf = selfBuffs.filter((b) => !isAccumulating(b) && !isAlwaysActive(b));
    const accumSelf = selfBuffs.filter(isAccumulating);
    const alwaysEnemy = enemyDebuffs.filter((b) => !isAccumulating(b) && isAlwaysActive(b));
    const timedEnemy = enemyDebuffs.filter((b) => !isAccumulating(b) && !isAlwaysActive(b));
    const accumEnemy = enemyDebuffs.filter(isAccumulating);

    // Build accumulating state maps — start at 0 stacks, increment each trigger
    const accumSelfMap = new Map<string, AccumulatingState>();
    for (const b of accumSelf) {
        accumSelfMap.set(b.buffName, {
            buffName: b.buffName,
            stacks: 0,
            maxStacks: b.maxStacks,
            rate: b.stacks,
            trigger: b.stackTrigger!,
        });
    }
    const accumEnemyMap = new Map<string, AccumulatingState>();
    for (const b of accumEnemy) {
        accumEnemyMap.set(b.buffName, {
            buffName: b.buffName,
            stacks: 0,
            maxStacks: b.maxStacks,
            rate: b.stacks,
            trigger: b.stackTrigger!,
        });
    }

    // Pre-compute charged sets for each unique source schedule among timed enemy debuffs.
    // Enemy debuffs fire on the APPLIER's schedule, not the current ship's schedule.
    // Falls back to the current ship's chargedSet when no source schedule is stored.
    const sourceScheduleCache = new Map<string, Set<number>>();
    const getSourceChargedSet = (buff: {
        sourceChargeCount?: number;
        sourceStartCharged?: boolean;
    }): Set<number> => {
        if (buff.sourceChargeCount === undefined || buff.sourceStartCharged === undefined)
            return chargedSet;
        const key = `${buff.sourceChargeCount}-${buff.sourceStartCharged}`;
        if (!sourceScheduleCache.has(key)) {
            sourceScheduleCache.set(
                key,
                new Set(
                    computeChargeSchedule(
                        buff.sourceChargeCount,
                        buff.sourceStartCharged,
                        totalRounds
                    )
                )
            );
        }
        return sourceScheduleCache.get(key)!;
    };

    const selfMap = new Map<string, BuffState>();
    const enemyMap = new Map<string, BuffState>();

    let lastRound = 0;

    const step = (
        r: number
    ): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] } => {
        if (r !== lastRound + 1) {
            throw new Error(
                `StatusEngine.step called out of sequence: expected round ${lastRound + 1}, got ${r}`
            );
        }
        lastRound = r;

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

        // Step 2b: Increment accumulating stacks
        const incrementAccum = (map: Map<string, AccumulatingState>) => {
            for (const state of map.values()) {
                const fires =
                    state.trigger === 'per-round' ||
                    (state.trigger === 'per-active' && skillFired === 'active') ||
                    (state.trigger === 'per-charge' && skillFired === 'charge');
                if (fires) {
                    state.stacks =
                        state.maxStacks !== undefined
                            ? Math.min(state.stacks + state.rate, state.maxStacks)
                            : state.stacks + state.rate;
                }
            }
        };
        incrementAccum(accumSelfMap);
        incrementAccum(accumEnemyMap);

        // Step 3: Apply timed buffs — self-buffs use this ship's schedule;
        // enemy debuffs use the applier's stored source schedule.
        const upsertBuff = (buff: SelectedGameBuff, map: Map<string, BuffState>) => {
            if (typeof buff.skillDuration !== 'number') return;
            const { familyKey, tier } = deriveFamilyKey(buff.buffName);
            const existing = map.get(familyKey);
            if (existing && existing.tier > tier) return;
            map.set(familyKey, {
                buffName: buff.buffName,
                turnsRemaining: buff.skillDuration,
                tier,
            });
        };

        for (const buff of timedSelf) {
            if (buff.skillSource === skillFired) upsertBuff(buff, selfMap);
        }
        for (const buff of timedEnemy) {
            const sourceSkillFired: 'active' | 'charge' = getSourceChargedSet(buff).has(r)
                ? 'charge'
                : 'active';
            if (buff.skillSource === sourceSkillFired) upsertBuff(buff, enemyMap);
        }

        // Step 4: Snapshot — always-active buffs injected as 'recurring'
        // Deduplicate always-active by buffName so buffLookup expansion doesn't multiply effects
        const selfAlwaysSnap = [...new Map(alwaysSelf.map((b) => [b.buffName, b])).values()].map(
            (b) => ({ buffName: b.buffName, turnsRemaining: 'recurring' as const })
        );
        const enemyAlwaysSnap = [...new Map(alwaysEnemy.map((b) => [b.buffName, b])).values()].map(
            (b) => ({ buffName: b.buffName, turnsRemaining: 'recurring' as const })
        );
        // Accumulating buffs: include only when stacks > 0
        const selfAccumSnap = [...accumSelfMap.values()]
            .filter((s) => s.stacks > 0)
            .map((s) => ({
                buffName: s.buffName,
                turnsRemaining: 'recurring' as const,
                stacks: s.stacks,
            }));
        const enemyAccumSnap = [...accumEnemyMap.values()]
            .filter((s) => s.stacks > 0)
            .map((s) => ({
                buffName: s.buffName,
                turnsRemaining: 'recurring' as const,
                stacks: s.stacks,
            }));

        return {
            activeSelfBuffs: [
                ...selfAlwaysSnap,
                ...selfAccumSnap,
                ...[...selfMap.values()].map((s) => ({
                    buffName: s.buffName,
                    turnsRemaining: s.turnsRemaining,
                })),
            ],
            activeEnemyDebuffs: [
                ...enemyAlwaysSnap,
                ...enemyAccumSnap,
                ...[...enemyMap.values()].map((s) => ({
                    buffName: s.buffName,
                    turnsRemaining: s.turnsRemaining,
                })),
            ],
        };
    };

    return { step };
}
