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
     *  actor (R7′). Absent when the applier is unknown (scheduled channel) or, in principle, when
     *  the healer id itself is unknown — never falls back to the applier. */
    healerId?: string;
}

export interface CombatLogTarget {
    targetId: string;
    amount?: number; // damage or heal to THIS target
    didCrit?: boolean;
    didHit?: boolean; // false = miss/dodge
    resultingHpPct?: number;
    shieldWasHit?: boolean;
}
