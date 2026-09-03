export interface CombatLogRound {
    round: number;
    /** Entries drained after round-started but before the first turn (start-of-round reactives). */
    startOfRound: CombatLogEntry[];
    turns: CombatLogTurn[];
    endOfRound: CombatLogEntry[]; // round-end-drained entries with no enclosing turn (buildCombatLog)
}

export interface CombatLogTurn {
    actorId: string;
    chargeBefore: number; // charge level at turn start, seeded from `initialCharge`
    chargeMax: number; // 0 = no charge skill
    entries: CombatLogEntry[]; // chronological within the turn
    /** A snapshot of the acting actor's live modelled stats, taken immediately after
     *  turn-started (see the `stats-snapshot` CombatEvent). Optional — absent on any turn built
     *  from an event stream that predates/omits the emission (e.g. hand-crafted test fixtures). */
    statsSnapshot?: StatsSnapshot;
}

/** Per-turn modelled stat snapshot for the acting actor (mirrors the `stats-snapshot`
 *  CombatEvent's `stats` payload). */
export interface StatsSnapshot {
    attack: number;
    defence: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    speed: number;
    hacking: number;
    security: number;
    currentHp: number;
    maxHp: number;
    shieldPool: number;
}

export type CombatLogEntryKind =
    | 'attack'
    | 'heal'
    | 'shield'
    | 'buff'
    | 'debuff'
    | 'dot-applied'
    | 'dot-ticked'
    | 'control'
    | 'cleanse'
    | 'purge'
    | 'charge-changed'
    | 'death'
    | 'detonation'
    | 'bomb'
    | 'buff-expired'
    | 'debuff-resisted'
    | 'shield-destroyed'
    | 'cheat-death'
    /** #362 R11: an incoming repair was turned into raw HP damage on its recipient. Booked to the
     *  DEBUFF'S APPLIER (the actor credited with the damage), with the burned ship in `targets`. */
    | 'reversed-repair';

export interface CombatLogEntry {
    kind: CombatLogEntryKind;
    actorId: string;
    skillName?: string;
    slot?: 'active' | 'charged';
    targets: CombatLogTarget[]; // 1 = single-target, N = AoE
    reactions: CombatLogEntry[]; // reactions nested under this entry by buildCombatLog's routeReaction
    note?: string;
    /** #362 fix-wave-1, `reversed-repair` ONLY: the healer whose repair was reversed, for DISPLAY
     *  alone ("Zosimos → Nova: Medic's repair reversed 10,000"). A dedicated field rather than
     *  folded into `note` — `note` is already spoken for by `debuff-resisted`. Carrying no
     *  attribution weight: `actorId` is the debuff's APPLIER and stays the entry's sole credited
     *  actor (R7′).
     *
     *  PRESENT ON EVERY PRODUCED `reversed-repair` ENTRY (#362). It is NOT "absent when the
     *  applier is unknown": `engine.ts` sets `healerId` unconditionally (the repair source is a
     *  REQUIRED parameter of `applyHealToTarget`, so there is always one), and `buildCombatLog`
     *  copies it independently of `applierId` — the two ids are on different axes and an absent
     *  applier does not suppress the healer. Optional here only
     *  because the field lives on the shared `CombatLogEntry`, which every OTHER entry kind
     *  leaves unset; the formatter's healer-less fallback string is therefore defensive, not a
     *  shape production reaches. Never falls back to the applier. */
    healerId?: string;
}

export interface CombatLogTarget {
    targetId: string;
    /** Damage, or — for the two GRANT kinds (`heal`, `shield`) — what ACTUALLY LANDED on this
     *  target: HP restored, or post-cap shield pool growth. Never the gross attempt; the portion
     *  that went nowhere rides in `overheal`/`overshield` below. */
    amount?: number;
    didCrit?: boolean;
    didHit?: boolean; // false = miss/dodge
    resultingHpPct?: number;
    shieldWasHit?: boolean;
    /** The #418 follow-up, `heal` entries only: the portion of this repair wasted on an HP bar
     *  that was already full (`heal-performed` / `reactive-heal-performed`'s `perTarget.overheal`).
     *  Present only when > 0.
     *
     *  It exists because `amount` alone cannot tell a landed repair from a wasted one: `amount` is
     *  the LANDED number for both grant kinds, so the waste is named beside it here (and in
     *  `overshield` for shield grants) rather than folded into it.
     *
     *  ABSENT ON A REVERSED REPAIR (#362): that repair damaged the target rather than being
     *  clipped, so there is no waste to report and `amount` stays the whole reversed figure. */
    overheal?: number;
    /** The shield twin of `overheal`, `shield` entries only: the portion of the grant clipped by
     *  the max-HP shield cap (`shield-applied`'s `perTarget.overshield`). Present only when > 0.
     *
     *  NOT carried by the `shield-applied-log` twins (Lifeline's mid-hit threshold pool and the
     *  shield converter, both in `engine.ts`) — that log-only event has no clip field, and both of
     *  its emit sites gate on `granted > 0`, so a fully-clipped threshold grant produces no row at
     *  all rather than an unannotated `0`. Adding the field there is an engine change, not a log
     *  one. */
    overshield?: number;
}
