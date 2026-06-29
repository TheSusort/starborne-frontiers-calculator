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
    /** The `damage` from the most-recent `ability-performed` (used for primary-target amount). */
    openAttackAbilityDamage: number | undefined;
    /** The `targetId` from the most-recent `ability-performed` (used for miss synthesis). */
    openAttackAbilityTargetId: string | undefined;
    /** The `didHit` from the most-recent `ability-performed` (used for miss synthesis). */
    openAttackAbilityDidHit: boolean | undefined;
    /** Latest known HP percentages keyed by actorId. */
    hpPct: Map<string, number>;
    /** Set of actorIds present in the roster (for filtering). */
    rosterIds: Set<string>;
    /**
     * Running charge level per actor. Seeded from initialCharge at construction;
     * updated whenever a charge-changed event is processed.
     */
    runningCharge: Map<string, number>;
    /**
     * Max charge per actor, sourced from initialCharge. Immutable after seeding.
     */
    chargeMax: Map<string, number>;
    /**
     * Pending skill-fired data for the current turn, cleared at turn boundaries
     * and consumed by the first action-producing entry (ability-performed).
     */
    pendingSkill: { skillName?: string; slot: 'active' | 'charged' } | undefined;

    /** Push a new round and set it as current. */
    openRound(round: number): void;
    /** Push a new turn onto the current round and set it as current. */
    openTurn(actorId: string): void;
    /** Attach an entry to the current turn. */
    attachEntry(entry: CombatLogEntry): void;
    /** Update the running HP map and stamp the most-recent matching target. */
    setHp(actorId: string, pct: number): void;
    /**
     * If the open attack entry has zero targets and didHit was false, synthesize a
     * miss target. Called before closing or replacing the open entry.
     */
    finalizeMissEntry(): void;
    /**
     * Finalize any pending miss entry, then clear all open-attack state.
     * Called at every boundary (openRound, openTurn, turn-ended, round-ended).
     */
    closeOpenAttack(): void;
    /**
     * Returns-and-clears the pending skill-fired data (or undefined if none).
     * Call when creating an action-producing entry so it picks up the skill tag.
     */
    consumePendingSkill(): { skillName?: string; slot: 'active' | 'charged' } | undefined;
}

function createBuildContext(
    rosterIds: Set<string>,
    initialCharge: Map<string, { charge: number; max: number }>
): BuildContext {
    // Seed running charge and max from initialCharge.
    const runningCharge = new Map<string, number>();
    const chargeMaxMap = new Map<string, number>();
    for (const [actorId, { charge, max }] of initialCharge) {
        runningCharge.set(actorId, charge);
        chargeMaxMap.set(actorId, max);
    }

    const ctx: BuildContext = {
        rounds: [],
        currentRound: undefined,
        currentTurn: undefined,
        openAttackEntry: undefined,
        openAttackAbilityDamage: undefined,
        openAttackAbilityTargetId: undefined,
        openAttackAbilityDidHit: undefined,
        hpPct: new Map(),
        rosterIds,
        runningCharge,
        chargeMax: chargeMaxMap,
        pendingSkill: undefined,

        openRound(round: number) {
            ctx.closeOpenAttack();
            const r: CombatLogRound = { round, turns: [], endOfRound: [] };
            ctx.rounds.push(r);
            ctx.currentRound = r;
            ctx.currentTurn = undefined;
        },

        openTurn(actorId: string) {
            if (!ctx.currentRound) return;
            ctx.closeOpenAttack(); // also clears pendingSkill
            const t: CombatLogTurn = {
                actorId,
                // Read chargeBefore from the running map at the moment the turn opens.
                // Assumes the engine emits turn-started BEFORE any in-turn charge-changed
                // for this actor; pre-turn-started changes ARE included (already folded
                // into runningCharge before openTurn is called).
                chargeBefore: ctx.runningCharge.get(actorId) ?? 0,
                chargeMax: ctx.chargeMax.get(actorId) ?? 0,
                entries: [],
            };
            ctx.currentRound.turns.push(t);
            ctx.currentTurn = t;
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

        finalizeMissEntry() {
            if (
                ctx.openAttackEntry &&
                ctx.openAttackEntry.targets.length === 0 &&
                ctx.openAttackAbilityDidHit === false &&
                ctx.openAttackAbilityTargetId !== undefined
            ) {
                const missTarget: CombatLogTarget = {
                    targetId: ctx.openAttackAbilityTargetId,
                    didHit: false,
                };
                ctx.openAttackEntry.targets.push(missTarget);
            }
        },

        closeOpenAttack() {
            ctx.finalizeMissEntry();
            ctx.openAttackEntry = undefined;
            ctx.openAttackAbilityDamage = undefined;
            ctx.openAttackAbilityTargetId = undefined;
            ctx.openAttackAbilityDidHit = undefined;
            // Clear pending skill at every turn/round boundary so it never bleeds.
            ctx.pendingSkill = undefined;
        },

        consumePendingSkill() {
            const pending = ctx.pendingSkill;
            ctx.pendingSkill = undefined;
            return pending;
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

    'round-ended': (_e, ctx) => {
        ctx.closeOpenAttack();
    },

    'turn-started': (e, ctx) => {
        if (!ctx.rosterIds.has(e.actorId)) return;
        ctx.openTurn(e.actorId);
    },

    'turn-ended': (_e, ctx) => {
        ctx.closeOpenAttack(); // also clears pendingSkill
        ctx.currentTurn = undefined;
    },

    'skill-fired': (e, ctx) => {
        if (!ctx.currentTurn) return;
        ctx.pendingSkill = { skillName: e.skillName, slot: e.slot };
    },

    'charge-changed': (e, ctx) => {
        // Update running charge for this actor regardless of current turn.
        ctx.runningCharge.set(e.actorId, e.newCharge);

        // Produce a log entry in the current turn.
        if (!ctx.currentTurn) return;
        let note: string;
        switch (e.reason) {
            case 'gen':
                note = `charge ${e.oldCharge}→${e.newCharge}`;
                break;
            case 'cast-reset':
                note = `charge reset (${e.oldCharge}→${e.newCharge})`;
                break;
            case 'manip':
                note = `charge ${e.oldCharge}→${e.newCharge} (manip)`;
                break;
        }
        const entry: CombatLogEntry = {
            kind: 'charge-changed',
            actorId: e.actorId,
            targets: [],
            reactions: [],
            note,
        };
        ctx.attachEntry(entry);
    },

    'ability-performed': (e, ctx) => {
        if (!ctx.currentTurn) return;
        // Finalize any pending miss entry before opening a new one.
        ctx.finalizeMissEntry();
        // Consume pending skill-fired data (if any) and stamp onto the entry.
        const entry: CombatLogEntry = {
            kind: 'attack',
            actorId: e.actorId,
            targets: [],
            reactions: [],
            ...(ctx.consumePendingSkill() ?? {}),
        };
        ctx.attachEntry(entry);
        ctx.openAttackEntry = entry;
        ctx.openAttackAbilityDamage = e.damage;
        ctx.openAttackAbilityTargetId = e.targetId;
        ctx.openAttackAbilityDidHit = e.didHit;
    },

    attacked: (e, ctx) => {
        if (!ctx.openAttackEntry) return;
        // Find-or-create the target for this victim (dedup by targetId).
        const existing = ctx.openAttackEntry.targets.find((t) => t.targetId === e.targetId);
        if (existing) {
            // Multi-hit on the same victim: OR-accumulate didCrit and shieldWasHit, leave amount unchanged.
            if (e.didCrit) existing.didCrit = true;
            if (e.shieldWasHit) existing.shieldWasHit = true;
            return;
        }
        // New victim — determine amount based on primary vs. splash.
        const isPrimary = e.isPrimaryTarget === true;
        const amount = isPrimary ? ctx.openAttackAbilityDamage : e.damage;
        const target: CombatLogTarget = {
            targetId: e.targetId,
            amount,
            didCrit: e.didCrit,
            shieldWasHit: e.shieldWasHit,
            didHit: true,
        };
        ctx.openAttackEntry.targets.push(target);
    },

    'hp-changed': (e, ctx) => {
        ctx.setHp(e.targetId, e.newPct);
    },
};

/**
 * Folds a flat CombatEvent stream into a hierarchical view-model.
 *
 * @param events         Raw event stream from the combat engine.
 * @param roster         Actor roster — maps actorIds to name/side. Used to filter dummy actors.
 * @param initialCharge  Initial charge state per actor — seeds chargeBefore/chargeMax on turns.
 */
export function buildCombatLog(
    events: CombatEvent[],
    roster: RosterEntry[],
    initialCharge: Map<string, { charge: number; max: number }>
): CombatLogRound[] {
    const rosterIds = new Set(roster.map((r) => r.actorId));
    const ctx = createBuildContext(rosterIds, initialCharge);

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
