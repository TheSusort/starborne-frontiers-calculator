# Enemy On-Cast Self-Shields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make enemy on-cast shield abilities grant real shield pools (symmetric to E5's enemy heal lift), so enemy ships absorb player damage, trigger their shield-hit counters (enemy Nyxen), and fire on-shield-applied reactives (Resonating Fury).

**Architecture:** Replace the single `if (healEventOnly) continue;` short-circuit in the shield branch of the cast-skill consumption loop (`playerTurn.ts`) with an event-only shield sub-branch structured exactly like the existing E5 enemy-heal sub-branch: grant the pool to each enemy recipient via the already-side-agnostic `grantShieldToTarget`, suppress player-bucket credit, and emit `shield-applied`. All downstream machinery (grant cap, recipient routing, absorb, `shieldWasHit`, reactive routing) is already team-agnostic; this is the one blocked seam.

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-27-enemy-oncast-self-shields-design.md`

**Branch:** `feat/combat-enemy-oncast-self-shields` (already created, stacked on PR #165 tip `45caf266`). Retarget to `main` after #165 merges.

---

## Background the implementer must know

- **Cast-skill consumption loop** lives in `src/utils/combat/playerTurn.ts`. Enemy casts run in **event-only mode** (`healEventOnly === true`). The heal branch (~line 1869) has an `if (healEventOnly) { ... continue; }` sub-branch (E5) that restores each enemy recipient's OWN HP while crediting NO player bucket. **This is the exact template.** The shield branch (~line 1930) instead bails: `if (healEventOnly) continue;` — the bug.
- **Shared healing closures** (built in `engine.ts` ~line 2077, type `HealingRuntimeCtx`):
  - `recipientsFor(target)` (playerTurn.ts ~1709) already routes enemy recipients: `self → [actor.id]`, `all-allies → enemyIds`, `ally → lowestHpEnemyAllyId()`.
  - `basisValue(cfg.basis, rid)` resolves per recipient (used by the E5 heal branch for enemy ids).
  - `healing.recipientActor(id)` = `allActorsById.get(id)` — side-agnostic.
  - `healing.grantShieldToTarget(raw, victim)` (engine.ts ~2110) caps at `recipientMaxHp(victim.id)`, records `perActorShieldGranted`, returns the REAL pool growth (0 for dead/capped).
- **Existing player shield branch** (playerTurn.ts ~1930–1973) is the structural model for the grant loop + the `shield-applied` emit (one event per cast, only recipients with `granted > 0`).
- **`runCombat`** accepts an optional `bus?: CombatEventBus` (engine.ts:958) that mirrors all emits — used in tests to capture `shield-applied` / `buff-applied`. It also accepts `__testTapActors?: (actors: CombatActor[]) => void` to read live `shieldPool`. See `shieldAppliedEvent.test.ts` for both.
- **Positional two-team harness:** `enemySideAttacked.integration.test.ts` builds player/enemy positional actors via the real registry (`buildShipAbilities`). Reuse its helpers' shapes (`parsedTarget`, `basePattern`, `basicAttack`, `reactiveEnemyAt`, `playerAttacksEnemy`, `nyxenShip`, `totalPerTargetDamage`).
- **PR #165** already wired the player→enemy `attacked` emit + positional `shieldWasHit`, and reactive routing is team-agnostic (`enemyReactiveRouting.test.ts`). So once an enemy has a pool, `shieldWasHit` flows and the enemy Nyxen counter fires with NO further changes.

---

## File Structure

- **Create:** `src/utils/combat/__tests__/enemyOnCastShield.integration.test.ts` — the feature's behavioral tests (pool grant + `shield-applied` emit + Nyxen counter end-to-end + on-shield-applied downstream).
- **Modify:** `src/utils/combat/playerTurn.ts` (~line 1930–1933) — replace the `continue` with the event-only shield sub-branch. (~20 lines.)
- **Modify:** `src/utils/combat/__tests__/enemySideAttacked.integration.test.ts` (~line 297–347) — the enemy-Nyxen test's engine-note comment is now stale (it asserts the engine does NOT model enemy on-cast shields). Update the comment; the test's mechanics (injected reactive shield) still pass and stay.
- **Modify:** `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.
- **Modify (if applicable):** `src/pages/DocumentationPage.tsx` — only if it enumerates enemy-side combat modeling.

---

### Task 1: Failing integration test — enemy on-cast self-shields

**Files:**
- Create: `src/utils/combat/__tests__/enemyOnCastShield.integration.test.ts`

- [ ] **Step 1: Write the failing test file**

Mirror the helpers/shapes in `enemySideAttacked.integration.test.ts` and the bus/tap capture in `shieldAppliedEvent.test.ts`. Full file:

```ts
/**
 * enemyOnCastShield.integration.test.ts — enemy on-cast self-shields (positional two-team sim).
 *
 * Symmetric counterpart to E5's enemy HEAL lift: an enemy ship's on-cast SHIELD ability now grants
 * a real shieldPool (capped at the recipient's own max HP), absorbs player damage, and emits
 * shield-applied — previously the shield branch bailed for enemy casters (healEventOnly continue).
 *
 * Proves: (1) enemy gains a pool + emits ONE shield-applied keyed on the enemy granter; (2) the
 * pool absorbs player damage AND chains to the enemy Nyxen shield-hit counter end-to-end (real
 * registry); (3) the enemy shield-applied drives a downstream on-shield-applied reactive
 * (Resonating-Fury-style buff → buff-applied keyed on the enemy).
 *
 * PRE-FIX every positive case here fails: no enemy pool is granted, no shield-applied is emitted,
 * so nothing absorbs, no counter gates true, and no on-shield-applied reactive wakes.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { CombatActor } from '../state';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Verbatim CSV-derived Nyxen text (docs/ship-skills.csv): active grants a 15%-Max-HP self-shield;
// first passive parses to an on-attacked counter with requireShieldHit:true.
const NYXEN_ACTIVE =
    'This Unit <unit-aid>Cleanses 2 bombs</unit-aid>, Grants a <unit-damage>Shield equal to 15%</unit-damage> of its Max HP, and Grants <unit-skill>Atlas Readiness II</unit-skill> for 1 turn.';
const NYXEN_P1 =
    'This Unit deals <unit-damage>100% damage</unit-damage> when its Shield is directly damaged.';

function nyxenShip(withActiveShield = true): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        ...(withActiveShield ? { activeSkillText: NYXEN_ACTIVE } : {}),
        firstPassiveSkillText: NYXEN_P1,
    } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'eocs-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

// A POSITIONED enemy carrying the given parsed shipSkills (its active is what it casts each turn).
const enemyAt = (
    id: string,
    position: Position,
    shipSkills: ShipSkills,
    attack: number,
    hp: number,
    speed: number
): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills,
    }) as EnemyAttacker;

// Player FOCUS at M4 fires `front` (anchors the enemy) with a 100% damage active, acts FIRST
// (speed 200), immortal so enemy counters never kill it (counters read via perTargetDamage).
const playerAttacksEnemy = (
    enemies: EnemyAttacker[],
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    speed: 200,
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: enemies,
    ...overrides,
});

const totalPerTargetDamage = (result: ReturnType<typeof runCombat>, actorId: string): number => {
    let sum = 0;
    for (const rd of result.rounds) sum += rd.perTargetDamage?.[actorId] ?? 0;
    return sum;
};

// An enemy whose ACTIVE grants a self-shield (no damage); plus an optional extra passive ability.
const selfShieldActiveSkills = (pct: number, extraPassive?: Ability): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'enemy-oncast-shield',
                    type: 'shield',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'shield', pct, basis: 'hp' },
                },
            ],
        },
        ...(extraPassive ? [{ slot: 'passive' as const, abilities: [extraPassive] }] : []),
    ],
});

describe('enemy on-cast self-shield: pool grant + shield-applied emission', () => {
    it('an enemy self-shield active grants a pool and emits ONE shield-applied keyed on the enemy', () => {
        const bus = createEventBus();
        const events: Extract<CombatEvent, { type: 'shield-applied' }>[] = [];
        bus.on('shield-applied', (e) => {
            if (e.type === 'shield-applied') events.push(e);
        });
        let captured: CombatActor[] = [];
        runCombat(
            playerAttacksEnemy(
                // enemy hp 40_000 → 50% self-shield = 20_000; player 10_000 only dents it.
                [enemyAt('foe', 'M4', selfShieldActiveSkills(50), 1_000, 40_000, 50)],
                {
                    bus,
                    __testTapActors: (actors) => {
                        captured = actors;
                    },
                }
            )
        );
        const foe = captured.find((a) => a.id === 'foe');
        expect(foe?.shieldPool ?? 0).toBeGreaterThan(0); // enemy gained a real pool
        const enemyEvents = events.filter((e) => e.granterId === 'foe');
        expect(enemyEvents.length).toBeGreaterThan(0);
        expect(enemyEvents[0].recipientIds).toEqual(['foe']); // self-shield → self recipient
        expect(enemyEvents[0].amount).toBeGreaterThan(0);
    });

    it('NEGATIVE control: a 0% enemy shield grants nothing and emits no shield-applied', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('shield-applied', (e) => events.push(e));
        let captured: CombatActor[] = [];
        runCombat(
            playerAttacksEnemy([enemyAt('foe', 'M4', selfShieldActiveSkills(0), 1_000, 40_000, 50)], {
                bus,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );
        const foe = captured.find((a) => a.id === 'foe');
        expect(foe?.shieldPool ?? 0).toBe(0);
        expect(events.filter((e) => e.type === 'shield-applied' && e.granterId === 'foe')).toHaveLength(0);
    });
});

describe('enemy on-cast self-shield: chains to the enemy Nyxen shield-hit counter', () => {
    it('enemy NYXEN gains its REAL active 15%-Max-HP shield and counters when the player dents it', () => {
        // Real registry → active self-shield + passive shield-hit counter. The player (speed 200)
        // hits FIRST each round; the enemy (speed 50) casts its shield on its turn. So round 1 the
        // player hits an UNSHIELDED enemy (no counter); from round 2 the player dents the LIVE shield
        // → player→enemy attacked emit carries shieldWasHit:true → Nyxen counters (enemy attack × 100%).
        const nyxen = buildShipAbilities(nyxenShip(/* withActiveShield */ true));
        const result = runCombat(
            playerAttacksEnemy([enemyAt('foe', 'M4', nyxen, 9_000, 40_000, 50)])
        );
        const counterRounds = result.rounds
            .map((rd) => rd.perTargetDamage?.['attacker'] ?? 0)
            .filter((d) => d > 0);
        expect(counterRounds.length).toBeGreaterThan(0);
        for (const dealt of counterRounds) expect(dealt).toBeCloseTo(9_000, 6);
        // Round 1: enemy has not cast its shield yet → no shield dent → no counter.
        expect(result.rounds[0].perTargetDamage?.['attacker'] ?? 0).toBe(0);
    });

    it('NEGATIVE control: enemy Nyxen WITHOUT its active shield never counters (no pool exists)', () => {
        const nyxenNoShield = buildShipAbilities(nyxenShip(/* withActiveShield */ false));
        const result = runCombat(
            playerAttacksEnemy([enemyAt('foe', 'M4', nyxenNoShield, 9_000, 40_000, 50)])
        );
        expect(totalPerTargetDamage(result, 'attacker')).toBe(0);
    });
});

describe('enemy on-cast self-shield: drives a downstream on-shield-applied reactive', () => {
    it('enemy self-shield active wakes an on-shield-applied reactive buff (buff-applied keyed on the enemy)', () => {
        // Resonating-Fury-style: an on-shield-applied reactive buff owned by the enemy. The enemy's
        // own on-cast shield emits shield-applied → the team-agnostic listener enqueues the buff →
        // buff-applied fires keyed on the enemy. (Buff target 'self' to keep recipient routing trivial.)
        const resonatingFury: Ability = {
            id: 'enemy-resonating-fury',
            type: 'buff',
            target: 'self',
            trigger: 'on-shield-applied',
            conditions: [],
            config: { type: 'buff', buffName: 'Crit Power Up', stacks: 3, duration: 1, parsedEffects: {} },
        } as unknown as Ability;
        const bus = createEventBus();
        const buffEvents: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        bus.on('buff-applied', (e) => {
            if (e.type === 'buff-applied') buffEvents.push(e);
        });
        runCombat(
            playerAttacksEnemy(
                [enemyAt('foe', 'M4', selfShieldActiveSkills(50, resonatingFury), 1_000, 40_000, 50)],
                { bus }
            )
        );
        // buff-applied carries the carrier id on `actorId` (events.ts ~line 61) — NOT `targetId`.
        // Mirrors the sibling harness (enemySideAttacked.integration.test.ts ~472: e.actorId === 'foe').
        expect(buffEvents.some((e) => e.actorId === 'foe' && e.buffName === 'Crit Power Up')).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test — verify it FAILS (pre-fix)**

Run: `npx vitest --run src/utils/combat/__tests__/enemyOnCastShield.integration.test.ts`
Expected: the two positive `shield-applied`/pool cases FAIL (no pool, no event), the Nyxen-counter positive case FAILS (no counter), the on-shield-applied case FAILS (no buff). The two NEGATIVE controls PASS even pre-fix (good — they assert absence). This confirms the test bites.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/utils/combat/__tests__/enemyOnCastShield.integration.test.ts
git commit -m "test(combat): failing enemy on-cast self-shield integration test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(If the husky pre-commit hook runs the full suite and fails on these intentionally-red tests, commit with `--no-verify` — this is a deliberately-failing TDD checkpoint.)

---

### Task 2: Lift the shield branch (make the test pass)

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (~line 1930–1933)

- [ ] **Step 1: Replace the `continue` with the event-only shield sub-branch**

Find (playerTurn.ts ~1930):
```ts
            } else if (cfg.type === 'shield') {
                // Event-only: shields are not repairs → no heal-performed recipient, no numeric.
                // Skip entirely (no credit/grant).
                if (healEventOnly) continue;
```

Replace with:
```ts
            } else if (cfg.type === 'shield') {
                if (healEventOnly) {
                    // Enemy shields grant a real pool to each enemy recipient and emit
                    // shield-applied, but credit NO player bucket — the symmetric counterpart to
                    // the E5 enemy-heal lift above. Routing/cap/absorb are already side-agnostic
                    // (recipientsFor, grantShieldToTarget caps at recipientMaxHp, the absorb path).
                    // No crit / no modifiers (shields aren't repairs), matching the player branch.
                    const recipients = recipientsFor(ability.target);
                    const shieldRecipientIds: string[] = [];
                    let shieldGrantedSum = 0;
                    for (const rid of recipients) {
                        const raw = basisValue(cfg.basis, rid) * (cfg.pct / 100);
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
```

(The existing player shield branch — the lines after the old `if (healEventOnly) continue;` — stays unchanged below this new block.)

- [ ] **Step 2: Run the new test — verify it PASSES**

Run: `npx vitest --run src/utils/combat/__tests__/enemyOnCastShield.integration.test.ts`
Expected: ALL cases PASS (both positive shield/pool cases, the Nyxen counter, the on-shield-applied buff, and both negative controls).

- [ ] **Step 3: Golden audit — run the full combat suite**

Run: `npx vitest --run src/utils/combat`
Expected: all green, and crucially **ZERO `.snap` golden movement** (`perHitCrit` / `dpsGoldenParity` / `healingGoldenParity`). If a `.snap` moved, STOP — a fixture's enemy gained a shield; investigate whether that's a correct behavior change before doing anything. **Never run `vitest -u`.** If an assertion-based test (not `.snap`) changed because it equips an enemy shield-caster, evaluate it explicitly and report.

- [ ] **Step 4: Type-check, lint, skills audit**

Run: `npx tsc --noEmit && npm run lint && npm run audit:skills`
Expected: tsc clean, lint 0 warnings, `audit:skills` 141/0 (unchanged).

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: green (the main repo has `.env`; if ~14 `.tsx` files fail to *collect* with "supabaseUrl is required", that's the known env gap, not this change — confirm 0 *failed tests*).

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/playerTurn.ts
git commit -m "feat(combat): lift enemy on-cast self-shields (symmetric to E5 heal lift)

Enemy shield casts now grant a real pool to each recipient and emit
shield-applied, crediting no player bucket. Enemy ships absorb player
damage, fire shield-hit counters (Nyxen), and wake on-shield-applied
reactives (Resonating Fury). Downstream machinery was already
side-agnostic; this replaces the lone healEventOnly continue.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Stale-comment fixes, changelog, docs

**Files:**
- Modify: `src/utils/combat/__tests__/enemySideAttacked.integration.test.ts` (~line 297–306)
- Modify: `src/utils/combat/playerTurn.ts` (the `shield-applied` emit comment ~line 1962–1964 of the OLD numbering — now in the player branch)
- Modify: `src/constants/changelog.ts`
- Modify (conditional): `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Update the stale engine-note in `enemySideAttacked.integration.test.ts`**

The enemy-NYXEN test's comment block (the `it('enemy NYXEN (shield-hit counter) counters ONLY when the player dents its live shield', ...)` body) asserts: "the engine does NOT model enemy self-shields from on-CAST shield abilities (playerTurn.ts:1962-1964: enemy event-only shields `continue` before granting a pool)". That is now FALSE. Reword to note that the on-cast path now DOES grant enemy pools (see `enemyOnCastShield.integration.test.ts`), and this test deliberately keeps the *injected reactive* shield variant to isolate the reactive-shield path. Do NOT change the test's assertions or mechanics — comment only.

- [ ] **Step 2: Update the stale comment in `playerTurn.ts`**

The player shield branch retains an H3.6 comment saying "enemy event-only shields `continue` above (healEventOnly) before reaching here, so they never emit — consistent with the engine not modeling enemy-side shield pools." Reword: enemy event-only shields now emit their OWN `shield-applied` from the lifted sub-branch above; this player-path emit is the non-event-only path.

- [ ] **Step 3: Add a changelog entry**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES` (plain English, follow the existing entry style):
> Enemy ships now benefit from their on-cast shield skills in the battle simulator — they gain shields, absorb your damage, and trigger shield-reactive abilities (e.g. shield-hit counters). Previously these effects only worked on your own ships.

- [ ] **Step 4: Check `DocumentationPage.tsx`**

Grep for any combat/simulator section enumerating enemy-side modeling: `grep -n "enemy" src/pages/DocumentationPage.tsx`. If a list of "what the enemy side models" exists, add enemy on-cast shields. If no such enumeration exists, skip (note "no doc change needed" in the commit).

- [ ] **Step 5: Verify nothing broke**

Run: `npx vitest --run src/utils/combat/__tests__/enemySideAttacked.integration.test.ts src/utils/combat/__tests__/enemyOnCastShield.integration.test.ts`
Expected: both green (comment edits don't affect behavior).

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/__tests__/enemySideAttacked.integration.test.ts src/utils/combat/playerTurn.ts src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): refresh stale enemy-shield comments + changelog for on-cast lift

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(`changelog.ts`/`DocumentationPage.tsx` are tracked source — no `-f` needed; the spec/plan docs under `docs/` are the only force-add path.)

---

## Verification before completion

- [ ] `enemyOnCastShield.integration.test.ts` all green; reverting the playerTurn.ts branch makes exactly the positive cases fail (negative controls stay green).
- [ ] ZERO `.snap` golden movement.
- [ ] `npx tsc --noEmit`, `npm run lint` (0 warnings), `npm run audit:skills` (141/0), `npm test` (0 failed tests) all clean.
- [ ] Stale comments in `enemySideAttacked.integration.test.ts` and `playerTurn.ts` updated.
- [ ] `UNRELEASED_CHANGES` entry added.

## Non-goals (do NOT build)

- Enemy-side reactive `damage-taken` shields (the `isHookOwned` path) — out of scope.
- Enemy shield StatCard / UI surfacing — out of scope.
- No new ability types, config fields, events, executor, or listener changes. The `shield-applied` event shape is unchanged.
