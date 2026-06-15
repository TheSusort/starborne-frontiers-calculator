/**
 * Combat Simulator Phase 5 — PR 1, Task 2: symmetric battle-result types + a PURE
 * event-driven assembler.
 *
 * `assembleBattleResult` takes the raw combat event stream + per-round per-victim damage
 * map + a roster (all as plain data) and produces a symmetric, render-ready BattleResult.
 * It has NO engine dependency and NO side effects — it only imports the CombatEvent union
 * (combat/events) and the Position type (types/encounters).
 *
 * Data-source contract (pinned in combat/__tests__/twoTeamBattle.test.ts, Task 1):
 *   - damage DEALT per attacker = `ability-performed.damage` summed by `actorId`.
 *   - damage TAKEN per victim   = `perRoundPerTarget[round][victimId]` (the reliable,
 *     symmetric source for BOTH sides; we do NOT use `hp-changed`).
 *   - heals = `heal-performed` { casterId, targets[], amount } (healing mode only).
 *   - death = `ship-destroyed` { actorId }.
 *   - buffs = `buff-applied` / `buff-expired` / `debuff-applied`.
 *
 * HP% is derived as maxHp - cumulative(damageTaken over rounds <= r), uniform for both
 * sides (ignores healing/shields on the HP curve — acceptable for PR1's surface).
 *
 * `simulateBattle` (the runCombat wrapper that produces these inputs) is Task 3 — NOT here.
 */
import type { CombatEvent } from '../combat/events';
import type { Position } from '../../types/encounters';

export interface ShipRoundState {
    actorId: string;
    side: 'player' | 'enemy';
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
    healingReceived: number;
    /**
     * Shield absorption. The `heal-performed` payload carries no shield channel flag
     * (just { casterId, targets[], amount }), so this is always 0 for PR1.
     */
    shieldsAbsorbed: number;
    /** End-of-round HP%, from maxHp - cumulative damageTaken. */
    hpPct: number;
    alive: boolean;
    activeBuffs: string[];
    activeDebuffs: string[];
}

export interface BattleLogEvent {
    round: number;
    kind: 'damage' | 'heal' | 'death';
    actorId: string;
    targetId?: string;
    amount?: number;
}

export interface BattleRound {
    round: number;
    ships: ShipRoundState[];
    events: BattleLogEvent[];
}

export interface BattleResult {
    /** Trimmed at termination (no rounds after outcome.lastRound). */
    rounds: BattleRound[];
    outcome: { winner: 'player' | 'enemy' | 'draw'; lastRound: number };
    roster: Array<{ actorId: string; side: 'player' | 'enemy'; name: string; position: Position }>;
}

interface RosterEntry {
    actorId: string;
    side: 'player' | 'enemy';
    name: string;
    position: Position;
    maxHp: number;
}

const clampPct = (value: number): number => Math.max(0, Math.min(100, value));

export function assembleBattleResult(args: {
    events: CombatEvent[];
    perRoundPerTarget: Record<number, Record<string, number>>;
    roster: RosterEntry[];
    numRounds: number;
}): BattleResult {
    const { events, perRoundPerTarget, roster, numRounds } = args;

    // Round of first destruction per actor (earliest ship-destroyed).
    const destroyedAt = new Map<string, number>();
    for (const e of events) {
        if (e.type === 'ship-destroyed') {
            const prev = destroyedAt.get(e.actorId);
            if (prev === undefined || e.round < prev) destroyedAt.set(e.actorId, e.round);
        }
    }

    // Running buff/debuff sets per actor, mutated as we walk rounds in order.
    const activeBuffs = new Map<string, Set<string>>();
    const activeDebuffs = new Map<string, Set<string>>();
    const ensure = (map: Map<string, Set<string>>, id: string): Set<string> => {
        let set = map.get(id);
        if (!set) {
            set = new Set<string>();
            map.set(id, set);
        }
        return set;
    };

    // Cumulative damage taken per actor across rounds (for HP% derivation).
    const cumulativeTaken = new Map<string, number>();

    const rounds: BattleRound[] = [];
    let lastRound = numRounds;
    let winner: 'player' | 'enemy' | 'draw' = 'draw';

    for (let round = 1; round <= numRounds; round++) {
        const roundEvents = events.filter((e) => 'round' in e && e.round === round);

        // Buff/debuff transitions for this round (apply before snapshotting the round).
        for (const e of roundEvents) {
            if (e.type === 'buff-applied') {
                ensure(activeBuffs, e.actorId).add(e.buffName);
            } else if (e.type === 'buff-expired') {
                activeBuffs.get(e.actorId)?.delete(e.buffName);
            } else if (e.type === 'debuff-applied') {
                ensure(activeDebuffs, e.targetId).add(e.buffName);
            }
        }

        // Damage dealt per attacker this round (ability-performed.damage by actorId).
        const dealt = new Map<string, number>();
        for (const e of roundEvents) {
            if (e.type === 'ability-performed' && typeof e.damage === 'number') {
                dealt.set(e.actorId, (dealt.get(e.actorId) ?? 0) + e.damage);
            }
        }

        // Healing done (caster, full amount) + received (split evenly across targets —
        // approximation: heal-performed carries no per-recipient breakdown).
        const healDone = new Map<string, number>();
        const healReceived = new Map<string, number>();
        for (const e of roundEvents) {
            if (e.type === 'heal-performed') {
                healDone.set(e.casterId, (healDone.get(e.casterId) ?? 0) + e.amount);
                const per = e.targets.length > 0 ? e.amount / e.targets.length : 0;
                for (const tid of e.targets) {
                    healReceived.set(tid, (healReceived.get(tid) ?? 0) + per);
                }
            }
        }

        // Accumulate this round's per-victim taken damage into the running cumulative.
        const takenThisRound = perRoundPerTarget[round] ?? {};

        const ships: ShipRoundState[] = roster.map((entry) => {
            const taken = takenThisRound[entry.actorId] ?? 0;
            const cumulative = (cumulativeTaken.get(entry.actorId) ?? 0) + taken;
            cumulativeTaken.set(entry.actorId, cumulative);

            const destroyRound = destroyedAt.get(entry.actorId);
            const alive = destroyRound === undefined || round < destroyRound;

            return {
                actorId: entry.actorId,
                side: entry.side,
                damageDealt: dealt.get(entry.actorId) ?? 0,
                damageTaken: taken,
                healingDone: healDone.get(entry.actorId) ?? 0,
                healingReceived: healReceived.get(entry.actorId) ?? 0,
                shieldsAbsorbed: 0,
                hpPct: clampPct((100 * (entry.maxHp - cumulative)) / entry.maxHp),
                alive,
                activeBuffs: [...(activeBuffs.get(entry.actorId) ?? [])],
                activeDebuffs: [...(activeDebuffs.get(entry.actorId) ?? [])],
            };
        });

        // Readable per-round log: damage (ability-performed), heal (heal-performed),
        // death (ship-destroyed). NOT `attacked` (no amount).
        const log: BattleLogEvent[] = [];
        for (const e of roundEvents) {
            if (e.type === 'ability-performed' && typeof e.damage === 'number') {
                log.push({
                    round,
                    kind: 'damage',
                    actorId: e.actorId,
                    targetId: e.targetId,
                    amount: e.damage,
                });
            } else if (e.type === 'heal-performed') {
                for (const tid of e.targets) {
                    log.push({
                        round,
                        kind: 'heal',
                        actorId: e.casterId,
                        targetId: tid,
                        amount: e.targets.length > 0 ? e.amount / e.targets.length : e.amount,
                    });
                }
                if (e.targets.length === 0) {
                    log.push({ round, kind: 'heal', actorId: e.casterId, amount: e.amount });
                }
            } else if (e.type === 'ship-destroyed') {
                log.push({ round, kind: 'death', actorId: e.actorId });
            }
        }

        rounds.push({ round, ships, events: log });

        // Termination: first round where ALL of one side's actors are destroyed.
        const playerWiped = roster
            .filter((r) => r.side === 'player')
            .every((r) => {
                const d = destroyedAt.get(r.actorId);
                return d !== undefined && d <= round;
            });
        const enemyWiped = roster
            .filter((r) => r.side === 'enemy')
            .every((r) => {
                const d = destroyedAt.get(r.actorId);
                return d !== undefined && d <= round;
            });

        if (playerWiped || enemyWiped) {
            lastRound = round;
            // If both wiped in the same round, treat as a draw.
            winner = playerWiped && enemyWiped ? 'draw' : playerWiped ? 'enemy' : 'player';
            break;
        }
    }

    // Trim any rounds after termination (break already stops appending, but guard anyway).
    const trimmed = rounds.filter((r) => r.round <= lastRound);

    return {
        rounds: trimmed,
        outcome: { winner, lastRound },
        roster: roster.map(({ actorId, side, name, position }) => ({
            actorId,
            side,
            name,
            position,
        })),
    };
}
