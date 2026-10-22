import type { Ship } from '../../../types/ship';
import type { BattleResult, BattleSimulationInput } from '../../calculators/battleSimulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { deriveFamilyKey, stacksIndependently } from '../statusEngine';
import type { CombatLogEntry, CombatLogEntryKind } from '../log/types';
import type { InvariantViolation } from './types';

function hpBounds(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const r of result.rounds) {
        for (const s of r.ships) {
            if (s.hpPct < 0 || s.hpPct > 100) {
                out.push({
                    invariant: 'hp-bounds',
                    round: r.round,
                    actorId: s.actorId,
                    detail: `hpPct ${s.hpPct} outside [0,100]`,
                });
            }
        }
    }
    return out;
}

/**
 * `ShipRoundState.alive` is an end-of-round snapshot (battleSimulator.ts: `alive =
 * destroyRound === undefined || round < destroyRound`), and `turnOrder` is built from
 * `turn-started` emission order regardless of `alive` — so a ship that starts its turn in
 * round R and then dies in round R (e.g. a start-of-turn DoT/bomb tick, before it acts) is
 * legitimately `alive:false` AND present in `turnOrder` for round R. That is NOT a bug: no
 * revival mechanic exists (cheat-death prevents destruction, never reverses it, and a ship's
 * destroy round is the earliest round it was destroyed), so once an actor is dead in round R
 * it stays dead for every later round. The real invariant is: a corpse must never appear in
 * turnOrder for any round AFTER the round it died in.
 */
function noDeadActs(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    const firstDeadRound = new Map<string, number>();
    for (const r of result.rounds) {
        for (const s of r.ships) {
            if (!s.alive && !firstDeadRound.has(s.actorId)) {
                firstDeadRound.set(s.actorId, r.round);
            }
        }
    }
    for (const r of result.rounds) {
        for (const actorId of r.turnOrder) {
            const deadRound = firstDeadRound.get(actorId);
            if (deadRound !== undefined && r.round > deadRound) {
                out.push({
                    invariant: 'no-dead-acts',
                    round: r.round,
                    actorId,
                    detail: `actor ${actorId} died in round ${deadRound} but appears in turnOrder for round ${r.round}`,
                });
            }
        }
    }
    return out;
}

/**
 * `ShipRoundState.damageDealt`/`damageTaken` reconcile by construction (see the docstrings on
 * `ShipRoundState.damageDealt` in battleSimulator.ts), EXCEPT under an active Protection redirect
 * — a protector's credited `damageDealt` chunk is a diverted PORTION of the original hit, not
 * independent new damage, so it inflates the round's `Σ damageDealt` relative to `Σ damageTaken`
 * (and a redirected DoT-tick batch, which has no single source attacker, isn't mirrored into
 * `perTargetDealt` at all, shorting the sum the other way). There is no protection/redirect entry
 * kind in the combat log, so the only pure, result-only signal for "Protection was active this
 * round" is `activeBuffs` — Protection is a buff named exactly `'Protection'`
 * (see `protectionTransfer.ts`). Skip any round where ANY ship carries it.
 */
function damageConservation(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const r of result.rounds) {
        if (r.ships.some((s) => s.activeBuffs.includes('Protection'))) {
            continue;
        }
        const dealt = r.ships.reduce((sum, s) => sum + s.damageDealt, 0);
        const taken = r.ships.reduce((sum, s) => sum + s.damageTaken, 0);
        if (Math.abs(dealt - taken) > 1) {
            out.push({
                invariant: 'damage-conservation',
                round: r.round,
                detail: `round ${r.round}: Σ damageDealt ${dealt} != Σ damageTaken ${taken} (diff ${dealt - taken})`,
            });
        }
    }
    return out;
}

/**
 * Highest tier wins for every buff and debuff: at a round's end a ship holds at most one tier of
 * each status family. The family key and the stack-exempt set are the engine's own —
 * `deriveFamilyKey` and `stacksIndependently` in statusEngine.ts, which own the list of statuses
 * that stack rather than shadow. Persistent stacking buffs and Exposed carry no Roman tier suffix,
 * so their stacks share one name and cannot collide here. Buffs and debuffs are checked as
 * separate lists, because they live in separate stores.
 */
function singleTierFamily(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const r of result.rounds) {
        for (const s of r.ships) {
            for (const names of [s.activeBuffs, s.activeDebuffs]) {
                const byFamily = new Map<string, string[]>();
                for (const name of names) {
                    if (stacksIndependently(name)) continue;
                    const { familyKey } = deriveFamilyKey(name);
                    byFamily.set(familyKey, [...(byFamily.get(familyKey) ?? []), name]);
                }
                for (const [familyKey, held] of byFamily) {
                    if (new Set(held).size < 2) continue;
                    out.push({
                        invariant: 'single-tier-family',
                        round: r.round,
                        actorId: s.actorId,
                        detail: `holds ${held.join(' + ')} of family '${familyKey}' at once`,
                    });
                }
            }
        }
    }
    return out;
}

function shieldNonNegative(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const r of result.rounds) {
        for (const s of r.ships) {
            if (s.currentShieldPool < 0 || s.shieldPct < 0) {
                out.push({
                    invariant: 'shield-non-negative',
                    round: r.round,
                    actorId: s.actorId,
                    detail: `end-of-round shield pool ${s.currentShieldPool} (${s.shieldPct}%)`,
                });
            }
        }
    }
    for (const lr of result.combatLog) {
        for (const t of lr.turns) {
            const pool = t.statsSnapshot?.shieldPool;
            if (pool !== undefined && pool < 0) {
                out.push({
                    invariant: 'shield-non-negative',
                    round: lr.round,
                    actorId: t.actorId,
                    detail: `turn-start shield pool ${pool}`,
                });
            }
        }
    }
    return out;
}

/** Whether a ship's own kit carries an `extra-action` ability (any trigger, any slot) — the only
 *  engine mechanic that gives a ship a second turn in a round (`processExtraActionGrants` in
 *  engine.ts). Reads the ship's skills alone, not its equipment. */
export function shipGrantsExtraAction(ship: Ship): boolean {
    return buildShipAbilities(ship).slots.some((slot) =>
        slot.abilities.some((a) => a.config.type === 'extra-action')
    );
}

/** The roster ids of the ships whose kit can grant them an extra action. `result.roster` lists
 *  `input.playerTeam` then `input.enemyTeam`, in input order. */
export function extraActionActorIds(
    input: BattleSimulationInput,
    result: BattleResult,
    grantsExtraAction: (ship: Ship) => boolean = shipGrantsExtraAction
): Set<string> {
    const ships = [...input.playerTeam, ...input.enemyTeam].map((p) => p.ship);
    const ids = new Set<string>();
    result.roster.forEach((entry, i) => {
        if (ships[i] && grantsExtraAction(ships[i])) ids.add(entry.actorId);
    });
    return ids;
}

/**
 * Speed sets turn order only: an actor takes one turn per round unless its kit grants an extra
 * action. `BattleRound.turnOrder` is de-duplicated, so the turn count comes from the combat log's
 * `turns`, one per `turn-started`.
 */
function noExtraTurns(
    result: BattleResult,
    extraActionIds: ReadonlySet<string>
): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const lr of result.combatLog) {
        const counts = new Map<string, number>();
        for (const t of lr.turns) counts.set(t.actorId, (counts.get(t.actorId) ?? 0) + 1);
        for (const [actorId, n] of counts) {
            if (n > 1 && !extraActionIds.has(actorId)) {
                out.push({
                    invariant: 'no-extra-turns',
                    round: lr.round,
                    actorId,
                    detail: `took ${n} turns in round ${lr.round} with no extra-action grant in its kit`,
                });
            }
        }
    }
    return out;
}

/** Entry kinds whose targets were picked by the acting ship and receive something hostile. */
const HOSTILE_TARGET_KINDS: ReadonlySet<CombatLogEntryKind> = new Set<CombatLogEntryKind>([
    'attack',
    'debuff',
    'dot-applied',
    'control',
    'purge',
    'steal',
    'debuff-resisted',
    'bomb',
]);

/** Entry kinds whose targets were picked by the acting ship and receive a grant. */
const ALLY_GRANT_KINDS: ReadonlySet<CombatLogEntryKind> = new Set<CombatLogEntryKind>([
    'buff',
    'heal',
    'shield',
    'cleanse',
]);

/** Entry kinds whose `actorId` names a status's holder or applier, the dying ship, or the ship
 *  whose charge moved, rather than a ship acting — a corpse appearing there is not a corpse
 *  acting. A `charge-changed` row on a corpse is checked as a grant onto it instead. */
const NON_ACTION_KINDS: ReadonlySet<CombatLogEntryKind> = new Set<CombatLogEntryKind>([
    'death',
    'charge-changed',
    'dot-ticked',
    'hot-ticked',
    'buff-expired',
    'bomb',
    'detonation',
    'reversed-repair',
    'cheat-death',
]);

interface LogBlock {
    round: number;
    where: 'start-of-round' | 'turn' | 'end-of-round';
    /** The turn's actor; absent on the two drains. */
    turnActorId?: string;
    entries: CombatLogEntry[];
}

function* logBlocks(result: BattleResult): Generator<LogBlock> {
    for (const lr of result.combatLog) {
        yield { round: lr.round, where: 'start-of-round', entries: lr.startOfRound };
        for (const t of lr.turns) {
            yield { round: lr.round, where: 'turn', turnActorId: t.actorId, entries: t.entries };
        }
        yield { round: lr.round, where: 'end-of-round', entries: lr.endOfRound };
    }
}

function flatten(entries: CombatLogEntry[], into: CombatLogEntry[] = []): CombatLogEntry[] {
    for (const e of entries) {
        into.push(e);
        flatten(e.reactions, into);
    }
    return into;
}

/**
 * The combat-log walk behind the corpse and wipe invariants. A ship counts as dead from the END
 * of the log block (a start-of-round drain, one turn, or an end-of-round drain) that holds its
 * `death` row: the engine stamps `destroyedRound` at cast completion, so the rest of the killing
 * cast still sees its victim alive, and the killing hit itself is nested under the `death` row.
 *
 *  - `corpse-hostile-target` / `corpse-ally-grant`: an entry aims at a ship that died in an
 *    earlier block. Dead ships are untargetable (the selector gate is `isAliveTarget` in
 *    targetableActors.ts). Self-aimed rows are the dead actor itself, not a target pick.
 *  - `corpse-acts`: a ship that died in an earlier block is the actor of an action row.
 *  - `no-turn-after-wipe`: a turn starts after the block in which one side's last ship died.
 *  - `entry-after-wipe`: a drain logs anything after that block.
 */
function logWalk(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    const nameOf = new Map(result.roster.map((r) => [r.actorId, r.name]));
    const label = (id: string): string => `${nameOf.get(id) ?? id} (${id})`;
    const sides = ['player', 'enemy'] as const;
    const members = new Map(
        sides.map((side) => [
            side,
            result.roster.filter((r) => r.side === side).map((r) => r.actorId),
        ])
    );
    const dead = new Set<string>();
    let wipedSide: string | undefined;

    for (const block of logBlocks(result)) {
        const entries = flatten(block.entries);
        if (wipedSide !== undefined) {
            if (block.turnActorId !== undefined) {
                out.push({
                    invariant: 'no-turn-after-wipe',
                    round: block.round,
                    actorId: block.turnActorId,
                    detail: `${label(block.turnActorId)} took a turn after the ${wipedSide} side was wiped`,
                });
            } else {
                for (const e of entries) {
                    out.push({
                        invariant: 'entry-after-wipe',
                        round: block.round,
                        actorId: e.actorId,
                        detail: `${block.where} ${e.kind} by ${label(e.actorId)}${e.skillName ? ` (${e.skillName})` : ''} after the ${wipedSide} side was wiped`,
                    });
                }
            }
        }
        for (const e of entries) {
            if (dead.has(e.actorId) && !NON_ACTION_KINDS.has(e.kind)) {
                out.push({
                    invariant: 'corpse-acts',
                    round: block.round,
                    actorId: e.actorId,
                    detail: `${block.where} ${e.kind} by dead ${label(e.actorId)}${e.skillName ? ` (${e.skillName})` : ''}${e.note ? ` [${e.note}]` : ''}`,
                });
            }
            if (e.kind === 'charge-changed' && dead.has(e.actorId)) {
                out.push({
                    invariant: 'corpse-ally-grant',
                    round: block.round,
                    actorId: e.actorId,
                    detail: `${block.where} charge-changed on dead ${label(e.actorId)}${e.note ? ` [${e.note}]` : ''}`,
                });
            }
            const kind = HOSTILE_TARGET_KINDS.has(e.kind)
                ? 'corpse-hostile-target'
                : ALLY_GRANT_KINDS.has(e.kind)
                  ? 'corpse-ally-grant'
                  : undefined;
            if (!kind) continue;
            for (const t of e.targets) {
                if (t.targetId === e.actorId || !dead.has(t.targetId)) continue;
                out.push({
                    invariant: kind,
                    round: block.round,
                    actorId: t.targetId,
                    detail: `${block.where} ${e.kind} by ${label(e.actorId)}${e.skillName ? ` (${e.skillName})` : ''}${e.note ? ` [${e.note}]` : ''} on dead ${label(t.targetId)}`,
                });
            }
        }
        for (const e of entries) if (e.kind === 'death') dead.add(e.actorId);
        if (wipedSide === undefined) {
            wipedSide = sides.find((side) => {
                const ids = members.get(side) ?? [];
                return ids.length > 0 && ids.every((id) => dead.has(id));
            });
        }
    }
    return out;
}

/** The log-walk invariants the real corpus does not hold, reported by `checkOpenInvariants` and
 *  kept out of `checkInvariants`. `entry-after-wipe` fires by design: the round-tail drain still
 *  resolves after a wiping turn (#329), so Chimei's end-of-round Stealth logs after a wipe. Move an
 *  id out of this set once the corpus holds it. */
export const OPEN_INVARIANTS: ReadonlySet<string> = new Set(['entry-after-wipe']);

export interface InvariantOptions {
    /** Actors allowed more than one turn per round — see `extraActionActorIds`. Default: none, so
     *  a caller fielding a ship with an extra-action kit must pass it. */
    extraActionActorIds?: ReadonlySet<string>;
}

/** The invariants the real corpus holds — a violation here is a regression. */
export function checkInvariants(
    result: BattleResult,
    options: InvariantOptions = {}
): InvariantViolation[] {
    return [
        ...hpBounds(result),
        ...noDeadActs(result),
        ...damageConservation(result),
        ...singleTierFamily(result),
        ...shieldNonNegative(result),
        ...noExtraTurns(result, options.extraActionActorIds ?? new Set()),
        ...logWalk(result).filter((v) => !OPEN_INVARIANTS.has(v.invariant)),
    ];
}

/** The `OPEN_INVARIANTS` — locked rules the engine does not yet hold on the real corpus. */
export function checkOpenInvariants(result: BattleResult): InvariantViolation[] {
    return logWalk(result).filter((v) => OPEN_INVARIANTS.has(v.invariant));
}
