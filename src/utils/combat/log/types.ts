export interface CombatLogRound {
    round: number;
    /** Entries drained after round-started but before the first turn (start-of-round reactives). */
    startOfRound: CombatLogEntry[];
    turns: CombatLogTurn[];
    endOfRound: CombatLogEntry[]; // round-end-drained entries with no enclosing turn (filled by a later task)
}

export interface CombatLogTurn {
    actorId: string;
    chargeBefore: number; // charge level at turn start (filled by a later task; 0 for now)
    chargeMax: number; // 0 = no charge skill (filled by a later task)
    entries: CombatLogEntry[]; // chronological within the turn
    /** Task 6: a snapshot of the acting actor's live modelled stats, taken immediately after
     *  turn-started (see the `stats-snapshot` CombatEvent). Optional — absent on any turn built
     *  from an event stream that predates/omits the emission (e.g. hand-crafted test fixtures). */
    statsSnapshot?: StatsSnapshot;
}

/** Task 6: per-turn modelled stat snapshot for the acting actor (mirrors the `stats-snapshot`
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
    reactions: CombatLogEntry[]; // reactions triggered BY this entry (filled by a later task; [] for now)
    note?: string;
    /** #362 fix-wave-1, `reversed-repair` ONLY: the healer whose repair was reversed, for DISPLAY
     *  alone ("Zosimos → Nova: Medic's repair reversed 10,000"). A dedicated field rather than
     *  folded into `note` — `note` is already spoken for by `debuff-resisted`. Carrying no
     *  attribution weight: `actorId` is the debuff's APPLIER and stays the entry's sole credited
     *  actor (R7′).
     *
     *  PRESENT ON EVERY PRODUCED `reversed-repair` ENTRY (#362 fix-wave-2, I-2). An earlier
     *  revision of this doc said it was "absent when the applier is unknown (scheduled channel)",
     *  which was simply false in two ways: `engine.ts` sets `healerId` unconditionally (the repair
     *  source is a REQUIRED parameter at every `applyHealToTarget` call site, so there is always
     *  one), and `buildCombatLog` copies it independently of `applierId` — the two ids are on
     *  different axes and an absent applier does not suppress the healer. Optional here only
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
     *  It exists because `amount` alone could not tell the two grant kinds apart. Heal rows used to
     *  render the GROSS, so a repair onto a full ally read as a full-size heal that had plainly not
     *  moved the bar; shield rows rendered post-cap growth, so a grant onto a saturated pool read
     *  as a bare `0` with no hint anything had been attempted. Opposite failures of one missing
     *  clause. Both kinds now report the landed number and name the waste beside it.
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
