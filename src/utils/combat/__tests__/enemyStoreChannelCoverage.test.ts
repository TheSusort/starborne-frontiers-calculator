/**
 * #398 — THE STORE-AXIS TRIPWIRE.
 *
 * ── THE LOCKED RULE THIS ENFORCES ─────────────────────────────────────────────────────────────
 * Stated alongside the side rule, deliberately NOT inside it:
 *
 *   A status's effect does not depend on which side APPLIED it. The SIDE axis (who HOLDS the
 *   status — player ship vs enemy ship) and the STORE axis (who APPLIED it — the holder's own
 *   SELF store vs the per-victim ENEMY store) are INDEPENDENT. A rule proven on one axis says
 *   NOTHING about the other.
 *
 * ── WHY A TRIPWIRE AND NOT ANOTHER AUDIT ──────────────────────────────────────────────────────
 * #389, #396 and #398 are three rungs of ONE ladder, all the same shape: a `parsedEffects` channel
 * gets added and wired on the SELF side only, so a debuff the opposing side applies lands,
 * displays, ticks down and changes nothing.
 *
 *   #389 — `attack` / `outgoingDamage`. A defender-applied `Attack Down` at -90% left a
 *          10,000-attack enemy throwing a full 40,000 over four rounds.
 *   #396 — `defense` / `incomingDamage` / `incomingHeal` / `outgoingHeal`.
 *   #398 — `crit` / `critDamage` / `speed` / `hacking` / `security`, across 17 corpus ships.
 *
 * Every rung was found by HAND-auditing store readers, which is why each one only ever surfaced
 * the channels somebody happened to enumerate that week — #396's own audit note had already NAMED
 * all of #398's channels as dead a PR earlier; what was missing was a measurement, not the
 * knowledge.
 *
 * TEAM SYMMETRY CANNOT FIND THESE, structurally. `foldActorBuffTotals` is keyed by `actorId` and
 * reads the same sources regardless of side, so a dead channel is dead SYMMETRICALLY — a
 * symmetry oracle asks "does the player side behave like the enemy side?" and the honest answer is
 * *yes, identically*. Symmetry oracles find asymmetries; this is a symmetric ABSENCE. That is why
 * the store axis needs its own instrument.
 *
 * ── WHAT MAKES IT RED ─────────────────────────────────────────────────────────────────────────
 * Adding a key to `ParsedBuffEffects` without either wiring the enemy side or adding an explicit,
 * JUSTIFIED dead-list entry below. If you are reading this because it went red: wire the enemy
 * store, or add the channel to DEAD_CHANNELS with a REASON — a bare name is not an entry.
 */
import { describe, it, expect } from 'vitest';
import { SHADOW_CHANNELS, FOLD_SHADOW_CHANNELS } from '../buffTotals';
import { TURN_SHADOW_CHANNELS } from '../triggers';
import type { ParsedBuffEffects } from '../../../types/calculator';

/**
 * Every channel deliberately NOT readable from the per-victim enemy store, with the reason it is
 * legitimately dead. The reason IS the entry — see the placeholder guard below.
 */
const DEAD_CHANNELS: Record<string, string> = {
    hp: 'No `HP Down` / `Max HP Down` family exists anywhere in docs/ship-skills.csv, so there is no applier to switch on (#398 ruling R5). It was the sixth channel the #396 audit named dead; the other five are now live.',
    hotPct: "Grant-shaped, not a modifier: a repair-over-time whose magnitude is a % of the APPLYING unit's max HP. It is written onto the recipient at grant time and has no enemy-store read to make.",
    attackFlat:
        'A CONCRETE frozen flat-attack value, materialized at grant time from a caster snapshot. A grant, not a standing modifier, so there is nothing on the enemy side to fold.',
    attackFlatPctOfCaster:
        'A SENTINEL carrying no concrete value — inert in every fold until the reactive buff-grant site resolves it into `attackFlat`. Folding it anywhere, either store, would be a bug.',
    dotDamage:
        "Read from the ATTACKER's own self/attacker list only, via toDotAndPenModifiers — no enemy-store meeting point exists (the #396 channel audit).",
    detonationDamage:
        "Read from the ATTACKER's own self/attacker list only (Out. Detonation Damage Up), feeding the applier's bomb snapshot and the detonating actor's live multiplier. No enemy-store read.",
    defensePenetration:
        "Read from the ATTACKER's own list only and folded through toDotAndPenModifiers rather than the buff totals, so it never meets an enemy-store read (the #396 channel audit).",
    incomingDotDamage:
        "Read from the ENEMY list ONLY (toDotAndPenModifiers' `enemy` argument) and never from a self list. Having no SELF-side read, it has no cross-store meeting point and needs no shadowing — the inverse of the #398 shape, not an instance of it.",
};

/**
 * A total map over `ParsedBuffEffects`, so the key set is DERIVED FROM THE TYPE rather than
 * hand-copied. `Record<keyof ParsedBuffEffects, true>` makes tsc reject the file the moment a
 * channel is added to the type and not listed here — which is the first half of the gate, and the
 * half a hand-maintained array cannot provide.
 */
const ALL_CHANNELS: Record<keyof ParsedBuffEffects, true> = {
    attack: true,
    crit: true,
    critDamage: true,
    outgoingDamage: true,
    defensePenetration: true,
    detonationDamage: true,
    dotDamage: true,
    outgoingHeal: true,
    hp: true,
    incomingHeal: true,
    hotPct: true,
    defense: true,
    incomingDamage: true,
    incomingDotDamage: true,
    speed: true,
    hacking: true,
    security: true,
    attackFlat: true,
    attackFlatPctOfCaster: true,
};

/** `defense` and `incomingDamage` meet on the per-VICTIM path in engine.ts's
 *  `victimIncomingModifiers` rather than at either of the two fold sites, so they are live without
 *  appearing in FOLD_SHADOW_CHANNELS or TURN_SHADOW_CHANNELS. */
const PER_VICTIM_PATH = new Set(['defense', 'incomingDamage']);

describe('#398 store-axis tripwire — every parsedEffects channel is wired or justified', () => {
    it('accounts for every channel: either enemy-store-live or explicitly dead-listed', () => {
        const live = new Set<string>(SHADOW_CHANNELS);
        const unaccounted = Object.keys(ALL_CHANNELS).filter(
            (c) => !live.has(c) && !(c in DEAD_CHANNELS)
        );
        expect(
            unaccounted,
            'These parsedEffects channels have no enemy-store reader and no justified dead-list ' +
                'entry. Wire the enemy side, or add them to DEAD_CHANNELS with a reason.'
        ).toEqual([]);
    });

    it('no channel is both live and dead-listed', () => {
        expect(SHADOW_CHANNELS.filter((c) => c in DEAD_CHANNELS)).toEqual([]);
    });

    it('every dead-list entry carries a real justification, not a placeholder', () => {
        for (const [channel, reason] of Object.entries(DEAD_CHANNELS)) {
            expect(
                reason.length,
                `${channel}'s dead-list reason is too short to be one`
            ).toBeGreaterThan(60);
            // Word-bounded on purpose: an unanchored /TODO/i matches the "toDo" inside
            // `toDotAndPenModifiers`, which is a real function name three of these reasons cite.
            expect(reason, `${channel}'s dead-list reason is a placeholder`).not.toMatch(
                /\b(TODO|TBD|FIXME|later|for now|unclear)\b/i
            );
        }
    });

    it('no dead-list entry names a channel that is not in the type', () => {
        // Guards the other direction: a channel REMOVED from ParsedBuffEffects leaves a stale
        // justification behind, which reads as coverage it no longer has.
        const stale = Object.keys(DEAD_CHANNELS).filter((c) => !(c in ALL_CHANNELS));
        expect(stale).toEqual([]);
    });

    it('both fold-site lists are subsets of SHADOW_CHANNELS', () => {
        // A channel folded at a site but absent from SHADOW_CHANNELS would skip the shadowing
        // comparison entirely and ADD across the store boundary — the shape the locked
        // highest-tier-wins ruling forbids.
        for (const c of FOLD_SHADOW_CHANNELS) expect(SHADOW_CHANNELS).toContain(c);
        for (const c of TURN_SHADOW_CHANNELS) expect(SHADOW_CHANNELS).toContain(c);
    });

    it('every live channel is actually folded somewhere', () => {
        // SHADOW_CHANNELS is a claim that a cross-store meeting point EXISTS. A member no fold
        // site reads is an inert claim — the exact state the five #398 channels were in.
        const folded = new Set<string>([...FOLD_SHADOW_CHANNELS, ...TURN_SHADOW_CHANNELS]);
        const orphans = SHADOW_CHANNELS.filter((c) => !folded.has(c) && !PER_VICTIM_PATH.has(c));
        expect(orphans).toEqual([]);
    });

    it('the five #398 channels are live, and hp is not', () => {
        // A direct regression fence on the rung this file was written for.
        for (const c of ['crit', 'critDamage', 'speed', 'hacking', 'security'] as const) {
            expect(SHADOW_CHANNELS, `${c} must stay enemy-store-live`).toContain(c);
        }
        expect(Object.keys(DEAD_CHANNELS)).toContain('hp');
    });
});
