# Enemy on-cast self-shields — design spec

**Date:** 2026-06-27
**Sub-project:** combat-realism epic, enemy-side symmetry (follow-up surfaced by enemy-side `attacked` emission, PR #165)
**Status:** design approved, pre-plan

## Problem

On-cast shield abilities are inert for enemy casters. The cast-skill consumption loop in
`src/utils/combat/playerTurn.ts` runs enemy casts in **event-only mode** (`healEventOnly === true`).
The shield branch short-circuits that mode:

```js
} else if (cfg.type === 'shield') {
    if (healEventOnly) continue;   // enemy shields grant nothing
    ...player grant + credit + emit...
}
```

So an enemy ship whose active/charge skill grants a shield (self / ally / all-allies) never gains a
`shieldPool`. Concrete consequences:

- **Enemy Nyxen's shield-hit counter cannot fire** — its counter gates on `shieldWasHit`, but the
  enemy never has a shield to be hit. PR #165 already wired the positional `shieldWasHit` signal and
  the enemy `attacked` emit player→enemy; the missing piece is the shield pool itself.
- **Enemy on-shield-applied reactives (Resonating Fury) are inert** — no `shield-applied` event is
  emitted for enemy casts.
- **Enemy shields never absorb player damage.**

This is a team-asymmetry: the same ship behaves differently on the enemy side than on the player
side. The guiding engine principle is symmetry — a ship must act identically whatever team it is on.

## Background: E5 is the template

E5 (symmetric healing) fixed the analogous asymmetry for **heals**. The enemy heal path was lifted so
that, in event-only mode, an enemy heal restores each recipient's OWN `currentHp` via the per-victim
pool and emits `heal-performed`, while crediting NO player healing bucket. See the
`if (healEventOnly) { ... continue; }` block in the heal branch of `playerTurn.ts` (~line 1873).

The shield branch is the one place that lift did not reach. This spec applies the identical pattern
to shields.

## Why this is contained: downstream is already side-agnostic

All machinery below the shield grant already works for any actor regardless of side:

- **`grantShieldToTarget(raw, victim)`** (`engine.ts` ~2110) caps at `recipientMaxHp(victim.id)` —
  the recipient's OWN effective max HP, not a player-fixed cap — records `perActorShieldGranted`, and
  returns the real pool growth. Dead recipient → returns 0.
- **`recipientsFor(target)`** (`playerTurn.ts` ~1709) already routes enemy recipients:
  `self → [actor.id]`, `all-allies → enemyIds`, single `ally → lowestHpEnemyAllyId()`.
- **`basisValue(cfg.basis, rid)`** resolves per recipient for enemy ids (used by the E5 heal lift).
- **Shield absorb** (`engine.ts` ~2882, `shieldAbsorb` + `victim.shieldPool -= absorbed`) drains any
  victim's pool — already side-agnostic.
- **`shieldWasHit`** is emitted on the enemy `attacked` event on the positional path (PR #165).
- **Reactive routing** (`registerReactiveListeners`) is team-agnostic (locked by
  `enemyReactiveRouting.test.ts`), so an enemy `shield-applied` lights up enemy on-shield-applied
  reactives with no executor changes.

The only blocker is the `continue`.

## Design (Approach A — symmetric shield lift)

Replace `if (healEventOnly) continue;` in the shield branch with an event-only sub-branch structured
exactly like the E5 heal sub-branch:

```js
} else if (cfg.type === 'shield') {
    if (healEventOnly) {
        // Enemy shields grant a real pool to each enemy recipient and emit
        // shield-applied, but credit NO player bucket (mirrors the E5 heal lift).
        const recipients = recipientsFor(ability.target);
        const shieldRecipientIds: string[] = [];
        let shieldGrantedSum = 0;
        for (const rid of recipients) {
            const raw = basisValue(cfg.basis, rid) * (cfg.pct / 100);
            // NO healing.credit — player shield bucket stays untouched.
            const recipientActor = healing.recipientActor(rid);
            if (recipientActor) {
                const granted = healing.grantShieldToTarget(raw, recipientActor);
                if (granted > 0) {
                    shieldRecipientIds.push(rid);
                    shieldGrantedSum += granted;
                }
            }
        }
        if (shieldRecipientIds.length > 0) {
            bus.emit({
                type: 'shield-applied',
                granterId: actor.id,
                recipientIds: shieldRecipientIds,
                round: r,
                amount: shieldGrantedSum,
            });
        }
        continue;
    }
    ...existing player branch unchanged...
}
```

### Decisions baked in

- **Scope: all recipients** (self / ally / all-allies) — symmetric to E5, no special-casing.
  `recipientsFor` already does the side-correct routing.
- **No crit / no modifiers** — `raw = basisValue × (pct / 100)`, identical to the player shield
  branch. Shields are not repairs (documented engine assumption); this deliberately differs from the
  heal branch, which crits.
- **Credit suppressed** — no `healing.credit(actor.id, 'shield', raw)`. Player shield bucket stays
  untouched, mirroring how the E5 heal lift suppresses player-bucket credit on the enemy path.
- **`shield-applied` emitted** — keyed on the enemy caster (`granterId: actor.id`), listing only
  recipients whose pool actually grew (`granted > 0`). Symmetric to both the player shield path and
  the E5 enemy heal-performed emit. Drives enemy Resonating Fury / on-shield-applied reactives.

### Edge cases (handled by the shared closures, no extra code)

- Dead recipient → `grantShieldToTarget` returns 0 → excluded from `shieldRecipientIds` → no event.
- Max-HP cap → per-recipient via `recipientMaxHp(victim.id)`.
- No living recipient (`recipientsFor` → `[]`) → no grant, no event.
- Recipient with no resolvable runtime actor → skipped (same as the player branch / E5 heal lift).

## Behavior that lights up (no code beyond the branch)

1. Enemy ships gain real `shieldPool`s from on-cast shield skills.
2. Those pools absorb incoming player damage (existing side-agnostic absorb).
3. The enemy `attacked` event carries `shieldWasHit` (PR #165) → **enemy Nyxen's shield-hit counter
   fires**.
4. The `shield-applied` event fires for enemy casts → **enemy on-shield-applied reactives (Resonating
   Fury) fire** (team-agnostic routing).

## Non-goals (documented, not built)

- **Enemy-side reactive `damage-taken` shields** (the hook-owned path gated by `isHookOwned`) stay
  as-is. This spec covers the on-cast path only.
- **Enemy shield StatCard / UI surfacing** — not part of the sim-correctness lift.
- No new ability types, config fields, events, or executor/listener changes. The `shield-applied`
  event shape is unchanged.

## Testing

- **New integration test** (mirror `enemySideAttacked.integration.test.ts` /
  `onShieldAppliedReaction.test.ts`): real registry + positional harness, enemy caster with a
  self-shield active skill. Assert:
  1. enemy gains a `shieldPool` after its cast;
  2. `shield-applied` emitted with `granterId` = the enemy caster;
  3. a subsequent player hit is absorbed by the enemy pool (shield drains before HP);
  4. enemy Nyxen counters off the shield hit (shield-hit counter path, end-to-end);
  5. an enemy on-shield-applied reactive (Resonating Fury-style) fires.
  - Negative control: reverting the branch makes exactly these positive cases fail.
- **Golden audit:** run the full suite. Expectation: the 3 `.snap` goldens
  (`perHitCrit`/`dpsGoldenParity`/`healingGoldenParity`) are unmoved, because enemy fixtures are
  dummies without shield-cast skills. Any assertion-based test that *does* equip an enemy
  shield-caster and moves is a real behavior change to evaluate explicitly — never auto-update goldens
  (`vitest -u` is forbidden).
- `tsc`, `lint` (max-warnings 0), `audit:skills` (expect 141/0) all clean.

## Risks

- **Golden movement on assertion tests** that happen to use an enemy shield-caster. Mitigation: audit
  during implementation; this is correct behavior (symmetry), not a regression — evaluate, don't
  suppress.
- **Enemy shield-applied feedback loops** (a `shield-applied` triggers an enemy reactive that grants
  another shield). Pre-existing reactive guards (proc gates, once-per-round) bound this the same way
  they bound the player side; no new loop risk introduced by the emit.

## Changelog / docs

- Add a plain-English `UNRELEASED_CHANGES` entry: enemy ships now benefit from their on-cast shield
  skills (gain shields, absorb damage, trigger shield-reactive abilities) — previously player-only.
- Update `DocumentationPage.tsx` combat section if it enumerates enemy-side modeling.
