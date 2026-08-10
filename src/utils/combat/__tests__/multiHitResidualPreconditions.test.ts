/**
 * multiHitResidualPreconditions.test.ts — the tripwire for the multi-hit epic's three LATENT
 * residuals.
 *
 * Three known defects survived the multi-hit epic. All three are real in the code and all three are
 * currently UNREACHABLE: each needs a multi-hit ship carrying a particular kind of firing-slot
 * clause, and no such ship exists. Rather than restructure three hot engine paths speculatively —
 * two of them move event ordering the epic deliberately pinned as byte-identical — the preconditions
 * are pinned HERE, so the day a ship arrives that can reach one, this file goes red and names it.
 *
 * This file asserts the ABSENCE of a trigger condition. That makes it a characterisation test whose
 * whole value is in failing later, so it deliberately passes on first run. If you are reading this
 * because it went red: the corpus changed, and one of the residuals below is now live. Do not
 * "fix" it by widening the allowance — go fix the residual it names.
 *
 * ── R1 · the accumulating enemy-status family ────────────────────────────────────────────────
 * `registerActorAbilityStatuses` classifies a firing-slot clause carrying `stackTrigger +
 * isStackable` as `accumulating`, which returns BEFORE the push into `timedEnemyBySlot` — the map
 * that feeds `applyDebuffsForSubAttack`. So an accumulating status is registered once and ticks
 * once per CAST, never once per sub-attack. A `hits: 3` ship with "applies 1 stack of Defense
 * Shred" would add one stack, not three. (The corpus's three stacked enemy grants — Lingshe,
 * Snakeroot ×2 — all carry an explicit "for N turns", so they classify as `timed` and already ride
 * the per-sub-attack path.)
 *
 * ── R2 · one-directional `control-applied` suppression ───────────────────────────────────────
 * The `control-applied` emit is suppressed for any control name in the cast-time resisted set, and
 * only sub-attack 0 writes that set. A control RESISTED on sub-attack 0 but LANDED on a later one
 * is in the status store yet emits no event, so its reactive listeners (`on-stasis-applied`) stay
 * dormant. The emit sits inside `runPlayerTurn`, while later sub-attacks run from the engine's
 * sub-attack hooks after it has returned — so this cannot be fixed in place without moving the
 * event relative to `ability-performed`.
 *
 * ── R3 · `reInflictedStasis` cannot see a late Stasis ────────────────────────────────────────
 * At all three actor sites the `turn.inflictedEnemyDebuffs` read precedes the positional drive, so
 * a Stasis landing on sub-attack >= 1 is appended too late for the re-inflict check. The break then
 * resolves as "not re-inflicted" and shaves a turn off the fresh Stasis.
 *
 * WHY THE PRECONDITION IS "a multi-hit ship with clause X" rather than "clause X": at `hits: 1`
 * there is exactly one sub-attack, so "once per cast" and "once per sub-attack" coincide, the
 * cast-time resisted set is the only set, and nothing can land after the read. All three residuals
 * are strictly multi-hit phenomena.
 *
 * CORPUS ACCESS: `docs/ship-skills.csv` is gitignored, so this file skips on a clean checkout —
 * the same pattern the other corpus-scanning tests use. That does mean a fresh clone gets no
 * tripwire; the guard is for the machine where ship data is actually refreshed, which is where a
 * new multi-hit ship would first appear.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import type { Ship } from '../../../types/ship';
import type { Ability } from '../../../types/abilities';

const FIRING_SLOTS = ['active', 'charged'] as const;

/** A ship's firing-slot abilities as the ENGINE receives them. Refit level changes only the passive
 *  row, which is not a firing slot, so level 4 alone covers both. */
const firingSlotAbilities = (name: string): Ability[] => {
    const skills = buildShipAbilities(buildTraceShip(name, { refitLevel: 4 }) as Ship);
    return skills.slots
        .filter((s) => (FIRING_SLOTS as readonly string[]).includes(s.slot))
        .flatMap((s) => s.abilities);
};

/** Every corpus ship with a firing-slot ability the engine will walk more than once. Read off the
 *  BUILT kit rather than the raw text: `parseHitCount` is module-private to buildShipAbilities, and
 *  the built `config.hits` is the value the engine's sub-attack loop actually reads — so this asks
 *  the question the residuals care about. Enforcer is the only one today (active 3 / charged 4). */
const multiHitShipNames = (): string[] =>
    loadShipSkillRecords()
        .map((rec) => rec.name)
        .filter((name) =>
            firingSlotAbilities(name).some(
                (a) =>
                    (a.config.type === 'damage' || a.config.type === 'additional-damage') &&
                    'hits' in a.config &&
                    typeof a.config.hits === 'number' &&
                    a.config.hits > 1
            )
        );

const ENEMY_TARGETS = ['enemy', 'all-enemies', 'adjacent-enemies', 'target-and-adjacent-enemies'];

/** R1's classification, mirrored from `registerActorAbilityStatuses`: a stacked grant with no hit
 *  count is `accumulating` and never reaches the per-sub-attack map. Mirroring the engine's own
 *  predicate EXACTLY matters — an approximate one over-counted a sibling fix by 5x (#306) — so the
 *  two quirks are reproduced rather than tidied: the engine derives the enemy `side` from the
 *  ability's TARGET (not from the config arm), and it reads `hits` only off the BUFF arm, because
 *  `hits` does not exist on the debuff arm at all. A debuff is therefore never hit-counted, and its
 *  classification reduces to the stack pair. */
const isAccumulatingEnemyStatus = (a: Ability): boolean => {
    const cfg = a.config;
    if (cfg.type !== 'debuff' && cfg.type !== 'buff') return false;
    if (!ENEMY_TARGETS.includes(a.target)) return false;
    const hitCounted = cfg.type === 'buff' && cfg.hits !== undefined;
    return !hitCounted && !!cfg.stackTrigger && !!cfg.isStackable;
};

const isControl = (a: Ability): boolean => a.config.type === 'control';

const isStasis = (a: Ability): boolean =>
    (a.config.type === 'control' && a.config.effect === 'stasis') ||
    (a.config.type === 'debuff' && /stasis/i.test(a.config.buffName ?? ''));

describe.skipIf(!csvAvailable())('multi-hit residual preconditions (tripwire)', () => {
    it('the corpus still has exactly one multi-hit ship', () => {
        // Not a residual itself — it is the shared premise of all three. If this grows, every
        // assertion below is suddenly load-bearing for a ship nobody has looked at.
        expect(multiHitShipNames()).toEqual(['Enforcer']);
    });

    // The R1 DETECTOR is unexercised by the corpus and needs its own proof.
    //
    // Widening the premise to all 147 ships makes the R2 and R3 assertions fail loudly (40 control
    // clauses, 29 Stasis clauses) — so those two detectors are demonstrably able to find what they
    // look for, and their green result means "the corpus has no MULTI-HIT one". R1's does not: it
    // stays green across the entire corpus, because no ship anywhere has an accumulating enemy
    // status on a firing slot. Its green is therefore untestable against real data, and without
    // this case a typo in the predicate would leave a permanently-passing assertion that could
    // never fail. Pinned directly against the engine's classification instead.
    it('R1 detector: separates an accumulating grant from a timed, hit-counted or self-side one', () => {
        const mk = (
            configType: 'debuff' | 'buff',
            target: string,
            cfg: Record<string, unknown>
        ): Ability =>
            ({
                id: 'synthetic',
                type: configType,
                target,
                trigger: 'on-cast',
                conditions: [],
                config: { type: configType, buffName: 'Defense Shred', ...cfg },
            }) as unknown as Ability;

        const STACKED = { stackTrigger: 'on-hit', isStackable: true };
        // Accumulating: stacks on a trigger, no hit count → the branch that skips timedEnemyBySlot.
        expect(isAccumulatingEnemyStatus(mk('debuff', 'enemy', STACKED))).toBe(true);
        // Enemy side is read off the TARGET, so an all-enemies grant counts too...
        expect(isAccumulatingEnemyStatus(mk('debuff', 'all-enemies', STACKED))).toBe(true);
        // ...and a self-side grant does not (it never rode timedEnemyBySlot to begin with).
        expect(isAccumulatingEnemyStatus(mk('buff', 'self', STACKED))).toBe(false);
        // A hit-counted grant is never accumulating — the hit lifecycle wins (engine's own note).
        // Only the BUFF arm can carry `hits`, which is why this case is not a debuff.
        expect(isAccumulatingEnemyStatus(mk('buff', 'enemy', { ...STACKED, hits: 1 }))).toBe(false);
        // A plain timed grant already rides the per-sub-attack path — the corpus's actual shape.
        expect(isAccumulatingEnemyStatus(mk('debuff', 'enemy', { duration: 3 }))).toBe(false);
        // Stackable without a trigger is not accumulating either.
        expect(isAccumulatingEnemyStatus(mk('debuff', 'enemy', { isStackable: true }))).toBe(false);
    });

    it('R1: no multi-hit ship carries an ACCUMULATING enemy status on a firing slot', () => {
        const offenders = multiHitShipNames().flatMap((name) =>
            firingSlotAbilities(name)
                .filter(isAccumulatingEnemyStatus)
                .map((a) => `${name}:${a.id}`)
        );
        // If this fails: that status applies once per CAST, not once per sub-attack, because the
        // `accumulating` branch returns before the `timedEnemyBySlot` push. See R1 in the header.
        expect(offenders).toEqual([]);
    });

    it('R2: no multi-hit ship carries a CONTROL clause on a firing slot', () => {
        const offenders = multiHitShipNames().flatMap((name) =>
            firingSlotAbilities(name)
                .filter(isControl)
                .map((a) => `${name}:${a.id}`)
        );
        // If this fails: a control resisted on sub-attack 0 but landed on a later one applies
        // silently — in the store, no `control-applied`, reactives dormant. See R2 in the header.
        expect(offenders).toEqual([]);
    });

    it('R3: no multi-hit ship inflicts STASIS from a firing slot', () => {
        const offenders = multiHitShipNames().flatMap((name) =>
            firingSlotAbilities(name)
                .filter(isStasis)
                .map((a) => `${name}:${a.id}`)
        );
        // If this fails: `reInflictedStasis` reads before the positional drive at all three actor
        // sites, so a Stasis landing on sub-attack >= 1 is invisible to it and the break shaves a
        // turn off the fresh Stasis. See R3 in the header.
        expect(offenders).toEqual([]);
    });
});
