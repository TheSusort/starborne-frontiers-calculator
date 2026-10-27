import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatLogEntry, CombatLogTurn } from '../../../utils/combat/log/types';
import type { Position } from '../../../types/encounters';
import type { FloatingHit } from '../../board/FloatingHits';

export type DuelSideKey = 'player' | 'enemy';

/** A ship's charge at the start of its latest turn, or 0 right after it fired its charged skill. */
export interface DuelCharge {
    value: number;
    max: number;
}

export interface DuelSideState {
    /** The board cell the ship stands on, from the battle's roster. */
    position: Position;
    hpPct: number;
    /** The shield pool as a percentage of max HP, 0..100. */
    shieldPct: number;
    /** Active buffs and debuffs as of the latest round end, deduplicated by `compactStatuses`.
     *  Empty once the ship is destroyed. */
    buffs: string[];
    debuffs: string[];
    alive: boolean;
    /** `null` for a ship with no charged skill, or before its first turn. */
    charge: DuelCharge | null;
}

/** One number that pops over a ship: `side` and `ship` (its index in `DuelBeat[side]`) name the
 *  ship it landed on. */
export interface DuelHit extends FloatingHit {
    side: DuelSideKey;
    ship: number;
}

/** One turn of the fight, with every ship's state after it. */
export interface DuelBeat {
    round: number;
    /** `null` for a beat made only of start- or end-of-round effects in a round nobody acted in. */
    actor: DuelSideKey | null;
    /** The acting ship's index in `DuelBeat[actor]`; 0 when `actor` is `null`. */
    actorShip: number;
    /** Set when the actor fired its charged skill on this turn. */
    charged: { skillName?: string } | null;
    /** In the order they happened, including the round's start- and end-of-round effects. */
    hits: DuelHit[];
    /** Each side's ships in roster order: the order the side's placements were given to the
     *  battle (see `runTeamDuel`), not board order. */
    player: DuelSideState[];
    enemy: DuelSideState[];
}

/** Each turn plays for this long, unless the fight has so many turns that the whole playback
 *  would run past `MAX_PLAYBACK_SECONDS`; then every turn shrinks to fit. */
export const BEAT_SECONDS = 0.5;
export const MAX_PLAYBACK_SECONDS = 10;
export const beatSeconds = (beats: number) =>
    beats > 0 ? Math.min(BEAT_SECONDS, MAX_PLAYBACK_SECONDS / beats) : 0;

const clamp = (v: number) => Math.max(0, Math.min(100, v));

const TIER = /^(.*\S)\s+(I|II|III|IV|V)$/;
const TIER_RANK: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

/**
 * Duplicate names removed, and of the tiers of one status ("Attack Down II", "Attack Down III")
 * only the highest is kept, in the position of the first one seen. Highest tier wins in game, so
 * a lower tier still in the store does nothing.
 */
export function compactStatuses(names: readonly string[]): string[] {
    const out: string[] = [];
    const byBase = new Map<string, { index: number; rank: number }>();
    for (const name of names) {
        const m = TIER.exec(name);
        const base = m ? m[1] : name;
        const rank = m ? TIER_RANK[m[2]] : 0;
        const seen = byBase.get(base);
        if (!seen) {
            byBase.set(base, { index: out.length, rank });
            out.push(name);
        } else if (rank > seen.rank) {
            seen.rank = rank;
            out[seen.index] = name;
        }
    }
    return out;
}

const DAMAGE_KINDS = new Set<CombatLogEntry['kind']>([
    'attack',
    'dot-ticked',
    'detonation',
    'bomb',
    'reversed-repair',
]);
const HEAL_KINDS = new Set<CombatLogEntry['kind']>(['heal', 'hot-ticked']);

const freshSide = (position: Position): DuelSideState => ({
    position,
    hpPct: 100,
    shieldPct: 0,
    buffs: [],
    debuffs: [],
    alive: true,
    charge: null,
});

const copySide = (s: DuelSideState): DuelSideState => ({
    ...s,
    buffs: [...s.buffs],
    debuffs: [...s.debuffs],
    charge: s.charge && { ...s.charge },
});

/** Where a roster ship sits in a beat: its side and its index among that side's ships. */
interface Seat {
    side: DuelSideKey;
    ship: number;
}

/**
 * The fight as one beat per turn, in order, for rounds up to `outcome.lastRound` (the combat log
 * is not trimmed with `rounds`, so later log rounds are ignored). Every ship of each side has its
 * own state, in roster order, with the cell it stands on.
 *
 * Where each value comes from:
 * - HP: a struck target's `resultingHpPct`; a heal's landed `amount` over the ship's max HP; a
 *   `death` entry (whose `actorId` is the destroyed ship) sets 0.
 * - Shield: grants add their landed `amount`, strips subtract theirs, `shield-destroyed` empties
 *   it, and a hit with `shieldWasHit` removes the part of its damage that did not reach HP.
 * - The acting ship's `statsSnapshot` (taken at its turn start) overrides its HP and shield, and
 *   also corrects the previous beat of the same round, since nothing happens between the two.
 * - Every value, buffs and debuffs included, snaps to the round-end snapshot on the round's last
 *   beat, so an estimate never drifts past a round. Buffs and debuffs come from the round-end
 *   snapshot ONLY: the log names neither what a cleanse, purge or steal removed nor DoTs the way
 *   the snapshot does.
 *
 * Max HP is read per ship from its turns' `statsSnapshot`s; without one, that ship's heals,
 * grants and absorbed damage leave its bars alone until the round end.
 */
export function buildDuelBeats(result: BattleResult): DuelBeat[] {
    const lastRound = result.outcome.lastRound;
    const seats = new Map<string, Seat>();
    const state: Record<DuelSideKey, DuelSideState[]> = { player: [], enemy: [] };
    for (const r of result.roster) {
        seats.set(r.actorId, { side: r.side, ship: state[r.side].length });
        state[r.side].push(freshSide(r.position));
    }
    const maxHp = new Map<string, number>();
    for (const round of result.combatLog) {
        for (const turn of round.turns) {
            const hp = turn.statsSnapshot?.maxHp;
            if (seats.has(turn.actorId) && hp && hp > 0 && !maxHp.has(turn.actorId)) {
                maxHp.set(turn.actorId, hp);
            }
        }
    }
    const toPct = (actorId: string, amount: number): number | undefined => {
        const hp = maxHp.get(actorId);
        return hp ? (100 * amount) / hp : undefined;
    };

    const stateOf = (seat: Seat) => state[seat.side][seat.ship];
    const copyAll = () => ({
        player: state.player.map(copySide),
        enemy: state.enemy.map(copySide),
    });
    const beats: DuelBeat[] = [];

    const apply = (entry: CombatLogEntry, hits: DuelHit[]) => {
        if (entry.kind === 'death') {
            const seat = seats.get(entry.actorId);
            if (seat) {
                Object.assign(stateOf(seat), {
                    hpPct: 0,
                    shieldPct: 0,
                    alive: false,
                    buffs: [],
                    debuffs: [],
                });
            }
        }
        for (const target of entry.targets) {
            const seat = seats.get(target.targetId);
            if (!seat) continue;
            const { side, ship } = seat;
            const s = stateOf(seat);
            const amount = target.amount ?? 0;
            if (DAMAGE_KINDS.has(entry.kind)) {
                if (target.didHit === false) {
                    hits.push({ side, ship, kind: 'miss', amount: 0, crit: false });
                    continue;
                }
                if (target.convertedToDot) continue;
                if (amount > 0) {
                    hits.push({ side, ship, kind: 'damage', amount, crit: !!target.didCrit });
                }
                const before = s.hpPct;
                if (target.resultingHpPct !== undefined) s.hpPct = clamp(target.resultingHpPct);
                if (target.shieldWasHit && amount > 0) {
                    const total = toPct(target.targetId, amount);
                    if (total !== undefined) {
                        const toHp = target.resultingHpPct !== undefined ? before - s.hpPct : 0;
                        s.shieldPct = clamp(s.shieldPct - Math.max(0, total - Math.max(0, toHp)));
                    }
                }
            } else if (HEAL_KINDS.has(entry.kind)) {
                if (amount <= 0) continue;
                hits.push({ side, ship, kind: 'heal', amount, crit: !!target.didCrit });
                const pct = toPct(target.targetId, amount);
                if (pct !== undefined && s.alive) s.hpPct = clamp(s.hpPct + pct);
            } else if (entry.kind === 'shield') {
                if (amount <= 0) continue;
                hits.push({ side, ship, kind: 'shield', amount, crit: false });
                const pct = toPct(target.targetId, amount);
                if (pct !== undefined) s.shieldPct = clamp(s.shieldPct + pct);
            } else if (entry.kind === 'shield-stripped') {
                const pct = toPct(target.targetId, amount);
                if (pct !== undefined) s.shieldPct = clamp(s.shieldPct - pct);
            } else if (entry.kind === 'shield-destroyed') {
                s.shieldPct = 0;
            }
        }
        for (const reaction of entry.reactions) apply(reaction, hits);
    };

    /** `hits` may already hold the numbers of entries applied before the turn's snapshot. */
    const pushBeat = (
        round: number,
        turn: CombatLogTurn | null,
        entries: CombatLogEntry[],
        hits: DuelHit[] = []
    ) => {
        const seat = turn ? (seats.get(turn.actorId) ?? null) : null;
        const chargedEntry = turn?.entries.find((e) => e.slot === 'charged');
        for (const entry of entries) apply(entry, hits);
        const charge = seat && stateOf(seat).charge;
        if (charge && chargedEntry) charge.value = 0;
        beats.push({
            round,
            actor: seat?.side ?? null,
            actorShip: seat?.ship ?? 0,
            charged: chargedEntry
                ? chargedEntry.skillName
                    ? { skillName: chargedEntry.skillName }
                    : {}
                : null,
            hits,
            ...copyAll(),
        });
    };

    for (const logRound of result.combatLog) {
        if (logRound.round > lastRound) continue;
        const firstOfRound = beats.length;
        let pending: CombatLogEntry[] = [...logRound.startOfRound];
        for (const turn of logRound.turns) {
            const seat = seats.get(turn.actorId);
            if (!seat || !stateOf(seat).alive) {
                pending = pending.concat(turn.entries);
                continue;
            }
            // Entries before the turn are applied first: the turn-start snapshot already
            // includes them, so applying them after it would count relative changes twice.
            const earlier: DuelHit[] = [];
            for (const entry of pending) apply(entry, earlier);
            const actor = stateOf(seat);
            const snap = turn.statsSnapshot;
            if (snap && snap.maxHp > 0) {
                const hpPct = clamp((100 * snap.currentHp) / snap.maxHp);
                const shieldPct = clamp((100 * snap.shieldPool) / snap.maxHp);
                Object.assign(actor, { hpPct, shieldPct });
                const prev = beats.length > firstOfRound ? beats[beats.length - 1] : null;
                if (prev) Object.assign(prev[seat.side][seat.ship], { hpPct, shieldPct });
            }
            if (turn.chargeMax > 0) {
                actor.charge = { value: turn.chargeBefore, max: turn.chargeMax };
            }
            pushBeat(logRound.round, turn, turn.entries, earlier);
            pending = [];
        }
        pending = pending.concat(logRound.endOfRound);
        if (beats.length > firstOfRound) {
            const last = beats[beats.length - 1];
            for (const entry of pending) apply(entry, last.hits);
            Object.assign(last, copyAll());
        } else if (pending.length > 0) {
            pushBeat(logRound.round, null, pending);
        }

        const snapshot = result.rounds.find((r) => r.round === logRound.round);
        if (snapshot) {
            for (const ship of snapshot.ships) {
                const seat = seats.get(ship.actorId);
                if (!seat) continue;
                Object.assign(stateOf(seat), {
                    hpPct: clamp(ship.hpPct),
                    shieldPct: clamp(ship.shieldPct),
                    alive: ship.alive,
                    buffs: ship.alive ? compactStatuses(ship.activeBuffs ?? []) : [],
                    debuffs: ship.alive ? compactStatuses(ship.activeDebuffs ?? []) : [],
                });
            }
            const last = beats.length > firstOfRound ? beats[beats.length - 1] : null;
            if (last) Object.assign(last, copyAll());
        }
    }
    return beats;
}
