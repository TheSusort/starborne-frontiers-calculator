# Combat Realism Epic — Roadmap & Decomposition

**Date:** 2026-06-17
**Status:** Decomposition ratified; sub-project A in design.

## Goal

A battle simulator as close as possible to the in-game combat, where **a ship on one
team behaves exactly as the same ship on the other team**. This epic picks up after the
`bySide` unification campaign (team-agnostic engine, complete through PR6b) and closes the
remaining *mechanics realism* gaps — not just damage-affecting effects, but every stat,
buff, debuff, control, and ability source the game uses.

This supersedes the old PR7 (per-victim AoE accounting) as the active combat work; PR7
becomes sub-project E, deferred to the tail.

## Why now

`simulateBattle` (`src/utils/calculators/battleSimulator.ts`) is a live positional consumer
of `runCombat` — it threads positions/targets/patterns on both sides and reads per-victim
damage via `rd.perTargetDamage` + the event log. The engine is team-agnostic and positional;
the gaps now are *which mechanics it simulates*, not *how it routes sides*.

## Sub-projects (each gets its own spec → plan → PRs)

| ID | Sub-project | One-line |
|----|-------------|----------|
| **A** | **Dynamic effective-stats backbone** *(first; in design)* | One per-round `effectiveStatsOf(actor)` snapshot for all stats; make hacking/security/shield-pen live; route every stat to its consumer. |
| **B** | Control effects (Stasis) | Turn-skip + damage-break + tick-on-skip + reactive suppression. |
| **C** | Purge + Cleanse | Count-based status removal, newest-applied first, DoTs included. |
| **D** | New ability sources: implants + gear-set skills | Source (data exists) → parse → into the ability pipeline; includes leech/shield/reflect set sources. |
| **E** | Per-victim AoE accounting (old PR7) | Symmetric incoming surface, per-victim modifier sourcing, per-victim leech, death-fallback. |
| **F** | Pre-fight stat modifiers | Squad leaders + pre-fight passives (Lionheart) establish combat-entry base stats. |
| **G** | Damage-reaction mechanics | Reflect (new) + counterattack condition/AoE refinements. |
| **H** | Shield system | Per-actor shield grant (beyond heal-target) + surface shield gains/pool in the sim + shield-pen 80/20 split + max-shield=maxHP. Sources extend via D. |

### Dependency notes
- **A is the backbone.** A's `effectiveStatsOf` = **pre-fight base (F) + in-fight deltas (A)**;
  A takes the base as input, so A does **not** depend on F shipping first.
- **B, C** are largely self-contained.
- **D** provides more ability sources that then ride A/B/C/G machinery; also supplies several
  shield/leech/reflect *sources* the other sub-projects consume.
- **E, F, G** can land in any order after A.

## Locked game rules (captured during brainstorming, binding for the relevant sub-project)

### Stat layers (A + F)
- "All stats dynamic" = **two layers**: (1) **pre-fight base** set once before round 1 from
  squad leaders + pre-fight passives, static during the fight (F); (2) **in-fight** buffs/debuffs
  recomputed per round (A).
- **HP is special: there are no in-fight HP buffs/debuffs.** Max HP is only modified pre-fight,
  so it is fixed once combat starts (no mid-fight max-HP scaling question).
- Canonical stat list (`src/types/stats.ts`): flexible {hp, attack, defence, speed, hacking,
  security} + percentage {crit, critDamage, healModifier, hpRegen, defensePenetration,
  shieldPenetration, damageReduction} (shield excluded — game bug).

### Affinity (`docs/Loading_Screen_Affinities.png`)
- Wheel Electric→Thermal→Chemical→Electric; Antimatter neutral.
- **Advantage:** +25% damage, +25% hacking.
- **Disadvantage:** −25% damage & hacking, −25% crit rate (hard cap 75%), and **effects that do
  not require hacking are not applied at all.**
- Damage/crit affinity already modeled. **Gap:** affinity ±25% on the *hacking landing roll* is
  omitted in the positional/healing path; the disadvantage "non-hacking effects not applied"
  rule is unenforced. → both fold into **A2**.
- inflict-vs-apply landing already modeled: `inflict` (and unmarked) draws the hacking-vs-security
  gate; `apply` is affinity-based only.

### Stasis (B)
- Direct damage **breaks** Stasis (frees the unit early); **DoTs do not** break it. "Don't break
  Stasis" attackers (Akula) are the exception — even their direct attacks don't break it.
- Stasis **ticks on the skipped turn** (decrement still runs); other timed statuses tick too.
- DoTs still tick on the stasised unit; allies can still heal/buff it.
- The stasised unit's **reactives are suppressed** (full lockout: no scheduled turn and no
  reactions). The attack-that-breaks-Stasis ordering vs `on-attacked` is pinned in B's spec.
- **Overload** is *not* a control (it's a self-stacking resource) — only **Stasis** is a turn-skip
  control; taunt/concentrate-fire/provoke are forced-targeting (already modeled / planned).

### Cleanse / Purge (C)
- Cleanse removes X **debuffs including DoTs**, sorted by time-applied **newest first**.
- Purge mirrors for **buffs**. Both respect the Unremovable/persistent-stacking set.

### Shield + shield penetration (H system; A exposes the stat; D sources)
- Shield penetration is a passive, usually 20% (effectively a static per-ship stat). A includes
  it in the effective-stats snapshot; **H consumes it** in the absorb path.
- **Split:** an attacker with 20% shield-pen deals **80% to shield** (overflow to HP once the
  shield is gone) **+ 20% straight to HP**, bypassing the shield.
- **Max shield = max HP.** Sources: own skills, allies' skills, gear-set shield skills, and an
  implant converting a portion of overheal into shield (sources → D).
- **Half-built today:** `CombatActor.shieldPool` exists and per-victim shield *absorb* works in
  the positional path; shield *grant* only routes to the heal-target (healing mode) and the
  battle sim hardcodes `shieldsAbsorbed: 0`. H generalizes grant to any actor, surfaces shields
  in the sim, and adds the shield-pen split.

### Damage reactions (G)
- **Reflect** (unmodeled): % of incoming direct damage dealt back to the attacker; sources =
  a gear set + some passives.
- **Counterattack** (partially modeled via on-attacked → damage reactive): Nyxen counters only
  *if shielded*; Centurion counters *including all adjacent allies*.

### Already covered (do not re-model)
extra-turn-on-kill (Liberator, once/round), leech (damage-leech heals/shields), Cheat Death as
the only revive, charge generation, multi-hit crit distribution, no damage caps.

## Workflow (inherited from the bySide campaign)
Subagent-driven implementation; per-task spec + quality review + final holistic review;
byte-identical goldens are the default gate (audited churn only where behavior legitimately
changes, explained line-by-line); `audit:skills` 0/141 + lint + tsc clean every PR; never blind
`vitest -u`; `gh auth switch --hostname github.com --user TheSusort`; docs gitignored
(`git add -f`, `--no-verify` for docs commits); work on the main checkout
(`feat/combat-sim-phase5-pr2`).
