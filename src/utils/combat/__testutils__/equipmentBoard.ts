/**
 * A board builder for equipment census fights: ships described by a skill text, a stat block,
 * a position and optional gear (a set's piece count, an implant's rarity), run through the REAL
 * placement path (`simulateBattle` → `planPlacement` → `buildShipAbilitiesWithEquipment` with a
 * `getGearPiece` lookup) on either side of the board.
 *
 * `runForcedBattle` pins every random roll to succeed: the rate gates fire when `rng() < rate`,
 * so an rng that always returns 0 fires every gate whose rate is above 0 (every proc, every crit
 * at crit > 0, every debuff landing at a non-zero chance) and never one at rate 0. A proc-gated
 * effect therefore fires at its first opportunity, which makes a single fight a proof that it
 * CAN fire and lets its magnitude be read off the first occurrence. Crit is controlled through
 * the `crit` stat (0 = never, 100 = always).
 */
import {
    simulateBattle,
    type BattlePlacement,
    type BattleResult,
} from '../../calculators/battleSimulator';
import { resetRateGateRng, setKeyedRng, setRateGateRng } from '../../calculators/rateAccumulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import type { CombatLogEntry } from '../log/types';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { Position } from '../../../types/encounters';
import type { SquadLeaderSelection } from '../preFight';
import type { CombatActor } from '../state';

const GEAR_SLOTS = ['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'] as const;

export interface UnitSpec {
    /** Unique display name; the result's roster is searched by it. */
    name: string;
    position: Position;
    active?: string;
    charged?: string;
    chargeCount?: number;
    passives?: string[];
    target?: string;
    pattern?: string;
    faction?: Ship['faction'];
    stats?: Partial<NonNullable<BattlePlacement['statOverrides']>>;
    /** A gear set worn as `pieces` pieces (2 = one 2-piece set, 4 = one 4-piece set). */
    set?: { name: string; pieces: number };
    /** A second set worn alongside the first (e.g. Cloaking + a stealth-gated implant). */
    set2?: { name: string; pieces: number };
    implant?: { name: string; rarity: GearPiece['rarity']; slot?: string };
    /** Live HP fraction (0..1] at combat start, applied through the engine's actor tap. */
    startHpFrac?: number;
}

export interface BoardSpec {
    player: UnitSpec[];
    enemy: UnitSpec[];
    rounds?: number;
    playerSquadLeader?: SquadLeaderSelection;
    enemySquadLeader?: SquadLeaderSelection;
}

const BASE_STATS = {
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    hacking: 0,
    security: 0,
    defence: 0,
    hp: 1_000_000,
    speed: 100,
    healModifier: 0,
};

/** Build one fresh placement (and its gear pieces) per call — never shared across arms. */
function place(u: UnitSpec, pieces: Map<string, GearPiece>, withGear: boolean): BattlePlacement {
    const equipment: Ship['equipment'] = {};
    const implants: Ship['implants'] = {};
    if (withGear) {
        let slot = 0;
        for (const s of [u.set, u.set2]) {
            if (!s) continue;
            for (let i = 0; i < s.pieces; i++) {
                const gearSlot = GEAR_SLOTS[slot++];
                const id = `${u.name}:${s.name}:${i}`;
                pieces.set(id, {
                    id,
                    slot: gearSlot,
                    level: 16,
                    stars: 6,
                    rarity: 'legendary',
                    mainStat: null,
                    subStats: [],
                    setBonus: s.name,
                });
                equipment[gearSlot] = id;
            }
        }
        if (u.implant) {
            const id = `${u.name}:implant:${u.implant.name}`;
            pieces.set(id, {
                id,
                slot: u.implant.slot ?? 'implant_major',
                level: 0,
                stars: 0,
                rarity: u.implant.rarity,
                mainStat: null,
                subStats: [],
                setBonus: u.implant.name,
            });
            (implants as Record<string, string>)[u.implant.slot ?? 'implant_major'] = id;
        }
    }
    const ship: Ship = {
        id: `ship-${u.name}`,
        name: u.name,
        rarity: 'legendary',
        faction: u.faction ?? 'MPL',
        type: 'ATTACKER',
        baseStats: { ...BASE_STATS },
        equipment,
        implants,
        refits: [],
        affinity: 'antimatter',
        activeSkillText: u.active ?? 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        chargeSkillText: u.charged,
        chargeSkillCharge: u.chargeCount ?? 0,
        firstPassiveSkillText: u.passives?.[0],
        secondPassiveSkillText: u.passives?.[1],
        thirdPassiveSkillText: u.passives?.[2],
        activeTarget: u.target ?? 'front',
        activePattern: u.pattern ?? 'Pattern-Base',
    };
    return { ship, position: u.position, statOverrides: { ...BASE_STATS, ...u.stats } };
}

export interface BoardRun {
    result: BattleResult;
    /** Display name → engine actor id. */
    id: (name: string) => string;
    entries: CombatLogEntry[];
}

/** Run the board with every random roll succeeding. `withGear: false` is the control arm: the
 *  same board, rebuilt from scratch, with no gear piece on any ship. */
export function runForcedBattle(board: BoardSpec, withGear: boolean): BoardRun {
    const pieces = new Map<string, GearPiece>();
    const playerTeam = board.player.map((u) => place(u, pieces, withGear));
    const enemyTeam = board.enemy.map((u) => place(u, pieces, withGear));
    const hpFrac = new Map<string, number>();
    for (const u of [...board.player, ...board.enemy]) {
        if (u.startHpFrac !== undefined) hpFrac.set(u.name, u.startHpFrac);
    }
    setRateGateRng(() => 0);
    setKeyedRng(() => 0);
    let result: BattleResult;
    try {
        result = simulateBattle(
            {
                playerTeam,
                enemyTeam,
                rounds: board.rounds ?? 3,
                playerSquadLeader: board.playerSquadLeader,
                enemySquadLeader: board.enemySquadLeader,
                ...(hpFrac.size
                    ? {
                          __testTapActors: (actors: CombatActor[]) =>
                              applyHpFractions(actors, board, hpFrac),
                      }
                    : {}),
            },
            (id) => pieces.get(id)
        );
    } finally {
        resetRateGateRng();
    }
    const id = (name: string): string => {
        const r = result.roster.find((x) => x.name === name);
        if (!r) throw new Error(`no roster entry named ${name}`);
        return r.actorId;
    };
    return { result, id, entries: flattenCombatLog(result) };
}

/** The engine actor id `simulateBattle` mints for a unit: player index 0 is the focus
 *  (`'attacker'`), every other unit is `p:<shipId>:<i>` / `e:<shipId>:<i>`. */
const actorIdOf = (side: 'player' | 'enemy', u: UnitSpec, i: number): string =>
    side === 'player' && i === 0
        ? 'attacker'
        : `${side === 'player' ? 'p' : 'e'}:ship-${u.name}:${i}`;

function applyHpFractions(
    actors: CombatActor[],
    board: BoardSpec,
    hpFrac: Map<string, number>
): void {
    const sides: Array<['player' | 'enemy', UnitSpec[]]> = [
        ['player', board.player],
        ['enemy', board.enemy],
    ];
    for (const [side, units] of sides) {
        units.forEach((u, i) => {
            const frac = hpFrac.get(u.name);
            if (frac === undefined) return;
            const actor = actors.find((a) => a.id === actorIdOf(side, u, i));
            if (!actor) throw new Error(`startHpFrac: no actor for ${u.name}`);
            actor.currentHp = actor.stats.hp * frac;
        });
    }
}

/** Mirror a board: the player side becomes the enemy side and vice versa. Positions are kept
 *  (both sides use the same grid labels). */
export function mirrorBoard(board: BoardSpec): BoardSpec {
    return {
        ...board,
        player: board.enemy,
        enemy: board.player,
        playerSquadLeader: board.enemySquadLeader,
        enemySquadLeader: board.playerSquadLeader,
    };
}

// ---------------------------------------------------------------------------------------------
// Log readers
// ---------------------------------------------------------------------------------------------

/** Every entry of `kind` (optionally by `actor`, optionally touching `target`, optionally with a
 *  `note` that starts with `note`). */
export function entriesOf(
    run: BoardRun,
    kind: CombatLogEntry['kind'],
    opts: { actor?: string; target?: string; note?: string } = {}
): CombatLogEntry[] {
    return run.entries.filter(
        (e) =>
            e.kind === kind &&
            (opts.actor === undefined || e.actorId === run.id(opts.actor)) &&
            (opts.target === undefined ||
                e.targets.some((t) => t.targetId === run.id(opts.target!))) &&
            (opts.note === undefined || (e.note ?? '').startsWith(opts.note))
    );
}

/** Sum of target amounts (+ overheal / overshield, i.e. the GROSS grant) on `kind` entries. */
export function grossTo(
    run: BoardRun,
    kind: CombatLogEntry['kind'],
    opts: { actor?: string; target?: string; note?: string } = {}
): number {
    let sum = 0;
    for (const e of entriesOf(run, kind, { actor: opts.actor, note: opts.note })) {
        for (const t of e.targets) {
            if (opts.target !== undefined && t.targetId !== run.id(opts.target)) continue;
            sum += (t.amount ?? 0) + (t.overheal ?? 0) + (t.overshield ?? 0);
        }
    }
    return sum;
}

/** Amounts of every hit from `actor` landing on `target`, in log order. */
export function hitAmounts(run: BoardRun, actor: string, target: string): number[] {
    const out: number[] = [];
    for (const e of entriesOf(run, 'attack', { actor })) {
        for (const t of e.targets) {
            if (t.targetId === run.id(target) && t.amount !== undefined) out.push(t.amount);
        }
    }
    return out;
}

/** Every entry rendered as one line, for debugging a board. */
export function dumpRun(run: BoardRun): string {
    const name = (id: string) => run.result.roster.find((r) => r.actorId === id)?.name ?? id;
    return run.result.combatLog
        .flatMap((round) =>
            flattenCombatLog({ combatLog: [round] }).map(
                (e) =>
                    `R${round.round} ${e.kind} ${name(e.actorId)}${e.skillName ? ` [${e.skillName}]` : ''}${e.note ? ` (${e.note})` : ''} -> ${e.targets
                        .map(
                            (t) =>
                                `${name(t.targetId)}${t.amount !== undefined ? `:${Math.round(t.amount)}` : ''}${t.overheal ? `+oh${Math.round(t.overheal)}` : ''}${t.overshield ? `+os${Math.round(t.overshield)}` : ''}${t.didCrit ? '!' : ''}`
                        )
                        .join(', ')}`
            )
        )
        .join('\n');
}
