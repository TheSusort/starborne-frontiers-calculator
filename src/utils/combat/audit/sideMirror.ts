import {
    simulateBattle,
    type BattleResult,
    type BattleSimulationInput,
} from '../../calculators/battleSimulator';
import {
    makeKeyedRng,
    mulberry32,
    resetRateGateRng,
    setKeyedRng,
    setRateGateRng,
} from '../../calculators/rateAccumulator';
import { runSeededBattle } from '../../simulator/seededRuns';
import type { CombatLogEntry, CombatLogEntryKind, CombatLogRound } from '../log/types';
import { fingerprintActor } from './fingerprint';

/**
 * Side-mirror differential: run a composition, then the same composition with player and enemy
 * swapped, and require the two fights to be the same fight seen from the other side.
 *
 * A ship is identified across the two arms by a SLOT LABEL — `P<i>` for the original
 * `playerTeam[i]`, `E<i>` for the original `enemyTeam[i]` — because actor ids are side-shaped
 * (`battleSimulator` mints `'attacker'` for `playerTeam[0]`, `p:<shipId>:<i>` for the rest of the
 * player side, `e:<shipId>:<i>` for the enemy side) and so change when the ship changes side.
 *
 * RNG PAIRING. Every engine gate draws from a keyed sub-stream whose key is `<actorId>:<purpose>`
 * (`rateAccumulator.makeRateGate` / `drawKeyed` / `rollRateGate`). The swapped arm installs a
 * keyed provider that rewrites each key's actor-id prefix to the id the SAME ship had in the
 * original arm, so every ship draws the identical stream in both arms. With that pairing a
 * team-symmetric engine produces a fight that is identical after relabelling — not merely
 * similar in distribution — so the comparison is exact and a single seed is a verdict.
 * The shared un-keyed stream is seeded identically in both arms and its draws are counted
 * (`unkeyedDraws`); it only pairs while the two arms consume it in the same order.
 *
 * DOCUMENTED ASYMMETRIES (the only ones; anything else that differs is a finding):
 * - `speed-tie`: two actors on opposite sides with equal live speed on the mirrored board cell
 *   act player-first (`state.orderByTurnPriority`), so swapping sides swaps who acts first.
 *   Detected at the first turn-order divergence from the turns' own `statsSnapshot.speed`.
 * - `round-cap`: a fight that reaches the round cap with both sides alive is an enemy win
 *   (`assembleBattleResult`), so its winner does not mirror. Only the winner is exempted; the
 *   rest of the fight is still compared.
 */

export type MirrorSide = 'player' | 'enemy';

/** The swapped composition: each team moves to the other side in the same array order, so
 *  `playerTeam[i]` becomes `enemyTeam[i]` and vice versa. Squad leaders travel with their team. */
export function swapSides(input: BattleSimulationInput): BattleSimulationInput {
    const swapped: BattleSimulationInput = {
        ...input,
        playerTeam: input.enemyTeam,
        enemyTeam: input.playerTeam,
    };
    delete swapped.playerSquadLeader;
    delete swapped.enemySquadLeader;
    if (input.enemySquadLeader) swapped.playerSquadLeader = input.enemySquadLeader;
    if (input.playerSquadLeader) swapped.enemySquadLeader = input.playerSquadLeader;
    return swapped;
}

/** The actor id `battleSimulator` mints for a placement. Checked against the run's roster by
 *  `labelsFromRoster`, so a change to the minting scheme throws rather than silently mis-pairing
 *  every stream. */
export function mintedActorId(side: MirrorSide, shipId: string, index: number): string {
    if (side === 'player') return index === 0 ? 'attacker' : `p:${shipId}:${index}`;
    return `e:${shipId}:${index}`;
}

/** Slot label of `team[index]` on `side` of the ORIGINAL composition. */
export function slotLabel(originalSide: MirrorSide, index: number): string {
    return `${originalSide === 'player' ? 'P' : 'E'}${index}`;
}

/** actorId → slot label for one arm. `swapped` arms place the original enemy team on the player
 *  side, so its player-side ids carry `E` labels. Throws when the roster does not contain exactly
 *  the ids the minting scheme predicts. */
export function labelsFromRoster(
    input: BattleSimulationInput,
    result: BattleResult,
    swapped: boolean
): Map<string, string> {
    const labels = new Map<string, string>();
    const sides: Array<[MirrorSide, BattleSimulationInput['playerTeam']]> = [
        ['player', input.playerTeam],
        ['enemy', input.enemyTeam],
    ];
    for (const [side, team] of sides) {
        team.forEach((p, i) => {
            const originalSide: MirrorSide = swapped
                ? side === 'player'
                    ? 'enemy'
                    : 'player'
                : side;
            labels.set(mintedActorId(side, p.ship.id, i), slotLabel(originalSide, i));
        });
    }
    const rosterIds = result.roster.map((r) => r.actorId).sort();
    const predicted = [...labels.keys()].sort();
    if (rosterIds.join('|') !== predicted.join('|')) {
        throw new Error(
            `sideMirror: roster ids [${rosterIds.join(', ')}] do not match the minted ids ` +
                `[${predicted.join(', ')}] — battleSimulator's actor-id scheme changed`
        );
    }
    return labels;
}

/** swapped-arm actorId → original-arm actorId of the same ship. */
export function mirrorIdMap(input: BattleSimulationInput): Map<string, string> {
    const map = new Map<string, string>();
    input.playerTeam.forEach((p, i) => {
        map.set(mintedActorId('enemy', p.ship.id, i), mintedActorId('player', p.ship.id, i));
    });
    input.enemyTeam.forEach((p, i) => {
        map.set(mintedActorId('player', p.ship.id, i), mintedActorId('enemy', p.ship.id, i));
    });
    return map;
}

/** Rewrite a stream key's actor-id prefix through `idMap`. The LONGEST matching id wins, because
 *  `p:<shipId>:<i>` ids contain `:` themselves. A key with no actor-id prefix is returned
 *  unchanged (it draws the same stream in both arms). */
export function remapStreamKey(key: string, idMap: ReadonlyMap<string, string>): string {
    let best: string | null = null;
    for (const id of idMap.keys()) {
        if (key.startsWith(`${id}:`) && (best === null || id.length > best.length)) best = id;
    }
    return best === null ? key : `${idMap.get(best)}${key.slice(best.length)}`;
}

export interface MirrorRunStats {
    /** Draws from the shared un-keyed stream in the swapped arm. */
    unkeyedDraws: number;
    /** Keyed draws whose key carried no actor-id prefix. */
    unmappedKeyedDraws: number;
}

/** Run the swapped composition with every ship's keyed stream paired to its original-arm stream.
 *  Restores the production RNG in `finally`, like `runSeededBattle`. */
export function runSwappedPaired(
    input: BattleSimulationInput,
    seed: number
): { result: BattleResult; stats: MirrorRunStats } {
    const idMap = mirrorIdMap(input);
    const stats: MirrorRunStats = { unkeyedDraws: 0, unmappedKeyedDraws: 0 };
    const shared = mulberry32(seed);
    const keyed = makeKeyedRng(seed);
    setRateGateRng(() => {
        stats.unkeyedDraws++;
        return shared();
    });
    setKeyedRng((key) => {
        const mapped = remapStreamKey(key, idMap);
        if (mapped === key) stats.unmappedKeyedDraws++;
        return keyed(mapped);
    });
    try {
        return { result: simulateBattle(swapSides(input)), stats };
    } finally {
        resetRateGateRng();
    }
}

// ---------------------------------------------------------------------------
// Canonical form: actor ids → slot labels, sides → ORIGINAL side.
// ---------------------------------------------------------------------------

const SIDE_FLIP: Record<MirrorSide, MirrorSide> = { player: 'enemy', enemy: 'player' };

/** Keys whose string value is a team side (`'player' | 'enemy'`) in a BattleResult. */
const SIDE_KEYS = new Set(['side', 'winner']);

/** Deep-copy `value`, replacing every string that IS an actor id with its label, every occurrence
 *  of an actor id INSIDE a string (log notes) with its label, and — in a swapped arm — every side
 *  value under a `side`/`winner` key with the other side. The result is side-neutral: two arms of
 *  a symmetric engine canonicalise to equal values. */
export function canonicalize(
    value: unknown,
    labels: ReadonlyMap<string, string>,
    swapped: boolean,
    key?: string
): unknown {
    if (typeof value === 'string') {
        const direct = labels.get(value);
        if (direct !== undefined) return direct;
        if (swapped && key !== undefined && SIDE_KEYS.has(key) && value in SIDE_FLIP) {
            return SIDE_FLIP[value as MirrorSide];
        }
        let out = value;
        // Only the `p:`/`e:` ids are replaced inside a string: `'attacker'` is also an English
        // word a note can carry. Longest ids first so a `p:<id>:1` never half-matches a longer id.
        for (const id of [...labels.keys()].sort((a, b) => b.length - a.length)) {
            if (/^[pe]:/.test(id) && out.includes(id))
                out = out.split(id).join(labels.get(id) ?? id);
        }
        return out;
    }
    if (Array.isArray(value)) return value.map((v) => canonicalize(v, labels, swapped));
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            out[labels.get(k) ?? k] = canonicalize(v, labels, swapped, k);
        }
        return out;
    }
    return value;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export type MirrorDivergenceKind =
    'turn-order' | 'ship-state' | 'combat-log' | 'outcome' | 'round-count';

/** The EARLIEST point at which the two arms stop being the same fight. Everything after it is
 *  downstream noise (one changed draw desyncs every later one), so only this point is reported
 *  as the divergence; `kindDiffs` summarises what each ship did differently over the whole fight. */
export interface MirrorDivergence {
    kind: MirrorDivergenceKind;
    round: number;
    /** For a `combat-log` divergence: the log section it sits in (`start-of-round`,
     *  `turn-header:<label>`, `turn:<label>`, `end-of-round`), named from the original arm. */
    section?: string;
    /** Slot labels of the actors involved, when the divergence is attributable. */
    actors: string[];
    /** Original-arm value vs swapped-arm value, canonicalised, as (truncated) JSON. */
    original: string;
    swapped: string;
}

/** Per-ship difference in the SET of combat-log kinds produced over the whole fight. */
export interface MirrorKindDiff {
    label: string;
    shipName: string;
    /** Kinds this ship produced on its original side but never after the swap. */
    onlyOriginal: CombatLogEntryKind[];
    /** Kinds this ship produced only after the swap. */
    onlySwapped: CombatLogEntryKind[];
}

/**
 * - `mirrored`: the two arms are the same fight (a `round-cap` winner aside).
 * - `log-order`: the arms differ ONLY in the order of entries inside one log section (a round's
 *   start/end block, or one turn) and in the order of the per-round buff/debuff chip lists. The
 *   fight's events are the same; the engine resolves or announces them in a side-dependent order.
 *   A FINDING, not an exemption: it is reported and does not count as mirrored.
 * - `behaviour`: something happened in one arm that did not happen in the other.
 * - `speed-tie`: the first order-insensitive divergence is the documented cross-team speed tie.
 *   Nothing from that turn on is comparable, so the pair is NOT counted as comparable coverage.
 */
export type MirrorClass = 'mirrored' | 'log-order' | 'behaviour' | 'speed-tie';

export interface MirrorVerdict {
    class: MirrorClass;
    /** True when the fight reached the round cap in both arms, whose winner is an enemy win on
     *  either side and so is exempt from mirroring. */
    roundCap: boolean;
    /** Earliest divergence, entry order significant. Null only for `mirrored`. */
    strict: MirrorDivergence | null;
    /** Earliest divergence with each log section and chip list compared as a multiset. Null for
     *  `mirrored` and `log-order`. */
    unordered: MirrorDivergence | null;
    /** True when turn order, per-round ship state and outcome all mirror, log aside. A
     *  `behaviour` verdict with this false changed the fight, not just its log. */
    stateMirrored: boolean;
    kindDiffs: MirrorKindDiff[];
}

/** Display form of a value: JSON, truncated. Never used for equality. */
function short(value: unknown): string {
    const s = JSON.stringify(value);
    return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

type Canon = BattleResult;

interface FlatEntry {
    actor?: string;
    entry: unknown;
}

/** One round's log as a list of SECTIONS (start block, each turn's header + entries, end
 *  block). The ordered lens compares entries in sequence; the unordered lens compares each
 *  section as a multiset, so a reshuffle inside one section is not reported but an entry moving
 *  to another turn still is. */
function logSections(round: CombatLogRound): Array<{ name: string; entries: FlatEntry[] }> {
    const fromEntries = (entries: CombatLogEntry[]): FlatEntry[] =>
        entries.map((e) => ({ actor: e.actorId, entry: e }));
    const sections = [{ name: 'start-of-round', entries: fromEntries(round.startOfRound) }];
    for (const turn of round.turns) {
        sections.push({
            name: `turn-header:${turn.actorId}`,
            entries: [
                {
                    actor: turn.actorId,
                    entry: {
                        turn: turn.actorId,
                        chargeBefore: turn.chargeBefore,
                        chargeMax: turn.chargeMax,
                        statsSnapshot: turn.statsSnapshot,
                    },
                },
            ],
        });
        sections.push({ name: `turn:${turn.actorId}`, entries: fromEntries(turn.entries) });
    }
    sections.push({ name: 'end-of-round', entries: fromEntries(round.endOfRound) });
    return sections;
}

/** A section as a multiset of entries with every nested reaction lifted out beside its parent.
 *  `buildCombatLog` nests a reaction under the latest open entry, so reordering two entries
 *  re-parents a reaction without anything having happened differently. */
function sortedSection(section: FlatEntry[]): FlatEntry[] {
    const lifted: FlatEntry[] = [];
    const lift = (e: CombatLogEntry) => {
        lifted.push({ actor: e.actorId, entry: { ...e, reactions: [] } });
        for (const r of e.reactions ?? []) lift(r);
    };
    for (const item of section) {
        const e = item.entry as Partial<CombatLogEntry>;
        if (typeof e.kind === 'string') lift(e as CombatLogEntry);
        else lifted.push(item);
    }
    return lifted.sort((a, b) => {
        const x = JSON.stringify(a.entry);
        const y = JSON.stringify(b.entry);
        return x < y ? -1 : x > y ? 1 : 0;
    });
}

function shipStateForCompare(state: unknown, ordered: boolean): unknown {
    if (ordered || state === null || typeof state !== 'object') return state;
    const s = state as { activeBuffs?: string[]; activeDebuffs?: string[] };
    return {
        ...s,
        activeBuffs: s.activeBuffs ? [...s.activeBuffs].sort() : s.activeBuffs,
        activeDebuffs: s.activeDebuffs ? [...s.activeDebuffs].sort() : s.activeDebuffs,
    };
}

/** The first pair of actors at which two turn orders disagree. */
function firstFlippedPair(a: string[], b: string[]): [string, string] | null {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) return [a[i], b[i]];
    }
    return null;
}

interface DivergenceOptions {
    /** Entry order inside a log section and chip-list order are significant. */
    ordered: boolean;
    /** Compare the combat log at all. */
    log: boolean;
}

function firstDivergence(
    original: Canon,
    swapped: Canon,
    opts: DivergenceOptions
): MirrorDivergence | null {
    const rounds = Math.max(original.rounds.length, swapped.rounds.length);
    for (let i = 0; i < rounds; i++) {
        const ro = original.rounds[i];
        const rs = swapped.rounds[i];
        if (!ro || !rs) {
            return {
                kind: 'round-count',
                round: (ro ?? rs).round,
                actors: [],
                original: String(original.rounds.length),
                swapped: String(swapped.rounds.length),
            };
        }
        if (!same(ro.turnOrder, rs.turnOrder)) {
            return {
                kind: 'turn-order',
                round: ro.round,
                actors: firstFlippedPair(ro.turnOrder, rs.turnOrder) ?? [],
                original: short(ro.turnOrder),
                swapped: short(rs.turnOrder),
            };
        }
        if (opts.log) {
            const lo = original.combatLog.find((r) => r.round === ro.round);
            const ls = swapped.combatLog.find((r) => r.round === ro.round);
            const so = lo ? logSections(lo) : [];
            const ss = ls ? logSections(ls) : [];
            for (let k = 0; k < Math.max(so.length, ss.length); k++) {
                const ea = so[k]?.entries ?? [];
                const eb = ss[k]?.entries ?? [];
                const a = opts.ordered ? ea : sortedSection(ea);
                const b = opts.ordered ? eb : sortedSection(eb);
                for (let j = 0; j < Math.max(a.length, b.length); j++) {
                    if (a[j] && b[j] && same(a[j].entry, b[j].entry)) continue;
                    const actors = [a[j]?.actor, b[j]?.actor].filter((x): x is string => !!x);
                    return {
                        kind: 'combat-log',
                        round: ro.round,
                        section: (so[k] ?? ss[k]).name,
                        actors: [...new Set(actors)],
                        original: a[j] ? short(a[j].entry) : '<none>',
                        swapped: b[j] ? short(b[j].entry) : '<none>',
                    };
                }
            }
        }
        const ss = new Map(rs.ships.map((s) => [s.actorId, s]));
        for (const state of ro.ships) {
            const other = ss.get(state.actorId);
            const a = shipStateForCompare(state, opts.ordered);
            const b = shipStateForCompare(other, opts.ordered);
            if (!same(a, b)) {
                return {
                    kind: 'ship-state',
                    round: ro.round,
                    actors: [state.actorId],
                    original: short(a),
                    swapped: short(b),
                };
            }
        }
    }
    if (original.outcome.winner !== swapped.outcome.winner) {
        return {
            kind: 'outcome',
            round: original.outcome.lastRound,
            actors: [],
            original: original.outcome.winner,
            swapped: swapped.outcome.winner,
        };
    }
    return null;
}

/** Whether a turn-order divergence is the documented cross-team speed tie: the two actors that
 *  traded places are on opposite sides, hold the same board cell, and act at equal live speed.
 *
 *  Up to the divergence the arms are the same fight, so at that slot the original arm picked `x`
 *  and the swapped arm picked `y` from the SAME board state. Each actor's speed is therefore read
 *  from the arm in which it acted at that slot (`x` original, `y` swapped), from its turn's
 *  `statsSnapshot`. The other arm's snapshot is not usable: there the actor acts after the other
 *  one, whose turn can change its speed (an on-damaged Speed Up) or destroy it. */
export function isCrossTeamSpeedTie(
    original: Canon,
    swapped: Canon,
    divergence: MirrorDivergence
): boolean {
    if (divergence.kind !== 'turn-order' || divergence.actors.length !== 2) return false;
    const [x, y] = divergence.actors;
    const rx = original.roster.find((r) => r.actorId === x);
    const ry = original.roster.find((r) => r.actorId === y);
    if (!rx || !ry || rx.side === ry.side || rx.position !== ry.position) return false;
    const speedIn = (arm: Canon, id: string): number | undefined =>
        arm.combatLog.find((r) => r.round === divergence.round)?.turns.find((t) => t.actorId === id)
            ?.statsSnapshot?.speed;
    const sx = speedIn(original, x);
    return sx !== undefined && sx === speedIn(swapped, y);
}

/** Whether `result` ended with both sides alive — the round cap, an enemy win by rule. */
function endedAtRoundCap(result: BattleResult): boolean {
    const last = result.rounds[result.rounds.length - 1];
    if (!last) return false;
    const alive = (side: MirrorSide) => last.ships.some((s) => s.side === side && s.alive);
    return alive('player') && alive('enemy');
}

function kindDiffs(
    original: BattleResult,
    swapped: BattleResult,
    labelsOriginal: ReadonlyMap<string, string>,
    labelsSwapped: ReadonlyMap<string, string>
): MirrorKindDiff[] {
    const idByLabel = new Map([...labelsSwapped].map(([id, label]) => [label, id]));
    const out: MirrorKindDiff[] = [];
    for (const [idO, label] of labelsOriginal) {
        const idS = idByLabel.get(label);
        if (idS === undefined) continue;
        const ko = fingerprintActor(original, idO);
        const ks = fingerprintActor(swapped, idS);
        const onlyOriginal = [...ko].filter((k) => !ks.has(k)).sort();
        const onlySwapped = [...ks].filter((k) => !ko.has(k)).sort();
        if (onlyOriginal.length === 0 && onlySwapped.length === 0) continue;
        const shipName = original.roster.find((r) => r.actorId === idO)?.name ?? label;
        out.push({ label, shipName, onlyOriginal, onlySwapped });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Compare an original-arm result with its swapped-arm result. Pure over the two results. */
export function compareMirror(
    input: BattleSimulationInput,
    original: BattleResult,
    swapped: BattleResult
): MirrorVerdict {
    const labelsO = labelsFromRoster(input, original, false);
    const labelsS = labelsFromRoster(swapSides(input), swapped, true);
    const co = canonicalize(original, labelsO, false) as Canon;
    const cs = canonicalize(swapped, labelsS, true) as Canon;
    const roundCap = endedAtRoundCap(original) && endedAtRoundCap(swapped);
    const exempt = (d: MirrorDivergence | null): MirrorDivergence | null =>
        d?.kind === 'outcome' && roundCap ? null : d;

    const strict = exempt(firstDivergence(co, cs, { ordered: true, log: true }));
    const unordered = strict
        ? exempt(firstDivergence(co, cs, { ordered: false, log: true }))
        : null;
    const state = strict ? exempt(firstDivergence(co, cs, { ordered: false, log: false })) : null;

    let cls: MirrorClass;
    if (!strict) cls = 'mirrored';
    else if (!unordered) cls = 'log-order';
    else if (isCrossTeamSpeedTie(co, cs, unordered)) cls = 'speed-tie';
    else cls = 'behaviour';

    return {
        class: cls,
        roundCap,
        strict,
        unordered,
        stateMirrored: state === null,
        kindDiffs: cls === 'behaviour' ? kindDiffs(original, swapped, labelsO, labelsS) : [],
    };
}

/** The composition with the ship at slot `label` made `delta` faster. Used to break a cross-team
 *  speed tie so the pair becomes comparable: the nudge is part of the composition, so both arms
 *  carry it and the tie no longer decides anything. */
export function withSpeedNudge(
    input: BattleSimulationInput,
    label: string,
    delta: number
): BattleSimulationInput {
    const index = Number(label.slice(1));
    const teamKey = label[0] === 'P' ? 'playerTeam' : 'enemyTeam';
    const team = input[teamKey].map((p, i) => {
        if (i !== index) return p;
        const speed = p.statOverrides?.speed ?? p.ship.baseStats.speed;
        return { ...p, statOverrides: { ...p.statOverrides, speed: speed + delta } };
    });
    return { ...input, [teamKey]: team };
}

export interface MirrorPair {
    original: BattleResult;
    swapped: BattleResult;
    stats: MirrorRunStats;
    verdict: MirrorVerdict;
    /** Slot label → ship name and board cell, from the original arm's roster. */
    ships: Record<string, { name: string; position: string }>;
}

/** Run both arms of a composition under `seed` and compare them. */
export function runMirrorPair(input: BattleSimulationInput, seed: number): MirrorPair {
    const original = runSeededBattle(input, seed);
    const { result: swapped, stats } = runSwappedPaired(input, seed);
    const labels = labelsFromRoster(input, original, false);
    const ships: MirrorPair['ships'] = {};
    for (const r of original.roster) {
        ships[labels.get(r.actorId)!] = { name: r.name, position: r.position };
    }
    return { original, swapped, stats, verdict: compareMirror(input, original, swapped), ships };
}
