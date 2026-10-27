import type { Position } from '../../types/encounters';
import type { BattleResult, BattleRound } from '../../utils/calculators/battleSimulator';
import type { HexBoardShip } from '../board/AnimatedHexBoard';
import { beatBoardShip, type BoardShipIdentity } from '../board/beatBoardShip';
import { compactStatuses, type FightBeat, type FightSide } from '../board/fightBeats';

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
