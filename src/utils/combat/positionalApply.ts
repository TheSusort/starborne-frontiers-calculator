import type { Position } from '../../types/encounters';
import type { ParsedPattern, ParsedTarget } from '../targetingParser';
import { resolveCells, type CellRole } from '../targeting/resolvePattern';
import { resolvePositionalTarget, type ActorTargetingStatus } from './positionalBinding';
import {
    victimHitDamage,
    type AttackerDamageScalars,
    type VictimDefenseProfile,
} from './victimDamage';
import type { CombatActor } from './state';

/**
 * One footprint cell that landed on a living opposing actor.
 * `roleScale` is the per-cell damage multiplier: origin cells deal full damage
 * (1.0), covered/splash cells deal half (0.5).
 */
export interface FootprintHit {
    victim: CombatActor;
    /** origin → 1.0, covered (any non-origin role) → 0.5 */
    roleScale: number;
}

/**
 * The per-hit damage resolution outcome surfaced by the engine's victim-apply wrappers
 * (`applyIncomingToTarget` / `applyOutgoingToEnemy`, E1 — symmetric incoming surface):
 * the victim's shield pool BEFORE the hit, the HP damage that actually landed after
 * shield/Barrier absorption, and whether a Barrier fully absorbed the hit. E2 plumbs this
 * through `applyPositionalDamage` so per-direction leech can read it per footprint victim.
 */
export interface VictimDamageOutcome {
    shieldBefore: number;
    hpDamage: number;
    barriered: boolean;
}

/** Per-cell damage scale keyed off the resolved CellRole. */
const roleScaleFor = (role: CellRole): number => (role === 'origin' ? 1.0 : 0.5);

/**
 * Expand a positional pattern footprint into the list of living victims it hits.
 *
 * PURE helper. Given a parsed pattern, the resolved anchor position, and the living
 * opposing roster, returns one {@link FootprintHit} per occupied footprint cell with
 * its role scale. Empty cells contribute nothing; dead actors are not in the roster
 * map and so are never hit.
 *
 * `not-self` patterns produce only non-origin (covered) cells — the scale is keyed off
 * the resolved `role`, never off whether the cell equals the anchor.
 */
export function footprintVictims(
    pattern: ParsedPattern,
    anchor: Position,
    opposingLiving: CombatActor[]
): FootprintHit[] {
    // Mirror positionalBinding.byCell: living, positioned actors, ≤1 per cell.
    const byCell = new Map<Position, CombatActor>();
    for (const a of opposingLiving) {
        if (a.position !== undefined && a.currentHp > 0) {
            byCell.set(a.position, a);
        }
    }

    const hits: FootprintHit[] = [];
    for (const { position, role } of resolveCells(pattern, anchor)) {
        const victim = byCell.get(position);
        if (!victim) continue; // empty cell: contributes nothing
        hits.push({ victim, roleScale: roleScaleFor(role) });
    }
    return hits;
}

/**
 * Per-hit positional damage driver with live re-resolution.
 *
 * Drives `scalars.hits` discrete hits of one skill. For EACH hit it re-resolves the anchor and
 * re-expands the footprint against the LIVE `opposingLiving` roster — so when a victim
 * dies mid-skill (its `currentHp` drops to 0 inside `applyToVictim`), it disappears from
 * the roster and later hits redirect to the next living target automatically. This is the
 * heart of the task: target resolution and footprint expansion MUST run inside the loop.
 *
 * The per-hit loop count is `scalars.hits` — the SAME field victimHitDamage reads to re-split
 * the folded multiplier, keeping hit count from a single canonical source.
 *
 * Whiff (spec §5.1): if `resolvePositionalTarget` returns `null` for a hit (no living
 * opposing actor resolvable — e.g. everything died), that hit lands nothing: no
 * `applyToVictim`, no `emitHit`.
 *
 * PURE module: `applyToVictim` / `emitHit` are injected callbacks (engine wiring lives in
 * Task 8); this file imports no engine state.
 */
export function applyPositionalDamage(args: {
    hitCrits: boolean[];
    scalars: AttackerDamageScalars;
    pattern: ParsedPattern;
    actorPosition: Position;
    target: ParsedTarget;
    /** The live roster; re-read each hit (it mutates as victims die). */
    opposingLiving: CombatActor[];
    statusOf?: (id: string) => ActorTargetingStatus | undefined;
    acting?: { ignoresForcedTargeting?: boolean; provokedBy?: string };
    defenseProfileOf: (v: CombatActor) => VictimDefenseProfile;
    /**
     * Engine wrapper — decrements the victim's currentHp (Task 8 passes applyOutgoingToEnemy)
     * and returns the resolved {@link VictimDamageOutcome} (shield-before / HP-damage / barriered).
     */
    applyToVictim: (victim: CombatActor, damage: number) => VictimDamageOutcome;
    emitHit?: (victim: CombatActor, damage: number, didCrit: boolean) => void;
    /**
     * OPTIONAL per-victim hook (E2 — per-victim leech). Invoked once per footprint victim AFTER
     * the hit resolves, with the resolved {@link VictimDamageOutcome}. Direction-specific leech
     * logic is supplied per call site (standing vs taken) rather than branched inline. Unsupplied
     * → fully inert.
     */
    onVictimResolved?: (
        victim: CombatActor,
        damage: number,
        outcome: VictimDamageOutcome,
        didCrit: boolean
    ) => void;
    /**
     * OPTIONAL per-sub-hit victim-side incoming %-reduction hook (D-PR3). Invoked per footprint
     * victim with that victim's per-hit crit outcome; the returned percentage points are folded
     * additively into the incoming term of {@link victimHitDamage}. Unsupplied → 0 → byte-identical
     * (inert for victims without an incoming-reduction ability).
     */
    incomingReductionFor?: (victim: CombatActor, didCrit: boolean) => number;
    /**
     * OPTIONAL per-hit attacker-side outgoing amplification % hook (D-PR4 — Menace/Giant Slayer).
     * Invoked per footprint victim with that victim's per-hit crit outcome; the returned percentage
     * is applied multiplicatively on the resolved hit BEFORE {@link applyToVictim}. Unsupplied → 0 →
     * byte-identical (inert for attackers without an outgoing-amplification ability).
     */
    outgoingAmplificationFor?: (victim: CombatActor, didCrit: boolean) => number;
    /** OPTIONAL per-victim crit resolver. Anchor (origin) victim reuses hitCrits[h]; each
     *  covered (non-anchor) victim resolves via this callback. Unsupplied → every victim
     *  uses hitCrits[h] → byte-identical. */
    rollVictimCrit?: (victim: CombatActor) => boolean;
}): void {
    const {
        hitCrits,
        scalars,
        pattern,
        actorPosition,
        target,
        opposingLiving,
        statusOf,
        acting,
        defenseProfileOf,
        applyToVictim,
        emitHit,
        onVictimResolved,
        incomingReductionFor,
        outgoingAmplificationFor,
        rollVictimCrit,
    } = args;

    // Canonical hit count: derive the loop count from `scalars.hits` (the single source of
    // truth that victimHitDamage also reads), avoiding silent under/over-application from a
    // divergent separate `hits` arg.
    for (let h = 0; h < scalars.hits; h++) {
        // Re-resolve the anchor against the LIVE roster (a victim killed on an earlier hit
        // is already gone from opposingLiving via currentHp === 0 filtering).
        const anchorActor = resolvePositionalTarget(
            actorPosition,
            target,
            opposingLiving,
            statusOf,
            acting
        );
        if (anchorActor === null || anchorActor.position === undefined) {
            // WHIFF — no living target resolvable for this hit. Skip entirely.
            continue;
        }

        const anchorCrit = hitCrits[h] ?? false;

        for (const { victim, roleScale } of footprintVictims(
            pattern,
            anchorActor.position,
            opposingLiving
        )) {
            // Anchor reuses the pre-rolled hitCrits[h]; covered victims resolve via callback.
            const isAnchor = victim.id === anchorActor.id;
            const didCrit = isAnchor ? anchorCrit : (rollVictimCrit?.(victim) ?? anchorCrit);
            const equipReductionPct = incomingReductionFor?.(victim, didCrit) ?? 0;
            const dmgBase = victimHitDamage(
                scalars,
                defenseProfileOf(victim),
                didCrit,
                roleScale,
                equipReductionPct
            );
            const ampPct = outgoingAmplificationFor?.(victim, didCrit) ?? 0;
            const dmg = ampPct !== 0 ? dmgBase * (1 + ampPct / 100) : dmgBase;
            const outcome = applyToVictim(victim, dmg);
            emitHit?.(victim, dmg, didCrit);
            onVictimResolved?.(victim, dmg, outcome, didCrit);
        }
    }
}
