# A defender-applied Attack Down / Out. Damage Down must reduce what its attacker throws

**Issue:** #389 · **Date:** 2026-08-25 · **Status:** owner ruling given — "defender debuffs should
reduce incoming damage". Fix it.

## 1. The defect

The attacker's outgoing-damage fold honours **its own** attack/outgoing debuffs and **ignores** ones
applied **by the defender**. Measured during #358 (PR #388), defence 0, one 10,000-attack enemy,
4 rounds, on `simulateDefenseSurvivability`:

| fixture | damage thrown over the window |
| --- | --- |
| plain | 40,000 |
| enemy **self**-buffs `Out. Damage Up +50%` | 60,000 ← the fold is live |
| enemy **self**-debuffs `Out. Damage Down −50%` | 20,000 ← it reads debuffs on the enemy |
| enemy **self**-debuffs `Attack Down −50%` | 20,000 |
| **defender applies** `Out. Damage Down −50%` | **40,000 — unmoved** |
| **defender applies** `Attack Down −50%` / `−90%` | **40,000 — unmoved** |

**The debuff lands.** A same-cast `Inc. Damage Up` on the same enemy halved its survival (kill round
6 → 3), proving the application reached the enemy that round, while the per-round thrown figure
stayed byte-identical to the control.

## 2. Why it matters beyond one page

Real kits exist to do this, verified in `docs/ship-skills.csv`:
- **Opal**, 1st passive: *"When directly damaged, this Unit Inflicts Attack Down II for 2 turns."*
- **Warden**, 2nd passive: *"…when this Unit inflicts a Debuff, it inflicts Out. Damage Down II"*

Every ship with a suppression passive is currently modelled as **less durable than it plays**, and
every attacker it debuffs is modelled as hitting harder than it should. This is a combat-simulator
defect, not a calculator defect — the Defense page merely made it visible.

## 3. Constraints

- **TEAM-SYMMETRIC.** An enemy-applied debuff on a player attacker must work identically. A
  player-only fix is a defect, per this project's standing engine rule.
- **`duration: 'recurring'` on an ENEMY debuff is INERT** (`statusEngine` gates the timed enemy write
  on a NUMERIC duration). Every fixture in this work must use a numeric duration, and must prove the
  debuff LANDED before asserting on its effect. This trap already produced one vacuous 12-shape
  sweep during #358 — see #390.
- **No double-count.** The enemy's own outgoing debuffs already fold. Adding the defender-applied
  source must not double-apply a debuff that is already counted, and must not double-count when both
  sides carry one.
- **Direction test, mandatory.** More suppression ⇒ strictly less damage thrown. A magnitude-only
  assertion passes with the sign inverted.
- **Delete, do not loosen, the pin.** `defenseSurvivabilitySim.test.ts` currently pins the CURRENT
  (defective) behaviour with an explicit "delete me if the ruling flips" note. The ruling has
  flipped. The same claim is documented at three sites (that test, the sim's module jsdoc, and the
  in-app docs / changelog) — all four must move together.
- **Golden re-bless is delete-and-rerun, NEVER `vitest -u`.** Unlike #358's engine fixes, this one
  probably DOES move golden numbers: the DPS/sim suites contain real kits, and any fixture where a
  player debuffs an enemy attacker will shift. Every moved number must be audited and explained.

## 4. What "correct" means

A debuff reducing an actor's outgoing damage must fold into that actor's outgoing damage **regardless
of who applied it**. The existing self-sourced path is the reference: find where the attacker's own
`Attack Down` / `Out. Damage Down` enters the outgoing fold, and make the opposing-side store feed
the same term — mirroring how #358 fixed the *defence* channel by adding a self-sourced term to a
channel that carried only enemy-sourced entries. This is the same shape, in the opposite direction.

---

## 5. ADDENDUM (owner ruling, 2026-08-25): HIGHEST TIER WINS across the self/enemy boundary

**Question:** an enemy carries a self-inflicted `Attack Down I` (−15%) and your Curator lands
`Attack Down III` (−45%) on it. −15%, −45% or −60%?

**Ruling: −45%. The strongest single instance of a named family applies; weaker instances are
shadowed, regardless of which side applied them.**

This extends the rule that already governs a family *within* one store, rather than inventing a
second rule for the cross-store case. Tier-shadowing today is per-store and **cannot** shadow across
the self/enemy boundary without a deliberate change — so this is real work, not a switch.

### 5.1 What this rules out

**Additive combination is WRONG.** It is what the code would do if the dead channel were simply
switched on, and it makes two instances of one named debuff worth more than one — which contradicts
the family's own behaviour inside a single store. It also makes **−100% reachable**, at which point
the attacker throws literally zero. (Overshoot is safe in itself: −150% clamps to 0 with no sign
inversion. Reaching zero *by accident* is the objection.)

### 5.2 Scope of the shadowing — do not over-apply it

Shadowing is **per named family**. Two DIFFERENT families both apply:
`Attack Down` and `Out. Damage Down` are separate debuffs and combine as they always have. Only
same-family instances shadow. A fix that collapses across families is a new defect.

### 5.3 Required tests

- **Cross-store shadowing:** self `Attack Down I` + applied `Attack Down III` ⇒ exactly the III
  value, not the sum, and not the I value. Assert all three candidate figures are distinguishable in
  the fixture, or the arm cannot tell shadowing from either alternative.
- **Cross-family additivity survives:** applied `Attack Down` + applied `Out. Damage Down` still
  combine. This is the guard against over-collapsing.
- **The reverse direction:** self tier HIGHER than applied tier ⇒ the self tier wins. Otherwise
  "highest wins" is untested in the direction where the player's debuff is the weaker one.

---

## 6. CORRECTION (2026-08-25): §5 stated a GENERAL rule as if it were a narrow one

The owner's clarification: **highest tier wins for ALL buffs and debuffs. The only exceptions are
DoTs (`Corrosion`, `Inferno`) and bombs, which stack.** This is a long-standing rule, not a new
ruling created by this issue.

§5 and §5.2 above are therefore **correctly implemented but wrongly framed**. They present
highest-tier-wins as a decision about `attack` / `outgoingDamage`, and §5.2's "shadowing is per named
family" as a scope limit invented here. In fact:

- **Per-family shadowing is the general rule**, not a carve-out for this fix.
- **Nothing about it is specific to the outgoing channels.** This fix is one channel pair catching up
  with a rule that already governs everything.
- **DoTs and bombs are the exception set** and must keep stacking. Do not apply shadowing to them.

### 6.1 What this means for the shipped fix

The fix itself stands: the three §5.3 arms test exactly the right behaviour, and the implementation
(cross-store shadowing via the shared `deriveFamilyKey`) is the correct mechanism. Nothing needs
reverting.

### 6.2 The real gap this exposes

**Cross-store shadowing applies NOWHERE ELSE.** Within a single store, family tier-shadowing is
already general. Across the self/enemy boundary it applied nowhere at all until this fix, and now
applies only to `attack` / `outgoingDamage`. Every other channel where both stores can carry the same
family is still **additive**, which the rule says is wrong.

The known instance: **#367's heal channels combine additively across the boundary**, justified in
their jsdoc because "only one `Inc. Repair Down` can stand today". Under the real rule that
justification is beside the point — additive is the wrong arithmetic there regardless of whether the
corpus currently reaches it.

Tracked as its own issue. It is an audit ("which channels can carry the same family from both
stores?") plus a mechanical application of the existing `deriveFamilyKey` shadowing, with DoTs and
bombs excluded.

**Recorded in durable memory as a locked game rule** so it is not re-derived narrowly a third time.
