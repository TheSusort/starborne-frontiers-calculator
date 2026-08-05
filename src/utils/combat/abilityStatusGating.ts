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
    // SP-D: per-target DoT-only entry count is live-derivable — buildRoundContext derives
    // ConditionContext.enemyDotCount from the SAME corrosionEntryCount/infernoEntryCount/
    // bombCount already threaded through preDebuffGateCtx/postDebuffGateCtx (populated at cast
    // time by playerTurn.ts's ctx builders, and at reactive drain time by
    // buildDrainContext/buildActorConditionContext). Needed here for Anemone's Taunt (a timed
    // SELF-buff gated on "3+ Damage over Time effects on the primary enemy") and Belladonna's
    // Stasis (a timed ENEMY debuff gated on "3+ Acidic Decay") — without this, both conditions
    // would be neutralized to 'always' and grant/inflict unconditionally.
    'enemy-dot-count',
    // Ship-kit Wave 4, Task 3: the caster's own shield-presence gate is live-derivable —
    // buildRoundContext's selfShielded field reads the acting actor's LIVE shieldPool
    // (`actor.shieldPool > 0`) at cast time. Needed here for APEX's charged Disable (a timed
    // ENEMY debuff gated on "If this Unit has Shield") — without this, liveGateConditions would
    // neutralize the condition to 'always' and the debuff would inflict unconditionally, exactly
    // the bug this task fixes.
    'self-shield',
    // Quixilver R2: the caster's shield pool being AT max HP is live-derivable on both paths —
    // the reactive drain reads engine.ts's `isSelfShieldFull` (live `shieldPool` vs
    // `recipientMaxHp`) via buildDrainContext, and the cast path reads playerTurn.ts's
    // base-HP approximation in preDebuffGateCtx/modifierCtx. Without this entry the whole gate
    // is neutralized to 'always' and Quixilver's end-of-turn passive grants a team-wide Barrier
    // on EVERY turn regardless of its shield — the `self-shield` sibling directly above exists
    // for the same reason (APEX), and this is the strictly narrower version of it.
    'self-shield-full',
    // Malvex charged Barrier: the TARGET's shield-presence gate is live-derivable — every cast-time
    // round context in playerTurn.ts populates `enemyShielded` from the resolved victim's LIVE
    // shieldPool (`enemy.shieldPool > 0`). Needed here because Malvex's "If the target has a
    // Shield, it gains Barrier for 1 hit" is a charge-slot TIMED SELF BUFF, gated by
    // postDebuffGateCtx through this very rewrite — without this entry liveGateConditions
    // neutralizes the condition to 'always' and Malvex gains full damage immunity on EVERY charged
    // cast, shielded target or not. Same lever as the `self-shield` (APEX) sibling above, target
    // side instead of owner side.
    'enemy-shield',
    // Ship-kit W8 Task 13: whether the enemy an on-enemy-destroyed reaction just killed carried a
    // debuff is live-derivable — the executor folds ConditionContext.killedEnemyHadDebuff in as a
    // targeted override (keyed to the specific victim, eventCtx.victimId) right before this gate
    // runs (triggers.ts's executeIntent). Needed for Meiying's Stasis-on-kill (a timed ENEMY
    // debuff gated on "killing an enemy WITH A DEBUFF") — without this, the condition would be
    // neutralized to 'always' and Stasis would land unconditionally on every kill.
    'killed-enemy-had-debuff',
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
