# Owner questions surfaced by the comment sweep

These are NOT comment problems. Each is a place where a false comment pointed at something that
may be a real defect. The sweep does not fix code, so each one is recorded here for a ruling.

---

## 1. Generic DoT damage is computed and credited, but never surfaced

**Status: RULED 2026-09-02 — "damage to dot could be folded into normal damage totals."**
**Not done in this PR (see below). Needs its own change.**

`engine.ts` carried the comment "`rawTotals.generic` … **Always 0 today**". That is false:

- `convertHitToSelfDot` (`engine.ts:1997`) is a live producer, called at `engine.ts:6198` and
  `engine.ts:6291`.
- It is reached from the `transform-incoming-to-dot` ability type, which the parser itself emits
  (Voron / Orel), plus the name-keyed `Hit Mitigation` one-shot (Oleander).
- Ticks credit `focus.generic`, which accumulates into `totalGenericRaw` (`engine.ts:12814`) and
  is returned as the result's `generic` field (`engine.ts:13367`).

The comment's *other* half — "not consumed by `DPSSimulationSummary`" — **is true**, and that is
the part worth your attention:

```
$ grep -rn 'totalGenericRaw' src
engine.ts:2747    let totalGenericRaw = 0;
engine.ts:12814   totalGenericRaw += genericDamage;
engine.ts:13367   generic: totalGenericRaw,

$ grep -rln 'totalGenericRaw' src/components src/pages
(no component or page reads it)
```

So a player running Voron, Orel, or Oleander in DPS mode has generic-DoT damage computed,
credited, and returned — and then not shown anywhere.

**OWNER RULING:** fold it into the normal damage totals. Not a separate row — the generic-DoT
ticks count as damage like any other.

**Why this PR does not do it.** The whole sweep's verification rests on one invariant — the token
oracle proving ZERO code bytes changed across all 21 files. Folding `totalGenericRaw` into a
damage total is a behaviour change that moves player-visible DPS numbers and would almost
certainly move golden fixtures. Landing it here would destroy the invariant that makes the comment
diff reviewable, and would hide a real behaviour change inside a docs-only PR.

**Follow-up work, scoped:**
- `totalGenericRaw` (`engine.ts:2747` / `:12814` / `:13367`) folds into the normal damage total
  rather than being returned as an unread `generic` field.
- Ships affected: Voron and Orel (`transform-incoming-to-dot`), Oleander (`Hit Mitigation`).
- Golden fixtures WILL move for any fixture running those kits — that is the expected signal, not
  a regression. Confirm each moved token is the generic tick before updating.
- User-facing, so it needs a `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts`.

The comment in this PR now states what is actually true (a live producer exists) instead of
fencing the case off as "always 0 today".

---

## 2. Healing seam: "target HP can only reach 0 via enemy attacks"

**Status: comment corrected in this PR; no code change. Recording it because the fenced-off case
is real.**

The claim is false in the same function: the `#362` reversed-repair branch damages the heal
target through an **ally's** repair, so the target's HP can reach 0 without an enemy attack.

No defect is implied — the branch exists and is handled. But any future reasoning that leans on
"only enemy attacks can zero the heal target" is unsound, which is why the comment could not be
left standing.

---

## 3. A false premise about `attacked.damage`, repeated as the justification for a live cap

**Status: RESOLVED 2026-09-02 by owner ruling. No code defect. `triggers.ts` comment CORRECTED in
this PR; the twin in `buildEquipmentAbilities.ts` is a follow-up (out of scope).**

**OWNER RULING:** "Bloodthirst (on unit damage enemy) has a chance of triggering per sub-attack.
Damage-taken reactives, like Second Wind, have a chance of triggering per incoming hit."

So per-sub-attack / per-incoming-hit IS the intended granularity. There is no over-fire to cap,
and the cap on Adaptive Plating stands purely on its own game text. This is consistent with the
full-walk model of multi-hit (each sub-attack is itself a full attack), under which "outgoing per
attack" and "outgoing per sub-attack" describe the same thing.

`triggers.ts:172-174` says:

> `attacked.damage` is the per-attack aggregate and `on-attacked` fires once per hit, so a
> non-`oncePerRound` damage-taken reactive would grant N times for an N-hit attack.

Two primary sources contradict the premise:

- `events.ts:819` — "Direct damage this **SUB-ATTACK** dealt to this victim — **NOT the per-TURN
  aggregate**. … Tenacity's >25%-max-HP filter reads this, and it needs ONE hit's damage rather
  than the cast's."
- `emitAttacked.ts` — on the positional path this is "that sub-attack's slice, not the victim's
  cast-wide aggregate."

On the positional path — every real run — there is one `attacked` per (sub-attack, victim)
carrying its own slice, so the described over-fire cannot arise there.

**Why this is not a defect.** Adaptive Plating's cap is right for a different reason than the
comment gives: its in-game text says "limited to once per round", and a once-per-round cap is
correct exactly when the text says so. The cap stands; the stated reasoning for it does not.

**What is worth your eye.** The identical false premise is the written justification at
`buildEquipmentAbilities.ts:836-838`, which is OUTSIDE this sweep's 21-file scope and so was not
touched:

> oncePerRound caps the grant to ONE per round — the `attacked` event's damage is the per-attack
> aggregate and on-attacked fires once per hit, so without the gate an N-hit attack would grant
> N times.

And `triggers.ts`'s own heal/shield SCOPE NOTE says the opposite about the same implant —
"Adaptive Plating's shield off each hit's damage taken … every hit legitimately contributes its
own share."

**Follow-up (outside this PR's file scope):** `buildEquipmentAbilities.ts:836-838` still carries
the identical false premise as Adaptive Plating's written justification. Correct it to say the cap
comes from the implant's own text, not from an imagined N-times over-fire.
