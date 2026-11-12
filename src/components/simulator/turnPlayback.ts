import type { Position } from '../../types/encounters';
import type { BattleResult, BattleRound } from '../../utils/calculators/battleSimulator';
import type { HexBoardShip } from '../board/AnimatedHexBoard';
import { beatBoardShip, type BoardShipIdentity } from '../board/beatBoardShip';
import type { CombatLogEntry } from '../../utils/combat/log/types';
import {
    compactStatuses,
    dotChipName,
    statusBaseName,
    type FightBeat,
    type FightSide,
} from '../board/fightBeats';

/**
 * Where a simulator playback stands: a round (1-based) and a turn within it, the index into that
 * round's beats. `turn: null` is the round's end, which shows the round's last beat as a still
 * (no numbers, no acting rim); a round without beats only has its end.
 */
export interface Playhead {
    round: number;
    turn: number | null;
}

/** Each round's beats as indices into `beats`, in order. */
export function beatsByRound(beats: readonly FightBeat[]): Map<number, number[]> {
    const byRound = new Map<number, number[]>();
    beats.forEach((beat, i) => {
        const list = byRound.get(beat.round);
        if (list) list.push(i);
        else byRound.set(beat.round, [i]);
    });
    return byRound;
}

const countIn = (byRound: Map<number, number[]>, round: number) => byRound.get(round)?.length ?? 0;

/** The next turn, crossing into the next round after a round's last turn; `null` at the fight's
 *  end. A round's end counts as its last turn. */
export function nextPlayhead(
    p: Playhead,
    byRound: Map<number, number[]>,
    totalRounds: number
): Playhead | null {
    const n = countIn(byRound, p.round);
    const pos = p.turn ?? n - 1;
    if (n > 0 && pos < n - 1) return { round: p.round, turn: pos + 1 };
    if (p.round >= totalRounds) return null;
    const next = p.round + 1;
    return { round: next, turn: countIn(byRound, next) > 0 ? 0 : null };
}

/** The previous turn, crossing back into the previous round's last turn; `null` at the start. */
export function prevPlayhead(p: Playhead, byRound: Map<number, number[]>): Playhead | null {
    const n = countIn(byRound, p.round);
    const pos = p.turn ?? n - 1;
    if (n > 0 && pos > 0) return { round: p.round, turn: pos - 1 };
    if (p.round <= 1) return null;
    const prev = p.round - 1;
    const m = countIn(byRound, prev);
    return { round: prev, turn: m > 0 ? m - 1 : null };
}

/** Where Play starts: a round's end replays that round from its first turn, the fight's last turn
 *  replays the fight from the start, anywhere else plays on from the next turn. */
export function playStart(
    p: Playhead,
    byRound: Map<number, number[]>,
    totalRounds: number
): Playhead {
    if (p.turn === null && countIn(byRound, p.round) > 0) return { round: p.round, turn: 0 };
    const next = nextPlayhead(p, byRound, totalRounds);
    if (next) return next;
    return { round: 1, turn: countIn(byRound, 1) > 0 ? 0 : null };
}

/** The beat the board draws at `p`: the turn's, the round's last at its end, `null` for a round
 *  without beats. */
export function shownBeat(p: Playhead, byRound: Map<number, number[]>): number | null {
    const list = byRound.get(p.round);
    if (!list || list.length === 0) return null;
    return list[p.turn === null ? list.length - 1 : Math.min(p.turn, list.length - 1)];
}

/** Each side's roster entries in roster order: ship `i` of a beat's side is entry `i` here. */
export function rosterBySide(roster: BattleResult['roster']): Record<FightSide, string[]> {
    return {
        player: roster.filter((r) => r.side === 'player').map((r) => r.actorId),
        enemy: roster.filter((r) => r.side === 'enemy').map((r) => r.actorId),
    };
}

interface BoardArgs {
    result: BattleResult;
    beats: FightBeat[];
    side: FightSide;
    /** The beat drawn, or `null` to draw the round-end snapshot of `round`. */
    beat: number | null;
    round: BattleRound | undefined;
    /** A turn is playing: numbers, the acting rim and a charged banner are shown. */
    live: boolean;
    /** Floating numbers and the hit flash; off under reduced motion. */
    motion: boolean;
    identity: (actorId: string) => BoardShipIdentity;
}

/**
 * One side's cells while the playback stands on `beat`. Without a beat (a round nobody acted
 * in) the cells come from the round-end snapshot, which carries no charge.
 */
export function sideBoardShips({
    result,
    beats,
    side,
    beat,
    round,
    live,
    motion,
    identity,
}: BoardArgs): Partial<Record<Position, HexBoardShip>> {
    const ids = rosterBySide(result.roster)[side];
    const position = new Map(result.roster.map((r) => [r.actorId, r.position]));
    const ships: Partial<Record<Position, HexBoardShip>> = {};
    if (beat !== null) {
        beats[beat][side].forEach((state, i) => {
            const actorId = ids[i];
            if (!actorId) return;
            ships[state.position] = beatBoardShip(identity(actorId), beats, beat, live, side, i, {
                motion,
            });
        });
        return ships;
    }
    for (const s of round?.ships ?? []) {
        const cell = position.get(s.actorId);
        if (s.side !== side || !cell) continue;
        ships[cell] = {
            ...identity(s.actorId),
            hpPct: Math.max(0, Math.min(100, s.hpPct)),
            shieldPct: Math.max(0, Math.min(100, s.shieldPct)),
            chargePct: null,
            buffs: s.alive ? compactStatuses(s.activeBuffs ?? []) : [],
            debuffs: s.alive ? compactStatuses(s.activeDebuffs ?? []) : [],
            alive: s.alive,
        };
    }
    return ships;
}

/** The actor of `beat`, or `null` for a beat of round effects only. */
export function beatActorId(result: BattleResult, beat: FightBeat | undefined): string | null {
    if (!beat?.actor) return null;
    return rosterBySide(result.roster)[beat.actor][beat.actorShip] ?? null;
}

/** One line of the target overlay: from the acting ship's cell to a ship its attacks reach. */
export interface TargetLine {
    role: 'main' | 'splash';
    from: { side: FightSide; cell: Position };
    to: { side: FightSide; cell: Position };
}

/** The lines to draw while `beat` plays: its actor to each of its targets (a multi-hex target at
 *  its anchor cell). None without an actor or targets, and none from a ship to its own cell. */
export function targetLines(beat: FightBeat | undefined): TargetLine[] {
    if (!beat?.actor || !beat.targets) return [];
    const from = { side: beat.actor, cell: beat[beat.actor][beat.actorShip]?.position };
    if (!from.cell) return [];
    const lines: TargetLine[] = [];
    for (const t of beat.targets) {
        const cell = beat[t.side][t.ship]?.position;
        if (!cell || (t.side === from.side && cell === from.cell)) continue;
        lines.push({
            role: t.role,
            from: { ...from, cell: from.cell },
            to: { side: t.side, cell },
        });
    }
    return lines;
}

/** Who last applied each status a ship holds, keyed by holder and status name. */
export type StatusSources = Map<string, string>;

const sourceKey = (holderId: string, name: string) => `${holderId}\u0000${name}`;

const eachEntry = (entries: readonly CombatLogEntry[], visit: (e: CombatLogEntry) => void) => {
    for (const e of entries) {
        visit(e);
        eachEntry(e.reactions, visit);
    }
};

/**
 * The latest granter (a `buff`'s `actorId`) or applier (a `debuff` or DoT's) of each status, per
 * holder, from the combat log's rounds up to `upToRound`. A status is recorded under its name and
 * under its tier-stripped base, so a later look-up by either finds it; an `attemptOnly` row
 * changed nothing and is skipped. Pass the round whose end-of-round snapshot the statuses being
 * looked up come from: a later round could name an applier the ship does not yet have.
 */
export function statusSources(result: BattleResult, upToRound: number): StatusSources {
    const sources: StatusSources = new Map();
    const record = (e: CombatLogEntry) => {
        if (e.attemptOnly || !e.note) return;
        if (e.kind !== 'buff' && e.kind !== 'debuff' && e.kind !== 'dot-applied') return;
        const name = e.kind === 'dot-applied' ? dotChipName(e.note) : e.note;
        if (!name) return;
        for (const t of e.targets) {
            sources.set(sourceKey(t.targetId, name), e.actorId);
            sources.set(sourceKey(t.targetId, statusBaseName(name)), e.actorId);
        }
    };
    for (const round of result.combatLog) {
        if (round.round > upToRound) break;
        eachEntry(round.startOfRound, record);
        for (const turn of round.turns) eachEntry(turn.entries, record);
        eachEntry(round.endOfRound, record);
    }
    return sources;
}

/** The actorId that applied status `name` to `holderId`: by exact name, else by the name without
 *  its tier; `undefined` when the log never named it. */
export function statusSource(
    sources: StatusSources,
    holderId: string,
    name: string
): string | undefined {
    return (
        sources.get(sourceKey(holderId, name)) ??
        sources.get(sourceKey(holderId, statusBaseName(name)))
    );
}
