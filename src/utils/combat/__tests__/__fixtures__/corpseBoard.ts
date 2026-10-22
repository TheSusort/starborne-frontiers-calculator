/**
 * Real-kit battle boards for the "a destroyed ship neither acts nor receives" tests.
 *
 * `corpseBattle` places real kits (buildTraceShip on docs/ship-skills.csv, refit 4) with explicit
 * HP / attack / speed so a test can kill a ship on cue, and mounts the `subject` team on either
 * side (`mirror`) so every assertion runs team-symmetrically. `logRows` flattens the combat log
 * (nested reactions included) into rows carrying their round, and `deathRound` reads the round a
 * ship's `death` row sits in.
 */
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { runSeededBattle } from '../../../simulator/seededRuns';
import type { BattleResult, BattleSimulationInput } from '../../../calculators/battleSimulator';
import type { CombatLogEntry } from '../../log/types';
import type { Position } from '../../../../types/encounters';

type Placed = BattleSimulationInput['playerTeam'][number];

export interface CorpseShipSpec {
    name: string;
    position: Position;
    hp: number;
    attack?: number;
    speed?: number;
    crit?: number;
}

const place = (s: CorpseShipSpec): Placed => {
    const ship = buildTraceShip(s.name);
    if (!ship) throw new Error(`${s.name} missing from reference data (docs/ship-skills.csv)`);
    const b = ship.baseStats;
    return {
        ship,
        position: s.position,
        statOverrides: {
            attack: s.attack ?? b.attack,
            crit: s.crit ?? 0,
            critDamage: 50,
            hacking: 1000,
            security: b.security,
            defence: b.defence,
            hp: s.hp,
            speed: s.speed ?? b.speed,
        },
    };
};

export interface CorpseRow {
    round: number;
    entry: CombatLogEntry;
}

export interface CorpseRun {
    result: BattleResult;
    rows: CorpseRow[];
    /** The engine id of the placed ship named `name` (unique per board). */
    idOf: (name: string) => string;
    /** The round `name`'s `death` row sits in, or undefined if it survived. */
    deathRound: (name: string) => number | undefined;
}

/** `subject` and `other` teams; `mirror` mounts `subject` on the ENEMY side. */
export const corpseBattle = (
    subject: CorpseShipSpec[],
    other: CorpseShipSpec[],
    opts: { mirror: boolean; rounds: number; seed?: number }
): CorpseRun => {
    const a = subject.map(place);
    const b = other.map(place);
    const input: BattleSimulationInput = opts.mirror
        ? { playerTeam: b, enemyTeam: a, rounds: opts.rounds }
        : { playerTeam: a, enemyTeam: b, rounds: opts.rounds };
    const result = runSeededBattle(input, opts.seed ?? 1);
    const rows: CorpseRow[] = [];
    const walk = (round: number, entries: CombatLogEntry[]): void => {
        for (const entry of entries) {
            rows.push({ round, entry });
            walk(round, entry.reactions);
        }
    };
    for (const lr of result.combatLog) {
        walk(lr.round, lr.startOfRound);
        for (const t of lr.turns) walk(lr.round, t.entries);
        walk(lr.round, lr.endOfRound);
    }
    const idOf = (name: string): string => {
        const hit = result.roster.filter((r) => r.name === name);
        if (hit.length !== 1)
            throw new Error(`expected one ${name} on the board, got ${hit.length}`);
        return hit[0].actorId;
    };
    const deathRound = (name: string): number | undefined =>
        rows.find((r) => r.entry.kind === 'death' && r.entry.actorId === idOf(name))?.round;
    return { result, rows, idOf, deathRound };
};
