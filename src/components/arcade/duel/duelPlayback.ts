import type { BattleResult } from '../../../utils/calculators/battleSimulator';
import type { CombatLogEntry, CombatLogTurn } from '../../../utils/combat/log/types';

export type DuelSideKey = 'player' | 'enemy';

/** A ship's charge at the start of its latest turn, or 0 right after it fired its charged skill. */
export interface DuelCharge {
    value: number;
    max: number;
}

export interface DuelSideState {
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

export type DuelHitKind = 'damage' | 'miss' | 'heal' | 'shield';

/** One number that pops over a ship: `side` is the ship it landed on. */
export interface DuelHit {
    side: DuelSideKey;
    kind: DuelHitKind;
    /** 0 for a miss. */
    amount: number;
    crit: boolean;
}

/** One turn of the duel, with both ships' state after it. */
export interface DuelBeat {
    round: number;
    /** `null` for a beat made only of start- or end-of-round effects in a round nobody acted in. */
    actor: DuelSideKey | null;
    /** Set when the actor fired its charged skill on this turn. */
    charged: { skillName?: string } | null;
    /** In the order they happened, including the round's start- and end-of-round effects. */
    hits: DuelHit[];
    player: DuelSideState;
    enemy: DuelSideState;
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

const freshSide = (): DuelSideState => ({
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

/**
 * The fight as one beat per turn, in order, for rounds up to `outcome.lastRound` (the combat log
 * is not trimmed with `rounds`, so later log rounds are ignored).
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
 * Max HP is read from the turns' `statsSnapshot`s; without one for a side, its heals, grants and
 * absorbed damage leave the bars alone until the round end.
 */
export function buildDuelBeats(result: BattleResult): DuelBeat[] {
    const lastRound = result.outcome.lastRound;
    const sideOf = new Map(result.roster.map((r) => [r.actorId, r.side]));
    const maxHp = new Map<DuelSideKey, number>();
    for (const round of result.combatLog) {
        for (const turn of round.turns) {
            const side = sideOf.get(turn.actorId);
            const hp = turn.statsSnapshot?.maxHp;
            if (side && hp && hp > 0 && !maxHp.has(side)) maxHp.set(side, hp);
        }
    }
    const toPct = (side: DuelSideKey, amount: number): number | undefined => {
        const hp = maxHp.get(side);
        return hp ? (100 * amount) / hp : undefined;
    };

    const state: Record<DuelSideKey, DuelSideState> = {
        player: freshSide(),
        enemy: freshSide(),
    };
    const beats: DuelBeat[] = [];

    const apply = (entry: CombatLogEntry, hits: DuelHit[]) => {
        if (entry.kind === 'death') {
            const side = sideOf.get(entry.actorId);
            if (side) {
                Object.assign(state[side], {
                    hpPct: 0,
                    shieldPct: 0,
                    alive: false,
                    buffs: [],
                    debuffs: [],
                });
            }
        }
        for (const target of entry.targets) {
            const side = sideOf.get(target.targetId);
            if (!side) continue;
            const s = state[side];
            const amount = target.amount ?? 0;
            if (DAMAGE_KINDS.has(entry.kind)) {
                if (target.didHit === false) {
                    hits.push({ side, kind: 'miss', amount: 0, crit: false });
                    continue;
                }
                if (target.convertedToDot) continue;
                if (amount > 0) hits.push({ side, kind: 'damage', amount, crit: !!target.didCrit });
                const before = s.hpPct;
                if (target.resultingHpPct !== undefined) s.hpPct = clamp(target.resultingHpPct);
                if (target.shieldWasHit && amount > 0) {
                    const total = toPct(side, amount);
                    if (total !== undefined) {
                        const toHp = target.resultingHpPct !== undefined ? before - s.hpPct : 0;
                        s.shieldPct = clamp(s.shieldPct - Math.max(0, total - Math.max(0, toHp)));
                    }
                }
            } else if (HEAL_KINDS.has(entry.kind)) {
                if (amount <= 0) continue;
                hits.push({ side, kind: 'heal', amount, crit: !!target.didCrit });
                const pct = toPct(side, amount);
                if (pct !== undefined && s.alive) s.hpPct = clamp(s.hpPct + pct);
            } else if (entry.kind === 'shield') {
                if (amount <= 0) continue;
                hits.push({ side, kind: 'shield', amount, crit: false });
                const pct = toPct(side, amount);
                if (pct !== undefined) s.shieldPct = clamp(s.shieldPct + pct);
            } else if (entry.kind === 'shield-stripped') {
                const pct = toPct(side, amount);
                if (pct !== undefined) s.shieldPct = clamp(s.shieldPct - pct);
            } else if (entry.kind === 'shield-destroyed') {
                s.shieldPct = 0;
            }
        }
        for (const reaction of entry.reactions) apply(reaction, hits);
    };

    const pushBeat = (round: number, turn: CombatLogTurn | null, entries: CombatLogEntry[]) => {
        const actor = turn ? (sideOf.get(turn.actorId) ?? null) : null;
        const chargedEntry = turn?.entries.find((e) => e.slot === 'charged');
        const hits: DuelHit[] = [];
        for (const entry of entries) apply(entry, hits);
        if (actor && chargedEntry && state[actor].charge) state[actor].charge.value = 0;
        beats.push({
            round,
            actor,
            charged: chargedEntry
                ? chargedEntry.skillName
                    ? { skillName: chargedEntry.skillName }
                    : {}
                : null,
            hits,
            player: copySide(state.player),
            enemy: copySide(state.enemy),
        });
    };

    for (const logRound of result.combatLog) {
        if (logRound.round > lastRound) continue;
        const firstOfRound = beats.length;
        let pending: CombatLogEntry[] = [...logRound.startOfRound];
        for (const turn of logRound.turns) {
            const actor = sideOf.get(turn.actorId);
            if (!actor || !state[actor].alive) {
                pending = pending.concat(turn.entries);
                continue;
            }
            const snap = turn.statsSnapshot;
            if (snap && snap.maxHp > 0) {
                const hpPct = clamp((100 * snap.currentHp) / snap.maxHp);
                const shieldPct = clamp((100 * snap.shieldPool) / snap.maxHp);
                Object.assign(state[actor], { hpPct, shieldPct });
                const prev = beats.length > firstOfRound ? beats[beats.length - 1] : null;
                if (prev) Object.assign(prev[actor], { hpPct, shieldPct });
            }
            if (turn.chargeMax > 0) {
                state[actor].charge = { value: turn.chargeBefore, max: turn.chargeMax };
            }
            pushBeat(logRound.round, turn, pending.concat(turn.entries));
            pending = [];
        }
        pending = pending.concat(logRound.endOfRound);
        if (beats.length > firstOfRound) {
            const last = beats[beats.length - 1];
            for (const entry of pending) apply(entry, last.hits);
            last.player = copySide(state.player);
            last.enemy = copySide(state.enemy);
        } else if (pending.length > 0) {
            pushBeat(logRound.round, null, pending);
        }

        const snapshot = result.rounds.find((r) => r.round === logRound.round);
        if (snapshot) {
            for (const ship of snapshot.ships) {
                Object.assign(state[ship.side], {
                    hpPct: clamp(ship.hpPct),
                    shieldPct: clamp(ship.shieldPct),
                    alive: ship.alive,
                    buffs: ship.alive ? compactStatuses(ship.activeBuffs ?? []) : [],
                    debuffs: ship.alive ? compactStatuses(ship.activeDebuffs ?? []) : [],
                });
            }
            const last = beats.length > firstOfRound ? beats[beats.length - 1] : null;
            if (last) {
                last.player = copySide(state.player);
                last.enemy = copySide(state.enemy);
            }
        }
    }
    return beats;
}
