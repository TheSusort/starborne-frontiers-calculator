import type { Ship } from '../../../types/ship';
import type { BattleResult, BattleSimulationInput } from '../../calculators/battleSimulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { deriveFamilyKey, stacksIndependently } from '../statusEngine';
import { isPersistentByName } from '../../../constants/oneShotPersistentBuffs';
import { NON_DEFENCE_REDUCTION_CAP_PCT } from '../../damageComposition';
import type { StatusDuration } from '../events';
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

type StatusKind = 'buff' | 'debuff';

/** Which status kinds a ship's own kit can extend: the `statusKind` of each `extend-status`
 *  ability (Ripper, Fuying: buffs; Lev, Asphyxiator: debuffs). An extension adds turns to a held
 *  status and logs no row, so it is the one duration rise no apply row explains. */
export function shipDurationExtensionKinds(ship: Ship): Set<StatusKind> {
    const kinds = new Set<StatusKind>();
    for (const slot of buildShipAbilities(ship).slots) {
        for (const a of slot.abilities) {
            if (a.config.type === 'extend-status') kinds.add(a.config.statusKind);
        }
    }
    return kinds;
}

/** Per roster actor, the status kinds its kit can extend (`shipDurationExtensionKinds`); actors
 *  with none are absent. `result.roster` lists `input.playerTeam` then `input.enemyTeam`. */
export function durationExtenderKinds(
    input: BattleSimulationInput,
    result: BattleResult,
    extensionKinds: (ship: Ship) => ReadonlySet<StatusKind> = shipDurationExtensionKinds
): Map<string, ReadonlySet<StatusKind>> {
    const ships = [...input.playerTeam, ...input.enemyTeam].map((p) => p.ship);
    const out = new Map<string, ReadonlySet<StatusKind>>();
    result.roster.forEach((entry, i) => {
        const kinds = ships[i] ? extensionKinds(ships[i]) : new Set<StatusKind>();
        if (kinds.size > 0) out.set(entry.actorId, kinds);
    });
    return out;
}

/** A status the duration checks follow one entry of: not an independently stacking family
 *  (`stacksIndependently` — several copies share a name) and not a persistent stacking status
 *  (`isPersistentByName` — it has no duration). */
const tracksOneDuration = (name: string): boolean =>
    !stacksIndependently(name) && !isPersistentByName(name);

/** The names a `steal` row moved, read back from its `stole A, B x2` note. */
function stolenNames(note: string | undefined): string[] {
    if (!note?.startsWith('stole ')) return [];
    return note
        .slice('stole '.length)
        .split(', ')
        .map((part) => part.replace(/ x\d+$/, ''));
}

/** What one round's combat log says about statuses changing hands, keyed for lookup. */
interface RoundStatusRows {
    /** `${kind}|${holderId}|${name}` for each buff/debuff application row. */
    applied: Set<string>;
    /** Names any steal row moved this round. A steal row targets the SOURCE, so its recipients
     *  are not named. */
    stolen: Set<string>;
    /** Holders a cleanse, purge or steal row reached this round, and every ship that cheated
     *  death (Cheat Death clears its removable statuses, `lethalHp.ts`). */
    removalTouched: Set<string>;
    /** `${holderId}|${name}` for each `buff-expired` row. */
    expired: Set<string>;
    /** Turns each actor took this round: one Post-Turn countdown each. */
    turns: Map<string, number>;
}

function roundStatusRows(result: BattleResult): Map<number, RoundStatusRows> {
    const byRound = new Map<number, RoundStatusRows>();
    for (const lr of result.combatLog) {
        const rows: RoundStatusRows = {
            applied: new Set(),
            stolen: new Set(),
            removalTouched: new Set(),
            expired: new Set(),
            turns: new Map(),
        };
        for (const t of lr.turns) rows.turns.set(t.actorId, (rows.turns.get(t.actorId) ?? 0) + 1);
        const entries = flatten([
            ...lr.startOfRound,
            ...lr.turns.flatMap((t) => t.entries),
            ...lr.endOfRound,
        ]);
        for (const e of entries) {
            if ((e.kind === 'buff' || e.kind === 'debuff') && e.note !== undefined) {
                for (const t of e.targets) rows.applied.add(`${e.kind}|${t.targetId}|${e.note}`);
            } else if (e.kind === 'steal') {
                for (const name of stolenNames(e.note)) rows.stolen.add(name);
                for (const t of e.targets) rows.removalTouched.add(t.targetId);
            } else if (e.kind === 'cleanse' || e.kind === 'purge' || e.kind === 'cheat-death') {
                for (const t of e.targets) rows.removalTouched.add(t.targetId);
            } else if (e.kind === 'buff-expired' && e.note?.endsWith(' expired')) {
                rows.expired.add(`${e.actorId}|${e.note.slice(0, -' expired'.length)}`);
            }
        }
        byRound.set(lr.round, rows);
    }
    return byRound;
}

/** The longest remaining window per name on one snapshot list, for the names `tracksOneDuration`
 *  follows. */
function durationsByName(rows: readonly StatusDuration[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const r of rows) {
        if (!tracksOneDuration(r.buffName)) continue;
        out.set(r.buffName, Math.max(out.get(r.buffName) ?? -Infinity, r.turnsRemaining));
    }
    return out;
}

type DurationSnapshot = NonNullable<BattleResult['audit']>['statusDurations'][number];

/**
 * The duration invariants, over `result.audit.statusDurations` (absent → nothing checked).
 * Consecutive end-of-round snapshots of one holder are compared, with the combat log of the
 * later round as the account of what happened in between.
 *
 *  - `status-duration-rises`: a status's remaining turns only count down from where they were
 *    stored. When the snapshot carries the round's store writes (`buffWrites`/`debuffWrites`),
 *    a held window may not exceed the larger of its previous round's window and its longest
 *    write this round, which also holds a status applied this round to the turns it was applied
 *    with. Without writes, a rise needs an application row of that exact name onto that holder
 *    in the round (a re-application or refresh replaces the held copy) or a steal row that
 *    moved that name. Either way the one rise with no record is a duration extension: buff
 *    rises on a side fielding a buff extender, debuff rises on the side opposing a debuff
 *    extender (`durationExtenderKinds`).
 *  - `status-tier-drop`: highest tier wins, so a family's held tier falls only once the higher
 *    copy is gone — its window ran out (no more turns left than the holder's Post-Turns this
 *    round), a `buff-expired` row named it, a cleanse, purge or steal row reached the holder, or
 *    the holder cheated death.
 */
function statusDurations(
    result: BattleResult,
    extenders: ReadonlyMap<string, ReadonlySet<StatusKind>>
): InvariantViolation[] {
    const audit = result.audit;
    if (!audit) return [];
    const out: InvariantViolation[] = [];
    const sideOf = new Map(result.roster.map((r) => [r.actorId, r.side]));
    const nameOf = new Map(result.roster.map((r) => [r.actorId, r.name]));
    const buffExtendedSides = new Set<string>();
    const debuffExtendedSides = new Set<string>();
    for (const [actorId, kinds] of extenders) {
        const side = sideOf.get(actorId);
        if (side === undefined) continue;
        if (kinds.has('buff')) buffExtendedSides.add(side);
        if (kinds.has('debuff')) debuffExtendedSides.add(side === 'player' ? 'enemy' : 'player');
    }
    const rowsByRound = roundStatusRows(result);
    const previous = new Map<string, DurationSnapshot>();
    for (const snap of audit.statusDurations) {
        const held = previous.get(snap.actorId);
        previous.set(snap.actorId, snap);
        // Without the previous round's snapshot there is nothing to rise from or drop from;
        // only the write ceiling is checked.
        const prev = held && held.round === snap.round - 1 ? held : undefined;
        if (!prev && !snap.buffWrites && !snap.debuffWrites) continue;
        const rows = rowsByRound.get(snap.round);
        const holder = snap.actorId;
        const label = `${nameOf.get(holder) ?? holder} (${holder})`;
        const side = sideOf.get(holder);
        for (const kind of ['buff', 'debuff'] as const) {
            const before = prev
                ? durationsByName(kind === 'buff' ? prev.buffs : prev.debuffs)
                : new Map<string, number>();
            const after = durationsByName(kind === 'buff' ? snap.buffs : snap.debuffs);
            const extended =
                side !== undefined &&
                (kind === 'buff' ? buffExtendedSides : debuffExtendedSides).has(side);
            const writeRows = kind === 'buff' ? snap.buffWrites : snap.debuffWrites;
            const written = writeRows ? durationsByName(writeRows) : undefined;
            for (const [name, turns] of after) {
                const was = before.get(name);
                if (written) {
                    const wrote = written.get(name);
                    if (was === undefined && wrote === undefined) continue;
                    const ceiling = Math.max(was ?? -Infinity, wrote ?? -Infinity);
                    if (turns <= ceiling || extended) continue;
                    out.push({
                        invariant: 'status-duration-rises',
                        round: snap.round,
                        actorId: holder,
                        detail:
                            `${kind} ${name} on ${label} holds ${turns} turns, above ` +
                            `${was === undefined ? 'no prior window' : `its prior ${was}`} and ` +
                            `${wrote === undefined ? 'no write' : `its longest write ${wrote}`} this round`,
                    });
                    continue;
                }
                if (was === undefined || turns <= was) continue;
                if (rows?.applied.has(`${kind}|${holder}|${name}`)) continue;
                if (kind === 'buff' && rows?.stolen.has(name)) continue;
                if (extended) continue;
                out.push({
                    invariant: 'status-duration-rises',
                    round: snap.round,
                    actorId: holder,
                    detail: `${kind} ${name} on ${label} rose from ${was} to ${turns} turns with no application row`,
                });
            }
            const familiesBefore = new Map<string, { name: string; tier: number; turns: number }>();
            for (const [name, turns] of before) {
                const { familyKey, tier } = deriveFamilyKey(name);
                familiesBefore.set(familyKey, { name, tier, turns });
            }
            for (const name of after.keys()) {
                const { familyKey, tier } = deriveFamilyKey(name);
                const held = familiesBefore.get(familyKey);
                if (!held || tier >= held.tier) continue;
                if (held.turns <= (rows?.turns.get(holder) ?? 0)) continue;
                if (rows?.expired.has(`${holder}|${held.name}`)) continue;
                if (rows?.removalTouched.has(holder)) continue;
                out.push({
                    invariant: 'status-tier-drop',
                    round: snap.round,
                    actorId: holder,
                    detail: `${kind} ${held.name} (${held.turns} turns left) on ${label} became ${name} with no expiry or removal`,
                });
            }
        }
    }
    return out;
}

/** Slack on the cap comparison, for the float products the factor is composed of. */
const CAP_EPSILON = 1e-9;

/**
 * Non-defence damage reduction is capped at 70%: every direct hit's composed incoming factor
 * (`result.audit.hitIncomingFactors`, absent → nothing checked) is at least 0.30. The factor
 * includes a partial incoming block (Ironclad), which composes inside the cap. A full block
 * (Shadowguard) zeroes the hit outside the cap and leaves the factor as composed, so it is held
 * to the same floor.
 */
function incomingReductionCap(result: BattleResult): InvariantViolation[] {
    const audit = result.audit;
    if (!audit) return [];
    const floor = 1 - NON_DEFENCE_REDUCTION_CAP_PCT / 100;
    const out: InvariantViolation[] = [];
    for (const h of audit.hitIncomingFactors) {
        if (h.factor >= floor - CAP_EPSILON) continue;
        out.push({
            invariant: 'incoming-reduction-cap',
            round: h.round,
            actorId: h.victimId,
            detail: `hit by ${h.attackerId ?? 'unknown'} on ${h.victimId} priced at incoming factor ${h.factor} (block: ${h.block}), below the ${floor} floor`,
        });
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
    /** Actors whose kit can extend a status duration — see `durationExtenderKinds`. Default:
     *  none, so a caller fielding a ship with an extension kit must pass it. */
    durationExtenders?: ReadonlyMap<string, ReadonlySet<StatusKind>>;
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
        ...statusDurations(result, options.durationExtenders ?? new Map()),
        ...incomingReductionCap(result),
        ...logWalk(result).filter((v) => !OPEN_INVARIANTS.has(v.invariant)),
    ];
}

/** The `OPEN_INVARIANTS` — locked rules the engine does not yet hold on the real corpus. */
export function checkOpenInvariants(result: BattleResult): InvariantViolation[] {
    return logWalk(result).filter((v) => OPEN_INVARIANTS.has(v.invariant));
}
