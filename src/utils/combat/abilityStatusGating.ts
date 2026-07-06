import { Condition, ConditionSubject } from '../../types/abilities';

/**
 * Subjects whose live per-round counts the Phase-1 sim can derive. Conditions on
 * these gate buff/debuff abilities dynamically. `enemy-buff` and `self-debuff` are
 * now live-derivable too (populated from the round context's `enemyBuffNames` /
 * `selfDebuffNames` arrays, item 11) — they are no longer hardcoded 0 and so are
 * read literally instead of neutralized. `lowest-speed-ally` is live-derived from
 * the player team's speeds each round (Phase 4c PR 6). Derivable conditions on any
 * OTHER subject (ally counts — still unavailable to the Phase-1 sim) are neutralized
 * to 'always', preserving the old static gate's "satisfiable in principle" semantics:
 * without this they would flip from included to permanently excluded. Manual
 * (non-derivable) conditions keep literal gating via manualCount.
 */
const LIVE_SUBJECTS: ReadonlySet<ConditionSubject> = new Set([
    'always',
    'enemy-debuff',
    'enemy-buff',
    'enemy-type',
    'self-buff',
    'self-debuff',
    'self-crit',
    'hp-threshold',
    'enemy-hp-pct',
    'enemy-hp-missing-pct',
    'lowest-speed-ally',
    'target-repaired-this-round',
    'not-hit-this-round',
    'first-activator',
    'last-standing',
    // Phase 0 Task 5: every-n-turns is now live-derivable via CombatActor.turnsTaken (populated
    // by the engine drain context's turnsTakenFor delegate). Evaluated literally so the modulo
    // period gate fires only when turnsTaken % period === offset.
    'every-n-turns',
    // SP-C: owner-vs-target stat comparison is live-derivable from the acting actor's own
    // stats vs its target's (ConditionContext.self{CritPower|Speed|CurrentHp}/target{...},
    // populated by playerTurn.ts's preDebuffGateCtx/postDebuffGateCtx/ctx). Needed here for
    // Bayah's crit-power-gated Stasis INFLICT — a named timed enemy debuff, gated at
    // application via this liveGateConditions rewrite, not just the payload `ctx` that drives
    // the `type:'control'` ability's `control-applied` reaction event.
    'stat-vs-target',
    // SP-D: number of enemies damaged by this cast is live-derivable — the positional engine
    // knows the firing actor's per-cast footprint size (ConditionContext.enemiesHitThisCast,
    // populated at reactive drain time by buildDrainContext/buildActorConditionContext, and at
    // cast time by playerTurn.ts's ctx builders). Needed here for Berserker's Marauder Rage I/II
    // — a timed self-buff gated on "hitting 3+ enemies", drained via the on-deal-damage reactive
    // trigger (a passive-sourced timed self-buff can otherwise only be seeded once at combat
    // start, before any cast has happened — see seedPassiveTimedStatuses).
    'enemies-hit-this-cast',
]);

/**
 * Rewrite a buff/debuff ability's conditions for in-loop dynamic gating: derivable
 * conditions on non-live subjects are neutralized to 'always' (preserving the legacy
 * static-gate semantics for counts the Phase-1 sim cannot derive); live-subject and
 * manual conditions pass through untouched.
 */
export function liveGateConditions(conditions: Condition[]): Condition[] {
    return conditions.map((c) =>
        c.derivable && !LIVE_SUBJECTS.has(c.subject)
            ? { subject: 'always' as const, derivable: true, ...(c.anyOf ? { anyOf: true } : {}) }
            : c
    );
}
