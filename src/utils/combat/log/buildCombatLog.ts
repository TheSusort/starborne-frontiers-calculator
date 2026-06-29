import { CombatEvent, CombatEventType } from '../events';
import { CombatLogEntry, CombatLogRound, CombatLogTarget, CombatLogTurn } from './types';

export interface RosterEntry {
    actorId: string;
    side: 'player' | 'enemy';
    name: string;
}

/** Internal context threaded through all handlers. */
interface BuildContext {
    rounds: CombatLogRound[];
    /** Mutable current-round pointer — undefined before first round-started. */
    currentRound: CombatLogRound | undefined;
    /** Mutable current-turn pointer — undefined outside a turn. */
    currentTurn: CombatLogTurn | undefined;
    /** The most-recently opened attack entry (ability-performed → attacked window). */
    openAttackEntry: CombatLogEntry | undefined;
    /** Latest known HP percentages keyed by actorId. */
    hpPct: Map<string, number>;
    /** Set of actorIds present in the roster (for filtering). */
    rosterIds: Set<string>;

    /** Push a new round and set it as current. */
    openRound(round: number): void;
    /** Push a new turn onto the current round and set it as current. */
    openTurn(actorId: string): void;
    /** Attach an entry to the current turn. */
    attachEntry(entry: CombatLogEntry): void;
    /** Update the running HP map and stamp the most-recent matching target. */
    setHp(actorId: string, pct: number): void;
}

function createBuildContext(rosterIds: Set<string>): BuildContext {
    const ctx: BuildContext = {
        rounds: [],
        currentRound: undefined,
        currentTurn: undefined,
        openAttackEntry: undefined,
        hpPct: new Map(),
        rosterIds,

        openRound(round: number) {
            const r: CombatLogRound = { round, turns: [], endOfRound: [] };
            ctx.rounds.push(r);
            ctx.currentRound = r;
            ctx.currentTurn = undefined;
            ctx.openAttackEntry = undefined;
        },

        openTurn(actorId: string) {
            if (!ctx.currentRound) return;
            const t: CombatLogTurn = {
                actorId,
                chargeBefore: 0,
                chargeMax: 0,
                entries: [],
            };
            ctx.currentRound.turns.push(t);
            ctx.currentTurn = t;
            ctx.openAttackEntry = undefined;
        },

        attachEntry(entry: CombatLogEntry) {
            if (!ctx.currentTurn) return;
            ctx.currentTurn.entries.push(entry);
        },

        setHp(actorId: string, pct: number) {
            ctx.hpPct.set(actorId, pct);
            // Stamp the most-recent target with this actorId in the current turn.
            if (!ctx.currentTurn) return;
            for (let i = ctx.currentTurn.entries.length - 1; i >= 0; i--) {
                const e = ctx.currentTurn.entries[i];
                // Walk targets in reverse to find the most recently added matching target.
                for (let j = e.targets.length - 1; j >= 0; j--) {
                    if (e.targets[j].targetId === actorId) {
                        e.targets[j].resultingHpPct = pct;
                        return;
                    }
                }
            }
        },
    };
    return ctx;
}

type Handler<T extends CombatEventType> = (
    e: Extract<CombatEvent, { type: T }>,
    ctx: BuildContext
) => void;

/** Handler map — one entry per handled event type. Unknown types are silently skipped. */
const handlers: Partial<{ [K in CombatEventType]: Handler<K> }> = {
    'round-started': (e, ctx) => {
        ctx.openRound(e.round);
    },

    'round-ended': (_e, _ctx) => {
        // No bookkeeping needed for now.
    },

    'turn-started': (e, ctx) => {
        if (!ctx.rosterIds.has(e.actorId)) return;
        ctx.openTurn(e.actorId);
    },

    'turn-ended': (_e, ctx) => {
        ctx.currentTurn = undefined;
        ctx.openAttackEntry = undefined;
    },

    'ability-performed': (e, ctx) => {
        if (!ctx.currentTurn) return;
        const entry: CombatLogEntry = {
            kind: 'attack',
            actorId: e.actorId,
            targets: [],
            reactions: [],
        };
        ctx.attachEntry(entry);
        ctx.openAttackEntry = entry;
    },

    attacked: (e, ctx) => {
        if (!ctx.openAttackEntry) return;
        const target: CombatLogTarget = {
            targetId: e.targetId,
            didCrit: e.didCrit,
            shieldWasHit: e.shieldWasHit,
            didHit: true,
        };
        // For the primary target, set the damage from ability-performed's damage value
        // (full AoE/multi-hit dedup is the next task).
        if (e.isPrimaryTarget) {
            // Find the ability-performed damage by looking at the open attack entry's context.
            // The damage on the attacked event is the per-attack aggregate — use it directly.
            target.amount = e.damage;
        }
        ctx.openAttackEntry.targets.push(target);
    },

    'hp-changed': (e, ctx) => {
        ctx.setHp(e.targetId, e.newPct);
    },
};

/**
 * Folds a flat CombatEvent stream into a hierarchical view-model.
 *
 * @param events     Raw event stream from the combat engine.
 * @param roster     Actor roster — maps actorIds to name/side. Used to filter dummy actors.
 * @param _initialCharge  Initial charge state per actor (populated by a later task; ignored here).
 */
export function buildCombatLog(
    events: CombatEvent[],
    roster: RosterEntry[],
    _initialCharge: Map<string, { charge: number; max: number }>
): CombatLogRound[] {
    const rosterIds = new Set(roster.map((r) => r.actorId));
    const ctx = createBuildContext(rosterIds);

    for (const event of events) {
        const handler = (handlers as Record<string, Handler<CombatEventType> | undefined>)[
            event.type
        ];
        if (handler) {
            // Safe cast: the map key is the discriminant, so the handler receives the right shape.
            handler(event, ctx);
        }
        // Unknown event types are silently skipped (no-op).
    }

    return ctx.rounds;
}
