import { describe, it, expect, beforeAll } from 'vitest';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { partitionReactiveAbilities } from '../triggers';
import { isEnemyTarget, isAllEnemiesTarget } from '../../abilities/abilityTargetSide';
import { CHEAT_DEATH_BUFFS } from '../cheatDeathBuffs';
import { corpusNames } from '../audit/kitFingerprintScenarios';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// #390 — THE STANDING CENSUS OF THE ENEMY-SIDE AURA/ACCUMULATING CHANNEL
//
// WHAT THIS GUARDS. Enemy-side AURA and ACCUMULATING statuses are registered once at actor
// construction into the singular `DEFAULT_ENEMY_TARGET` bucket (no victim id exists that early).
// `statusEngine.activeAbilityStatuses` now folds that bucket into every per-victim read — but for
// exactly ONE shape: a board-wide (`all-enemies`) AURA. Two things stay dropped.
//
//   • Every SUBSET scope — single `enemy`, either adjacency scope, any of the three selectors.
//     The bucket does not record which enemy the status was meant for, so folding it would smear
//     a one-victim debuff across the whole board. See
//     `enemyAuraDebuffChannel.characterization.test.ts` arm 4.
//   • The whole ACCUMULATING store, board-wide or not. `removeNewestFirst` (cleanse) gathers its
//     accumulating candidates from `accumEnemyMaps.get(actorId)`, so a folded entry would be
//     readable by every victim and removable by none — a status nobody can cleanse off one enemy,
//     which contradicts the ruling below.
//
// Both need the same real fix: registration at CAST time, per resolved victim.
//
// Nothing in the corpus lands in that dropped half today, which is exactly why it is dangerous: a
// kit that lands there does not crash, log, or look wrong — its debuff silently does nothing, and
// the DPS/defense calculators just return a number that is quietly incorrect. The trigger is a
// SHIP-DATA REFRESH, not a date: `npm run fetch:ship-skills` can introduce one at any time. This
// test is what makes that arrival loud.
//
// WHEN THIS TEST FAILS, IT IS NOT THE TEST THAT IS WRONG. A named ship has arrived in the dropped
// half. Either its skill text states a turn count that the parser is missing (fix the parser), or
// it genuinely has no turn window — which by the owner's 2026-08-29 ruling means "stays until it
// is cleansed or removed in another way", i.e. it SHOULD stand for the fight, and the dropped half
// of the channel now has a real instance to justify repairing it. That repair means moving
// enemy-side aura/accumulating registration to CAST time, where the resolved victim id is in
// scope — which fixes the subset scopes and the cleanse gap in one move.
//
// WHY REACTIVE ABILITIES DO NOT COUNT. `partitionReactiveAbilities` strips reactive abilities out
// of `castSkills` BEFORE the engine's `isAura` classification runs, so a reactive enemy-side
// status never reaches this channel at all — it is routed to the trigger executor instead. Both of
// the corpus' current enemy-side hits (Amartya's `Exposed` aura and `Defense Shred` accumulating)
// are reactive, which is why the live count is zero rather than two.
//
// WHY AURAS ARE EXEMPT FROM THE CLEANSE OBJECTION. An aura has no stored per-victim entry to
// remove on EITHER side — `removeNewestFirst`'s own "NOT in these maps" note says so: auras
// re-derive each round. They were uncleansable before this repair and are uncleansable after it,
// so folding them changes nothing about removability. That is a pre-existing property of the aura
// model, not something #390 introduced.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Refit levels swept. Only the refit-active passive applies in-game, so a status can be present
 *  at one refit and absent at another — sweeping one level would miss the other two. */
const REFIT_LEVELS = [0, 2, 4] as const;

interface Row {
    ship: string;
    slot: string;
    buffName: string;
    target: string;
    duration: string;
    /** True when `partitionReactiveAbilities` routes it away before registration. */
    reactive: boolean;
    /** 'aura' | 'accumulating' — which of the two dead-keyed stores it would land in. */
    kind: 'aura' | 'accumulating';
    /** True when the target covers the whole board, i.e. the fold DOES reach it. */
    boardWide: boolean;
}

/**
 * Sweeps every corpus ship at every refit level and returns one row per enemy-side buff/debuff
 * ability, classified exactly the way `engine.ts`'s `registerActorAbilityStatuses` classifies it.
 *
 * `includeTimed` exists for the validity arm only: with it false the sweep answers the real
 * question (which statuses reach the aura/accumulating stores); with it true it also counts the
 * numeric-duration statuses that take the working TIMED path, which is how this file proves its
 * own walk actually reaches enemy-side abilities rather than silently visiting nothing.
 */
function sweep(includeTimed: boolean): Row[] {
    const rows: Row[] = [];
    for (const refitLevel of REFIT_LEVELS) {
        for (const name of corpusNames()) {
            const ship = buildTraceShip(name, { refitLevel });
            if (!ship) continue;
            const all = buildShipAbilities(ship);
            const { castSkills } = partitionReactiveAbilities(all);
            const kept = new Set(castSkills.slots.flatMap((s) => s.abilities));
            for (const slot of all.slots) {
                for (const ability of slot.abilities) {
                    const cfg = ability.config;
                    if (cfg.type !== 'buff' && cfg.type !== 'debuff') continue;
                    if (!isEnemyTarget(ability.target)) continue;
                    // Mirrors engine.ts exactly — a divergence here would make the census lie.
                    const hitCount = cfg.type === 'buff' ? cfg.hits : undefined;
                    const hitCounted = hitCount !== undefined;
                    const accumulating = !hitCounted && !!cfg.stackTrigger && cfg.isStackable;
                    const castPathCheatDeath =
                        !accumulating &&
                        CHEAT_DEATH_BUFFS.has(cfg.buffName) &&
                        (slot.slot === 'active' || slot.slot === 'charged');
                    const isAura =
                        !accumulating &&
                        !castPathCheatDeath &&
                        !hitCounted &&
                        (cfg.duration === 'recurring' || cfg.duration === undefined);
                    if (!isAura && !accumulating && !includeTimed) continue;
                    rows.push({
                        ship: `${ship.name}@r${refitLevel}`,
                        slot: slot.slot,
                        buffName: cfg.buffName,
                        target: ability.target,
                        duration: String(cfg.duration),
                        reactive: !kept.has(ability),
                        kind: accumulating ? 'accumulating' : 'aura',
                        boardWide: isAllEnemiesTarget(ability.target),
                    });
                }
            }
        }
    }
    return rows;
}

const describeRow = (r: Row): string =>
    `${r.ship} [${r.slot}] "${r.buffName}" target=${r.target} duration=${r.duration} kind=${r.kind}`;

describe('#390 enemy-side aura/accumulating channel — corpus census', () => {
    let rows: Row[];

    beforeAll(() => {
        if (!csvAvailable()) {
            throw new Error(
                'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                    'the #390 census cannot run without it. Copy it in from the main checkout.'
            );
        }
        rows = sweep(false);
    });

    // ── THE GUARD ────────────────────────────────────────────────────────────────────────────
    // Exactly ONE shape is repaired: a board-wide AURA. Everything else in this channel is still
    // dropped — every subset scope (no victim id in the bucket to place it by) and the whole
    // ACCUMULATING store regardless of scope (cleanse gathers per victim, so a folded entry would
    // be readable by all and removable by none). Both await the same real fix: registration at
    // CAST time, per resolved victim.
    const isRepaired = (r: Row): boolean => r.boardWide && r.kind === 'aura';

    it('no shipped kit lands in the DROPPED half of the channel', () => {
        const dropped = rows.filter((r) => !r.reactive && !isRepaired(r));
        expect(
            dropped.map(describeRow),
            'A ship now reaches a part of the enemy aura/accumulating channel that silently ' +
                'discards its status. Read this file’s header before changing this assertion — ' +
                'the fix is in the engine, not here.'
        ).toEqual([]);
    });

    // Board-wide auras are no longer a defect (the fold reaches them), but their arrival would be
    // the first time that repaired path carries a real kit, so it is worth seeing rather than
    // assuming. Not an error: this arm reports, it does not forbid.
    it('reports any shipped kit now riding the REPAIRED board-wide aura fold', () => {
        const repaired = rows.filter((r) => !r.reactive && isRepaired(r));
        if (repaired.length > 0) {
            // eslint-disable-next-line no-console
            console.log(
                `#390: ${repaired.length} corpus status(es) now ride the board-wide aura fold:\n` +
                    repaired.map((r) => `  ${describeRow(r)}`).join('\n')
            );
        }
        expect(repaired.every(isRepaired)).toBe(true);
    });

    // ── THE INSTRUMENT'S OWN VALIDITY ────────────────────────────────────────────────────────
    // Without this arm the guard above would pass just as happily on a sweep that visited no
    // abilities at all — a missing CSV, a renamed field, a `continue` that swallowed everything.
    // A ZERO is not a measurement until the rate is known. Widening the classification to include
    // the numeric-duration statuses (the working TIMED path) must find a large population through
    // the SAME walk, the same target predicate and the same slot iteration.
    it('VALIDITY: the same walk finds the enemy-side statuses that take the working timed path', () => {
        const widened = sweep(true);
        expect(widened.length).toBeGreaterThan(100);
        // …and the widened sweep must contain subset-scoped, non-reactive rows — the exact shape
        // the guard asserts is empty. That is what proves the guard could report the opposite.
        const wouldHaveBeenDropped = widened.filter((r) => !r.reactive && !r.boardWide);
        expect(wouldHaveBeenDropped.length).toBeGreaterThan(0);
    });

    // Documents WHY the live count is zero, so a future reader does not conclude the corpus simply
    // has no enemy-side recurring statuses. It has them; they are routed elsewhere.
    it('the only enemy-side aura/accumulating statuses in the corpus are REACTIVE', () => {
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.reactive)).toBe(true);
    });
});
