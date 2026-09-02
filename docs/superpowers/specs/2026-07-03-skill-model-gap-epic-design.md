# Skill-model gap epic — design (2026-07-03)

**Source:** full-corpus gap sweep (`docs/skill-model-gap-sweep-2026-07-03.md` + raw JSON).
**Scope (user-locked):** Phases 1+2 — mis-parse fixes + new mechanics. Phase 3 (reactive-trigger
promotion, 29 ships) deferred to its own scoping pass. Deep one-offs (damage-to-DoT conversion,
overheal-redirect, defense-substitution) deferred to the audit allowlist.

**User-ratified game rules for this epic:**
- Buff steal moves the **newest** buff on the target (remaining duration travels with it).
- Per-count scaling in single-ship DPS mode follows the enemy-stealth-count precedent:
  count defaults to 0 in DPS mode, live-derived per-victim in the combat sim. No new UI.

## Post-sweep verification corrections (important)

The sweep dump omitted `Ability.scaling`/`everyNthEvent`, contaminating two families:

- **Per-count scaling (13 ships) → mostly FALSE POSITIVE.** Butcher, Judge, Akula, Nuqtu,
  Panguan, Lev, Centurion, Sustainer(active), Tithonus, Rhodium are all correctly modeled via
  `ScalingRule {conditionIndex, perUnit, cap}`. Remaining real: **Valiant(charged)** "for each
  buff on itself", **Sustainer(charged)** "for each buff on it" (phrasing variants → no scaling
  emitted), **Oleander(active)/Meatshield(charged)** repair-per-count (no heal scaling support).
- **Conditional-branch drops (9 ships) → model already supports the shape** (binary condition +
  perUnit: Crucialis active, Meiying). Remaining real: phrasing/typo variants — Crucialis
  (charged, "deals and additional"), Yin Jian ("additional deals"), Rikra ("against Taunted or
  Provoked enemies"), Wrecker ("if the target is affected by Inferno"), Gallant ("increased to
  185%… against Defenders") — plus Panon's "instead"-replacement branches.

Hand-confirmed real before speccing: control-twin gating (Makoli), charge sign/target (Thresh),
phantom damage (Tormenter/Voron), phantom DoT + tier-30 extraction bug (Wisteria), start-of-round
mis-tag (Judge), always-crit absent (grep), innate shield-pen unparsed (grep), buff steal absent
(grep), plain shield strip unparsed (only purge-coupled I6 variant exists — parser comment
acknowledges the other 3 corpus rows), debuff-duration reduction absent (grep).

## Verification protocol (binding, every PR)

Sweep findings can still be FPs (two whole families collapsed under scrutiny). Every implementer
**first writes the failing test that reproduces the finding**. If the test PASSES pre-change,
STOP-AND-REPORT: the finding is a false positive — document it; orchestrator decides
(drop / allowlist entry / audit-rule note). No fix without a red test first.

## Invariants (all PRs)

- TDD per `feedback_orchestrated_pr_workflow` §3: non-vacuous tests at parser, combat-integration,
  and DPS-parity layers. Golden suite is the regression gate — audited churn ONLY where behavior
  legitimately changes (phantom-ability removals and new mechanics WILL move numbers for the named
  ships; the PR must list exactly which ships moved and why; everyone else byte-identical).
- Team symmetry (`feedback_engine_team_symmetry`): every engine mechanic acts identically on
  either side.
- `audit:skills` stays at 0 findings; when a PR closes an allowlisted gap, remove the stale
  allowlist row (the stale-entry check will flag it).
- **New audit rules ship with new mechanics** (PR7–PR11 below): each adds a keyword→handled rule
  to `scripts/auditSkills.ts` so future CSV refreshes surface regressions (same pattern as the
  existing 10 rules).
- Implementers: Sonnet, worktree-isolated, `cp` main's `.env` + `docs/` in; no `vitest -u`;
  report raw data. Orchestrator reviews every diff.

## Phase 1 — mis-parse fixes (correctness; numbers move down or gates tighten)

**PR1 — Phantom-ability suppression.**
Guards so non-effect clauses stop minting abilities:
- Reduction/conversion clauses parsed as attacks: Tormenter p2 ("gains up to 30% damage
  reduction" → phantom damage 30), Voron p2 ("takes 20% less damage from DoTs" → phantom
  damage 20), Malvex, FrontLine.
- Trigger-phrase DoT re-application: "after applying Corrosion with a Critical hit, inflicts
  Inferno II" mints BOTH a phantom Corrosion and the Inferno with a mis-extracted tier
  (Wisteria p1: inferno tier 30). Ships: Wisteria, Valerian, Lingshe, Belladonna. Fix the
  trigger-referent recognition AND the tier extraction.
- Amartya p2/p3: "when an enemy defender gains Taunt" mints a phantom self Taunt buff-grant;
  also Exposed stack count (2 parses as 1).
Largest DPS-inflation fix in the epic; expect visible ranking shifts for these ships.

**PR2 — Control-twin gating parity.**
`control{effect}` abilities emitted alongside a debuff twin from the same sentence must inherit
the twin's resolved trigger + conditions (Makoli: debuff=on-attacked+HP<40, control=on-cast
ungated). Ships: Crocus, Nayra, Makoli, Meiying, Flamel, Guardian. Include an engine-side test
proving the control entry is actually consumed gated (or document that only the debuff twin is
consumed, in which case fix = don't emit the ungated twin).

**PR3 — Charge sign/target.**
`charge` config gains direction (`target: 'self' | 'enemy'` or signed amount). "Removes N
charges from the enemy" currently parses as self +N (Thresh, Demolisher, Opal, Provider);
Thresh's paired self-gain also lost its "if target is a Defender" gate — restore via the
shared-gate propagation used elsewhere. Engine: enemy charge removal decrements the victim's
charge meter (team-symmetric).

**PR4 — Round-boundary / start-of-combat trigger consistency.**
Same phrasing must map to the same trigger corpus-wide:
- "At the start of the round …" → start-of-round (Judge p2's 60% AoE parses on-cast today);
  suspects: Chimei, Incinerator, Kinetik, Chakara, Cinya, Cobalt, Nayra.
- "At the start of combat, this Unit gains …" one-time grants → pre-combat, not on-cast:
  Crucialis, Meatshield, Tycho, FrontLine.
Each ship verified individually (red test first) — some may already route via detectors the
dump can't see.

**PR5 — Small-fix batch (independent one-liners).**
- Panon: "If this Unit is Provoked or Taunted" → self-debuff condition (parses enemy-buff —
  subject inverted).
- Duration misattachment across multi-buff sentences: Bayah p1/p2 (Terran Bolster II loses
  "for 2 turns"), Oleander, Tycho.
- Nyxen: typed cleanse — optional debuff-type filter on cleanse config ("cleanses 2 Bombs").
- Isha/Guardian: crit-received gate collapsed → reactive heal fires on every hit (Isha
  stacks 6%+3% instead of exclusive 6%).

**PR6 — Conditional-branch phrasing hardening.**
Extend the existing condition+perUnit emission to the variants that miss today: Rikra
("against Taunted or Provoked enemies"), Wrecker ("if the target is affected by Inferno"),
Yin Jian ("if Stealthed, additional deals"), Crucialis charged ("deals and additional" typo),
Gallant ("increased to 185% … against Defenders" — replacement + conditional Stasis),
Valiant/Sustainer self-buff-count ("on itself"/"on it"), Oleander/Meatshield repair-per-count
(heal ability gains scaling support), Panon "instead" replacement branches (model as two
condition-complementary ability sets). May split into 6a/6b if the Panon replacement shape
balloons — implementer investigates first and stops-and-reports.

## Phase 2 — new mechanics (each adds its audit rule)

**PR7 — Always-crit. DROPPED (2026-07-03, user):** handled at the DATA layer — the game-data
import sets these ships' crit rate to 100% (Asphodel, Tormenter); a parser flag would
double-count. Shipped instead as audit tooling (rule `always-crit`, `handled: () => false`,
ships allowlisted with the data-layer reason) so future CSV additions surface for a
stat-verification check.

**PR8 — Innate Shield Penetration. DROPPED (2026-07-03, user):** same — shield penetration is
already a filled ship stat (import/template data) for all clause-carrying ships. Shipped as
audit rule `shield-penetration-innate` + allowlist (10 ships: the sweep's 9 plus **Xcellence**,
which the new rule caught and the sweep had missed). Chakara's skill-level "bypassing X% of
enemy Defense" (a per-skill defensePenetration modifier, NOT a stat) moves to PR12.

**PR9 — Shield-scaled damage + plain shield strip.**
(a) additional-damage basis gains 'shield' ("damage equal to X% of its current Shield"):
FrontLine, Malvex, Quixilver, Xcellence. (b) Plain "removes X% of the enemy Shield" strip
(APEX, Laika, Malvex) — generalize the I6 purge-coupled variant into a standalone
shield-strip ability. Team-symmetric; DoT/pen interactions per locked H rules.

**PR10 — Buff steal.**
New ability `buff-steal {count}`: remove the NEWEST stealable buff(s) from the target, grant to
the caster with remaining duration (user-ratified rule). Ships: Meatshield, Pallas, Thresh,
Tithonus. Interacts with purge machinery (steal = purge + grant; reuse purge's
stealable/unremovable classification). Meatshield's "steals Protection until 3 stacks" is the
named-buff variant — include if it falls out naturally, else allowlist with reason.

**PR11 — Debuff-duration reduction.**
Inverse of extend-dot: reduce active debuff durations on self/allies (Heliodor, Pestilence).
Lingshe's forced-detonation-at-zero rider: include only if trivial atop PR11's plumbing,
else allowlist (it's already partially allowlisted for detonation).

**PR12 — Wire existing types to unhandled phrasings + frequency caps.**
- damage-reflection/counter phrasings: Nosorog "reflects X%", Centurion p2/p3 "retaliates
  dealing X%" (on-attacked damage reaction — types exist).
- Chakara: "bypassing X% of the enemy Defense" → defensePenetration modifier (moved from
  dropped PR8 — this is a per-skill modifier, unlike the stat-layer shield pen).
- incoming-reduction phrasings: Anemone/Panon/Wusheng "takes X% less damage [while/from …]"
  (type exists; includes Tormenter's HP-scaled reduction from PR1's clause once un-phantomed —
  scaling via self-hp-missing-pct precedent).
- Frequency caps: "(once per round)" / "once per ally per round" on non-extra-action abilities
  (Nuqtu, Oleander, Ruiner, Sansi, FrontLine) — extend the `everyNthEvent`/oncePerRound
  machinery with a per-round cap field. If this half balloons, split it out.

## Dependency order

PR1 → PR2 → PR3 → PR4 → PR5 → PR6 sequential-ish (parser files overlap heavily; rebase chain).
Phase 2 (PR7/PR8 dropped — see above): PR9, PR10, PR11 independent of each other (parallel
worktrees) once Phase 1 lands; PR12 last (touches everything lightly).

## Allowlist additions shipped with this epic (deferred items, with reasons)

Damage-to-DoT conversion (Meatshield, Orel, Voron), overheal-redirect (Chimei, Madax),
defense-substitution (Meatshield), forced-affinity rider (Wusheng), charge-loss immunity (Lev),
on-ally-shield-destroyed (AEGIS), detonation-crit-power scaling (Lingshe — existing entry
covers), ignore-Stealth targeting / retarget-on-kill (verify detectIgnoresForcedTargeting
coverage first — the Taunt/Provoke half is already modeled).

## Out of scope (locked)

Phase 3 reactive-trigger promotion (own scoping pass later); stat-comparison gates; multi-target
hit counts; named-DoT stack counts; reactive on-death; enemy-charged-skill reactions.
