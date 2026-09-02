# Owner questions surfaced by the comment sweep

These are NOT comment problems. Each is a place where a false comment pointed at something that
may be a real defect. The sweep does not fix code, so each one is recorded here for a ruling.

---

## 1. Generic DoT damage is computed and credited, but never surfaced

**Status: needs a ruling. Verified by the orchestrator, not just reported.**

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

**The question:** should generic DoT damage appear in the DPS summary as its own row, be folded
into an existing total, or stay deliberately unsurfaced? A concrete in-fight example would settle
it: Voron transforms an incoming hit into a self-DoT, that DoT ticks for N over 3 rounds — should
those N appear in the player's damage breakdown?

Nothing in this PR changes the behaviour either way. The comment now states what is actually
true instead of fencing the case off as impossible.

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

**Status: comment left byte-for-byte in this PR. No code defect found. Recorded because the same
false premise appears in a second file that is OUT of this sweep's scope.**

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

**The question:** confirm that a damage-taken reactive with NO text-stated cap (e.g. Bloodthirst,
which carries `procChance` but no `oncePerRound`) is *meant* to fire per hit rather than per
attack. If yes — which is what the incoming-proc-granularity rule implies — then nothing needs
fixing and both comments simply need correcting, with the `buildEquipmentAbilities.ts` one as a
small follow-up outside this PR.
