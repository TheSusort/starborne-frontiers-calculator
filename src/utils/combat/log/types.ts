export interface CombatLogRound {
    round: number;
    turns: CombatLogTurn[];
    endOfRound: CombatLogEntry[]; // round-end-drained entries with no enclosing turn (filled by a later task)
}

export interface CombatLogTurn {
    actorId: string;
    chargeBefore: number; // charge level at turn start (filled by a later task; 0 for now)
    chargeMax: number; // 0 = no charge skill (filled by a later task)
    entries: CombatLogEntry[]; // chronological within the turn
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
    | 'bomb';

export interface CombatLogEntry {
    kind: CombatLogEntryKind;
    actorId: string;
    skillName?: string;
    slot?: 'active' | 'charged';
    targets: CombatLogTarget[]; // 1 = single-target, N = AoE
    reactions: CombatLogEntry[]; // reactions triggered BY this entry (filled by a later task; [] for now)
    note?: string;
}

export interface CombatLogTarget {
    targetId: string;
    amount?: number; // damage or heal to THIS target
    didCrit?: boolean;
    didHit?: boolean; // false = miss/dodge
    resultingHpPct?: number;
    shieldWasHit?: boolean;
}
