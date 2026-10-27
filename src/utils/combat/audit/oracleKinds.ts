import type { BattleResult } from '../../calculators/battleSimulator';
import type { CombatLogEntry, CombatLogEntryKind } from '../log/types';
import { PROTECTION_SHARE_NOTE } from '../log/buildCombatLog';
import { controlEffectLabel, dotFamilyLabel } from '../debuffImmunity';
import type { ControlEffect } from '../../../types/abilities';
import type { DoTType } from '../../../types/calculator';
import { OVERCLOCK_HANGOVER_DEBUFFS } from '../overclockHangover';
import type { DemotedKind, FingerprintDiff } from './types';

/**
 * The kind policy the differential and ablation oracles share: which log entries count as the
 * subject's OWN behaviour, over which rounds, and under which name.
 *
 * Both oracles ask "does this ship behave differently because of the ships beside it?". A kind
 * that books to the RECIPIENT or VICTIM reports what other ships did to the subject, and swapping
 * an interacting ally for an inert one changes that by design — an ally that buffs the subject
 * makes `buff-expired` fire on it, one that cleanses its DoT stops `dot-ticked`. Those are ally
 * effects ON the subject, not the subject's kit changing, so they are excluded.
 *
 * The set is fixed. The calibration gate in `scripts/lib/interactionOracle.ts` checks it against
 * an inert-only battery and fails when a residual survives; it never widens the set at runtime.
 */
export const EXCLUDED_KINDS: ReadonlySet<CombatLogEntryKind> = new Set<CombatLogEntryKind>([
    'death', // books to the victim: whether incoming damage was lethal
    'cheat-death', // books to the victim: a lethal hit it survived
    'buff-expired', // books to the holder with no granter: any ship's buff on it running out
    'debuff-resisted', // only the source-less form, booked to the resister (see `oracleKind`)
    'dot-ticked', // books to the victim of someone else's DoT
    'detonation', // books to the victim of someone else's bomb
    'shield-destroyed', // books to the victim whose shield incoming damage broke
    'hot-ticked', // books to the holder of a Repair Over Time, whoever granted it
]);

/** Rounds a comparison must cover before it counts as comparable. A one-round window sees the
 *  opening turn only, which is the same in both arms for nearly every kit. */
export const MIN_WINDOW = 2;

const DOT_TYPES: Record<DoTType, true> = {
    corrosion: true,
    inferno: true,
    bomb: true,
    generic: true,
};
const CONTROL_EFFECTS: Record<ControlEffect, true> = {
    provoke: true,
    taunt: true,
    stasis: true,
    'concentrate-fire': true,
    disable: true,
};
const DOT_FAMILY_LABELS = (Object.keys(DOT_TYPES) as DoTType[]).map(dotFamilyLabel);
const CONTROL_LABELS = new Set(
    (Object.keys(CONTROL_EFFECTS) as ControlEffect[]).map(controlEffectLabel)
);

/** The kind a resisted infliction was an attempt at, read from the engine's own resist labels
 *  (`dotResistLabel`, `controlEffectLabel`); any other label is a timed debuff. */
export function resistedAttemptKind(label: string | undefined): CombatLogEntryKind {
    const name = label ?? '';
    if (DOT_FAMILY_LABELS.some((fam) => name === fam || name.startsWith(`${fam} `))) {
        return 'dot-applied';
    }
    if (CONTROL_LABELS.has(name)) return 'control';
    return 'debuff';
}

const HANGOVER_DEBUFFS: ReadonlySet<string> = new Set(OVERCLOCK_HANGOVER_DEBUFFS);

function isOverclockHangoverRow(entry: CombatLogEntry): boolean {
    return (
        entry.kind === 'debuff' &&
        HANGOVER_DEBUFFS.has(entry.note ?? '') &&
        entry.targets.length === 1 &&
        entry.targets[0].targetId === entry.actorId
    );
}

/**
 * The kind an entry contributes to its actor's oracle fingerprint, or null when it contributes
 * nothing.
 *  - A resist booked to its INFLICTOR is an infliction attempt: whether it landed hinges on the
 *    target's security and a landing roll, not on the inflictor's kit, so it counts as the kind it
 *    tried to apply. A source-less resist books to the resister and stays `debuff-resisted`.
 *  - A landed control effect logs a `control` row AND a `debuff` row named after the effect; a
 *    resisted one logs a single resist. Both read as `control`, so landing and resisting the same
 *    Provoke fingerprint alike.
 *  - An Overclock hangover debuff is stamped on the holder with the holder as its caster, so an
 *    ally's Overclock expiring on the subject would read as the subject's own debuff. No kit
 *    inflicts a named debuff on its own caster, so a debuff row whose only target is its actor
 *    and whose name is one of `OVERCLOCK_HANGOVER_DEBUFFS` is that hangover and contributes
 *    nothing.
 *  - A protection share row is an `attack` booked to the PROTECTOR for damage it absorbed on an
 *    ally's behalf, not an attack it made.
 */
export function oracleKind(entry: CombatLogEntry): CombatLogEntryKind | null {
    if (entry.kind === 'attack' && entry.note === PROTECTION_SHARE_NOTE) return null;
    if (isOverclockHangoverRow(entry)) return null;
    if (entry.kind === 'debuff' && CONTROL_LABELS.has(entry.note ?? '')) return 'control';
    if (entry.kind === 'debuff-resisted' && entry.targets[0]?.targetId !== entry.actorId) {
        return resistedAttemptKind(entry.note);
    }
    return entry.kind;
}

function walk(entries: CombatLogEntry[], actorId: string, acc: Set<CombatLogEntryKind>): void {
    for (const e of entries) {
        if (e.actorId === actorId) {
            const kind = oracleKind(e);
            if (kind) acc.add(kind);
            // A landing the hit's own kill pre-empted is an infliction attempt, like a resist:
            // whether the target died to it hinges on the damage its allies dealt first.
            for (const t of e.targets) {
                for (const label of t.droppedLandings ?? []) acc.add(resistedAttemptKind(label));
            }
        }
        if (e.reactions?.length) walk(e.reactions, actorId, acc);
    }
}

/** The oracle fingerprint of one actor: the set of `oracleKind`s it produced in rounds
 *  `1..maxRound`, nested reactions included. */
export function oracleFingerprint(
    result: BattleResult,
    actorId: string,
    maxRound: number = Infinity
): Set<CombatLogEntryKind> {
    const acc = new Set<CombatLogEntryKind>();
    for (const round of result.combatLog) {
        if (round.round > maxRound) continue;
        walk(round.startOfRound, actorId, acc);
        for (const turn of round.turns) walk(turn.entries, actorId, acc);
        walk(round.endOfRound, actorId, acc);
    }
    return acc;
}

/**
 * The last round `actorId` saw through to the end alive, counting only rounds that were played
 * IN FULL. A fight ends at the end of the turn that wipes a side, so a final round that ends with
 * one side wiped is partial — the ships after the wiping turn never acted — and is not counted.
 * A final round with both sides standing ended on the round cap and is complete.
 *
 * 0 when the actor died in round 1 or the first round was partial.
 */
export function lastFullAliveRound(result: BattleResult, actorId: string): number {
    const rounds = result.rounds;
    if (rounds.length === 0) return 0;
    const sideOf = new Map(result.roster.map((r) => [r.actorId, r.side] as const));
    const last = rounds[rounds.length - 1];
    const standing = (side: 'player' | 'enemy') =>
        last.ships.some((s) => s.alive && sideOf.get(s.actorId) === side);
    const fullRounds = standing('player') && standing('enemy') ? rounds.length : rounds.length - 1;

    let window = 0;
    for (let i = 0; i < fullRounds; i++) {
        if (!rounds[i].ships.find((s) => s.actorId === actorId)?.alive) break;
        window = rounds[i].round;
    }
    return window;
}

/** Drop the excluded kinds from a diff; null when nothing is left. */
export function restrictDiff(raw: FingerprintDiff | null): FingerprintDiff | null {
    if (!raw) return null;
    const missing = raw.missingInComposition.filter((k) => !EXCLUDED_KINDS.has(k));
    const extra = raw.extraInComposition.filter((k) => !EXCLUDED_KINDS.has(k));
    if (missing.length === 0 && extra.length === 0) return null;
    return { ...raw, missingInComposition: missing, extraInComposition: extra };
}

/** True when `candidate` still shows every kind `original` reported, in the same direction. A
 *  reduced board that yields some OTHER diff is a different finding, not this one reproduced. */
export function diffPersists(
    original: FingerprintDiff,
    candidate: FingerprintDiff | null
): boolean {
    if (!candidate) return false;
    return (
        original.missingInComposition.every((k) => candidate.missingInComposition.includes(k)) &&
        original.extraInComposition.every((k) => candidate.extraInComposition.includes(k))
    );
}

/**
 * Rounds past the window the OTHER arm is read when deciding whether a kind diff is only the same
 * event shifted in time. A kind gated on a kill, a charged skill or an enemy's action lands one to
 * three rounds earlier or later when an ally changes kill timing, and a short window cuts one arm
 * of it. Triaged on the 2026-10-26 ledger: the window-edge rows sat one to three rounds out.
 */
export const TIMING_SLACK_ROUNDS = 3;

export interface WindowedDiff {
    /** Rounds both arms were compared over: the shorter of the two `lastFullAliveRound`s. */
    window: number;
    /** False when `window < MIN_WINDOW`; every diff is then null and `demoted` empty. */
    comparable: boolean;
    /** Normalised, windowed, NOT restricted. */
    raw: FingerprintDiff | null;
    restricted: FingerprintDiff | null;
    /** `restricted` minus the kinds `demoted` names. */
    reported: FingerprintDiff | null;
    demoted: DemotedKind[];
}

function partitionKinds(
    diff: FingerprintDiff | null,
    named: readonly DemotedKind[],
    keepNamed: boolean
): FingerprintDiff | null {
    if (!diff) return null;
    const keep = (sign: '-' | '+', k: CombatLogEntryKind) =>
        named.some((d) => d.sign === sign && d.kind === k) === keepNamed;
    const missing = diff.missingInComposition.filter((k) => keep('-', k));
    const extra = diff.extraInComposition.filter((k) => keep('+', k));
    if (missing.length === 0 && extra.length === 0) return null;
    return { ...diff, missingInComposition: missing, extraInComposition: extra };
}

/** `diff` without the kinds `drop` names; null when nothing is left. */
export function withoutKinds(
    diff: FingerprintDiff | null,
    drop: readonly DemotedKind[]
): FingerprintDiff | null {
    return partitionKinds(diff, drop, false);
}

/** `diff` reduced to the kinds `keep` names; null when none of them is in it. */
export function onlyKinds(
    diff: FingerprintDiff | null,
    keep: readonly DemotedKind[]
): FingerprintDiff | null {
    return partitionKinds(diff, keep, true);
}

/** Diff the subject's oracle fingerprint between a baseline run and a composition run, over the
 *  rounds the subject was alive for in BOTH. The diff's `actorId` is the composition-side id.
 *  A restricted kind the other arm shows within `TIMING_SLACK_ROUNDS` past the window is demoted
 *  as `timing`. */
export function windowedDiff(
    baseline: BattleResult,
    comp: BattleResult,
    shipName: string,
    baselineActorId: string,
    compActorId: string
): WindowedDiff {
    const window = Math.min(
        lastFullAliveRound(baseline, baselineActorId),
        lastFullAliveRound(comp, compActorId)
    );
    if (window < MIN_WINDOW) {
        return {
            window,
            comparable: false,
            raw: null,
            restricted: null,
            reported: null,
            demoted: [],
        };
    }
    const base = oracleFingerprint(baseline, baselineActorId, window);
    const inComp = oracleFingerprint(comp, compActorId, window);
    const missing = [...base].filter((k) => !inComp.has(k));
    const extra = [...inComp].filter((k) => !base.has(k));
    const raw: FingerprintDiff | null =
        missing.length === 0 && extra.length === 0
            ? null
            : {
                  actorId: compActorId,
                  shipName,
                  missingInComposition: missing,
                  extraInComposition: extra,
              };
    const restricted = restrictDiff(raw);
    const demoted: DemotedKind[] = [];
    if (restricted) {
        const slack = window + TIMING_SLACK_ROUNDS;
        const compLater = oracleFingerprint(comp, compActorId, slack);
        const baseLater = oracleFingerprint(baseline, baselineActorId, slack);
        for (const kind of restricted.missingInComposition) {
            if (compLater.has(kind)) demoted.push({ kind, sign: '-', reason: 'timing' });
        }
        for (const kind of restricted.extraInComposition) {
            if (baseLater.has(kind)) demoted.push({ kind, sign: '+', reason: 'timing' });
        }
    }
    return {
        window,
        comparable: true,
        raw,
        restricted,
        reported: withoutKinds(restricted, demoted),
        demoted,
    };
}
