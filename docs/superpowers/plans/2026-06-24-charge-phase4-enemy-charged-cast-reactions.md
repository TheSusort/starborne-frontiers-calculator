# Charge Phase 4 — Enemy-Charged-Cast Reactions + Block Buff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unit reacts when an *enemy* casts its charged skill — Curator purges (and inflicts Block Buff), FrontLine deals damage + gains a shield — and Block Buff becomes a real primitive that prevents the affected unit from receiving buffs.

**Architecture:** Add a new opposing-scoped reactive trigger `on-enemy-charged-cast` (mirror of `on-enemy-repaired`), reusing the existing `eventCtx.counterTargetId` reaction-target field so the purge/debuff executors already route to the casting enemy with zero target-wiring. Add a `blockBuffBuffs.ts` primitive mirroring `debuffImmunity.ts`, guarding the timed self-buff application seams. Extend the existing `oncePerRound` executor gate (currently debuff-only) to the damage + heal/shield branches for FrontLine. Parse both corpus ships and wire through `buildShipAbilities`.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`, parser in `src/utils/skillTextParser.ts`, ability orchestration in `src/utils/abilities/buildShipAbilities.ts`.

**Spec:** `docs/superpowers/specs/2026-06-24-charge-phase4-enemy-charged-cast-reactions-design.md`

**Branch:** `feat/combat-charge-phase4-enemy-charged-cast` (off `feat/combat-charge-phase2-3-self-charge` / PR #153). Retarget to `main` as the charge stack #151→#152→#153 merges.

---

## Workflow gotchas (read before starting)

- **Pre-commit hook runs the FULL suite** (`lint-staged` + `tsc --noEmit` + `npm test -- --run`, ~3000 tests). During a task, run the *targeted* test file with `npx vitest run <path>`; let the commit hook do full validation. Expect each commit to take a while.
- **Never** `vitest -u` to bless goldens blindly — inspect every diff (project rule).
- Git/PR ops: `gh auth switch --user TheSusort`. Dev server runs on `:3000`.
- Work in the worktree `.worktrees/charge-phase4-enemy-charged-cast`.
- Run `npm run audit:skills` after parser changes — it must stay at 0 non-allowlisted findings (Curator/FrontLine reaction clauses become parsed).

## Spec deviation (intentional, baked into this plan)

The spec named a new `eventCtx.chargedCasterId` field. **This plan instead reuses the existing `eventCtx.counterTargetId`** — the purge executor (`triggers.ts:1631 const targetId = ... ?? ctx.enemyId`) and debuff executor (`triggers.ts:1356 const counterTargetId = ... intent.eventCtx?.counterTargetId`) already route to it, so the casting enemy is targeted with **no executor changes**. Semantically `counterTargetId` is "the routed reaction target" — the charged caster is exactly that.

FrontLine's "Shield equal to 30% of the damage dealt" is modeled as **`basis:'attack', pct:24`** (= 30% × 80%), NOT `basis:'damage-dealt'`. Reason: the reactive shield executor reads `eventCtx.triggerDamage`, which on this trigger is the *enemy's* charged-cast damage, not FrontLine's own 80%. The reactive damage executor itself approximates FrontLine's dealt damage as `effectiveAttack × 0.80` (no enemy-defence mitigation, no crit — the established reactive-damage approximation, `triggers.ts:1578`). 30% of that = `effectiveAttack × 0.24`. Keeping shield and damage on the same un-mitigated basis is the faithful-to-the-sim choice. Document this in-code and in the parser.

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/types/abilities.ts` | Add `'on-enemy-charged-cast'` to `AbilityTrigger` + `LIVE_TRIGGERS` | Modify |
| `src/utils/combat/triggers.ts` | New listener case; Block-Buff guard in buff executor; `oncePerRound` gate in damage + heal/shield branches (extract shared helper) | Modify |
| `src/utils/combat/blockBuffBuffs.ts` | NEW primitive: `BLOCK_BUFF_BUFFS`, `isBlockBuff`, `recipientCarriesBlockBuff` | Create |
| `src/utils/combat/playerTurn.ts` | Block-Buff guard in firing-skill self/ally buff loop | Modify |
| `src/utils/skillTextParser.ts` | `parseEnemyChargedCastReaction` | Modify |
| `src/utils/abilities/buildShipAbilities.ts` | Emit the reaction abilities | Modify |
| `src/components/skills/AbilityCard.tsx` | `TRIGGER_OPTIONS` entry | Modify |
| `src/constants/changelog.ts` | `UNRELEASED_CHANGES` entries | Modify |
| `src/pages/DocumentationPage.tsx` | Combat-mechanics doc (if it enumerates charge/control) | Modify (conditional) |
| `src/utils/combat/__tests__/enemyChargedCast.integration.test.ts` | NEW engine goldens | Create |
| `src/utils/combat/__tests__/blockBuff.test.ts` | NEW primitive goldens | Create |
| `src/utils/__tests__/skillTextParser.test.ts` | Parser unit tests | Modify |

---

## Task 1: `on-enemy-charged-cast` trigger (types + listener)

**Files:**
- Modify: `src/types/abilities.ts` (AbilityTrigger union ~48-99; LIVE_TRIGGERS ~109-142)
- Modify: `src/utils/combat/triggers.ts` (listener switch — add case next to `on-charged-cast` ~281 and `on-enemy-repaired` ~513)
- Test: `src/utils/combat/__tests__/enemyChargedCast.integration.test.ts` (create — listener-level assertion first)

- [ ] **Step 1: Add the trigger to the type union + LIVE_TRIGGERS.**

In `src/types/abilities.ts`, add to the `AbilityTrigger` union (after `'on-charged-cast'`):
```typescript
    | 'on-charged-cast'
    | 'on-enemy-charged-cast' // Phase 4: opposing-scoped reaction to an ENEMY casting its
    // charged skill (Curator purge/Block-Buff, FrontLine damage+shield). Mirror of
    // on-charged-cast but gated isOpposing(actorId). Reuses eventCtx.counterTargetId to
    // route the reaction onto the casting enemy.
```
And add `'on-enemy-charged-cast',` to the `LIVE_TRIGGERS` Set (so `isReactiveAbility` recognises it — load-bearing).

- [ ] **Step 2: Write the failing listener test.**

Create `src/utils/combat/__tests__/enemyChargedCast.integration.test.ts`. Use a runCombat-style integration test (mirror `enemyChargeRemoval.integration.test.ts`). For the FIRST test, assert at the listener level via a small fixture: an enemy ship with a charged skill + a player Curator (purge-only refit). After the enemy fires its charged skill, the player's purge fires against THAT enemy. (If a pure-listener unit test is simpler, assert that registering a reactive ability with `trigger:'on-enemy-charged-cast'` and emitting a `skill-fired` event with `slot:'charged'` from an opposing actor enqueues an intent whose `eventCtx.counterTargetId === <caster id>`, and a `slot:'active'` or same-side cast does NOT.)

Run: `npx vitest run src/utils/combat/__tests__/enemyChargedCast.integration.test.ts`
Expected: FAIL (no listener case yet → nothing enqueued).

- [ ] **Step 3: Add the listener case** in `triggers.ts`, mirroring `on-enemy-repaired`:
```typescript
                case 'on-enemy-charged-cast':
                    bus.on('skill-fired', (e) => {
                        // Opposing-scoped mirror of on-charged-cast. Team-agnostic: player
                        // registration's isOpposing = enemy side; enemy registration's = player
                        // side. Capture the casting enemy as the reaction target via the existing
                        // counterTargetId field so the purge/debuff executors route onto THAT
                        // enemy (zero executor change). Self-effects (FrontLine shield) ignore it.
                        if (isOpposing(e.actorId) && e.slot === 'charged')
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, counterTargetId: e.actorId },
                            });
                    });
                    break;
```

- [ ] **Step 4: Run the test — expect PASS.**

Run: `npx vitest run src/utils/combat/__tests__/enemyChargedCast.integration.test.ts`

- [ ] **Step 5: Commit.**
```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts src/utils/combat/__tests__/enemyChargedCast.integration.test.ts
git commit -m "feat(combat): on-enemy-charged-cast opposing-scoped trigger (Phase 4)"
```

---

## Task 2: Block Buff primitive + firing-skill guard

**Files:**
- Create: `src/utils/combat/blockBuffBuffs.ts`
- Modify: `src/utils/combat/playerTurn.ts` (firing-skill self/ally buff loop ~1083-1104)
- Test: `src/utils/combat/__tests__/blockBuff.test.ts` (create)

- [ ] **Step 1: Write the failing primitive + guard test.**

Create `src/utils/combat/__tests__/blockBuff.test.ts`. Mirror `blockDebuff.test.ts`. Assert:
1. `isBlockBuff('Block Buff')` is true; `isBlockBuff('Attack Up II')` false.
2. `recipientCarriesBlockBuff(se, id)` is true when `id` has Block Buff inflicted on it (apply a timed enemy-side status `Block Buff` to a target via the statusEngine, then read), false otherwise.
3. Engine behavioral (gate-flip): a player actor that has Block Buff inflicted on it does NOT gain its own self-buff on its next turn (the buff-applied event for that buff is absent / the stat does not fold); the SAME setup without Block Buff DOES gain it. Use a runCombat fixture (mirror an existing self-buff golden) — verify both sides via a not-vacuous assertion (the un-blocked control proves the gate flips).

Run: `npx vitest run src/utils/combat/__tests__/blockBuff.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 2: Create the primitive module.**

`src/utils/combat/blockBuffBuffs.ts`:
```typescript
import type { StatusEngine } from './statusEngine';
// Call-time-safe cycle (same pattern as debuffImmunity.ts): triggers imports
// recipientCarriesBlockBuff from here for its reactive-buff guard and we import
// ownerDebuffNamesFor back. Both used only inside function bodies → no init-order hazard.
// eslint-disable-next-line import/no-cycle
import { ownerDebuffNamesFor } from './triggers';

/** Named statuses that make the carrier IMMUNE TO RECEIVING BUFFS. While a unit carries a
 *  Block Buff status, any NEW timed buff application targeting it is silently skipped (the
 *  buff does not land — no event, no log). Already-landed buffs, stat folding, and the
 *  carrier's own recurring auras are untouched. Inflicted as a debuff on the carrier (so it
 *  lives in the per-target debuff store — read via ownerDebuffNamesFor, NOT
 *  selfBuffNamesForOwners). Extend from game data as identified. */
export const BLOCK_BUFF_BUFFS: ReadonlySet<string> = new Set(['Block Buff']);
export const isBlockBuff = (name: string): boolean => BLOCK_BUFF_BUFFS.has(name);

/** True if `recipientId` currently carries a Block Buff status. Reads the inflicted-debuff
 *  store (statusEngine is unified across both teams and keyed by actor id, so this works
 *  symmetrically for a Block-Buffed player and a Block-Buffed enemy). */
export function recipientCarriesBlockBuff(
    statusEngine: StatusEngine,
    recipientId: string
): boolean {
    return ownerDebuffNamesFor(statusEngine, recipientId).some(isBlockBuff);
}
```

- [ ] **Step 3: Guard the firing-skill self/ally buff seam** in `playerTurn.ts` (~1095, inside `for (const rid of status.recipients ?? [actor.id])`):
```typescript
        for (const rid of status.recipients ?? [actor.id]) {
            // Block Buff: a recipient carrying it cannot receive new buffs. Covers self-buffs,
            // single-ally grants, and all-allies grants (each recipient guarded independently);
            // covers BOTH sides (enemies run this same path). Silent skip — no buff-applied emit.
            if (recipientCarriesBlockBuff(statusEngine, rid)) continue;
            statusEngine.applyTimedAbilityStatus(r, status, rid);
            bus.emit({ /* …unchanged buff-applied emit… */ });
        }
```
Add the import at the top of `playerTurn.ts`: `import { recipientCarriesBlockBuff } from './blockBuffBuffs';`

- [ ] **Step 4: Run the test — expect PASS.** Run: `npx vitest run src/utils/combat/__tests__/blockBuff.test.ts`

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/blockBuffBuffs.ts src/utils/combat/playerTurn.ts src/utils/combat/__tests__/blockBuff.test.ts
git commit -m "feat(combat): Block Buff primitive — blocks receiving buffs at firing-skill seam"
```

---

## Task 3: Block Buff guard at the reactive-buff executor

**Files:**
- Modify: `src/utils/combat/triggers.ts` (buff executor branch ~1214-1321: the `for (const rid of recipients)` primary loop AND the `additionalBuffs` co-grant loop)
- Test: extend `src/utils/combat/__tests__/blockBuff.test.ts`

- [ ] **Step 1: Write the failing test** — a reactive buff grant (e.g. an all-allies buff reaction) targeting a Block-Buffed recipient does NOT land on that recipient, but DOES land on a non-Block-Buffed ally in the same grant. Add to `blockBuff.test.ts`.

Run: `npx vitest run src/utils/combat/__tests__/blockBuff.test.ts` → Expected: FAIL.

- [ ] **Step 2: Guard both loops** in the `cfg.type === 'buff'` branch:
```typescript
        for (const rid of recipients) {
            if (recipientCarriesBlockBuff(ctx.statusEngine, rid)) continue; // Block Buff: silent skip
            ctx.statusEngine.applyTimedAbilityStatus(ctx.round, status, rid);
            ctx.bus.emit({ /* buff-applied */ });
        }
        for (const extra of cfg.additionalBuffs ?? []) {
            // …build extraStatus…
            for (const rid of recipients) {
                if (recipientCarriesBlockBuff(ctx.statusEngine, rid)) continue; // Block Buff: silent skip
                ctx.statusEngine.applyTimedAbilityStatus(ctx.round, extraStatus, rid);
                ctx.bus.emit({ /* buff-applied */ });
            }
        }
```
Import `recipientCarriesBlockBuff` into `triggers.ts` (call-time-safe cycle — `// eslint-disable-next-line import/no-cycle`).

- [ ] **Step 3: Run the test — expect PASS.**

- [ ] **Step 4: Run the full combat suite to confirm ZERO golden drift** (no fixture inflicts Block Buff + a reactive buff yet → byte-identical):
Run: `npx vitest run src/utils/combat`
Expected: all pass, no `.snap` changes (`git status` shows no modified snapshots).

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/blockBuff.test.ts
git commit -m "feat(combat): Block Buff guard at reactive-buff executor"
```

---

## Task 4: `oncePerRound` gate in damage + heal/shield executor branches

**Files:**
- Modify: `src/utils/combat/triggers.ts` (add a shared `passesOncePerRoundGate`; use in damage branch ~1578 and heal/shield branch ~1464 ONLY)
- Test: `src/utils/combat/__tests__/triggers.test.ts` (or the integration file)

**Background:** Today only the debuff branch honors `Ability.oncePerRound` (inline at `triggers.ts:1326-1340`). FrontLine needs it on the damage AND shield branches.

**⚠️ DO NOT refactor the debuff branch to use the helper.** The debuff branch deliberately *splits* the logic: it **checks `consumed` and early-returns BEFORE `passesProcChanceGate`** (line 1327), then **marks consumed AFTER** the proc gate (line 1337). `passesProcChanceGate` is **stateful** — it advances a deterministic `RateGate`. Bulwark carries BOTH `procChance` AND `oncePerRound`, so on a round where Bulwark already fired, the current code returns *before* touching the RateGate. An atomic check+mark helper placed *after* the proc gate would advance the rate sequence on already-consumed rounds → **Bulwark golden drift**. Leave the debuff branch's inline logic byte-identical. The new helper is for the damage/shield branches only, which have no `procChance` today (FrontLine sets none) and no prior behavior to preserve — so an atomic check+mark after their (pass-through) proc gate is safe.

- [ ] **Step 1: Write the failing test** — a reactive `damage` ability with `oncePerRound:true` credits damage on the FIRST qualifying trigger in a round but NOT on a second trigger the same round; resets next round. Same for a reactive `shield`. (Use a minimal fixture or extend the integration test.)

Run target test → Expected: FAIL (damage/shield fire twice).

- [ ] **Step 2: Extract the helper** near the other executor helpers in `triggers.ts`:
```typescript
/** D-PR14 once-per-round gate, shared by the debuff/damage/heal/shield executors. Returns
 *  false if this (owner, ability) already fired its once-per-round effect this round; otherwise
 *  marks it consumed and returns true. Pass-through (always true, no marking) when the ability
 *  is not oncePerRound. Call AFTER the proc-chance gate so a failed roll never burns the round. */
function passesOncePerRoundGate(intent: Intent, ctx: IntentExecContext): boolean {
    if (!intent.ability.oncePerRound) return true;
    const onceKey = `${intent.ownerId}:${intent.ability.id}`;
    if (ctx.oncePerRoundConsumed?.has(onceKey)) return false;
    ctx.oncePerRoundConsumed?.add(onceKey);
    return true;
}
```
Then wire it into the two NEW branches ONLY (leave the debuff branch's inline code untouched — see the ⚠️ note above):
- **damage branch (~1578):** after `if (!passesProcChanceGate(intent, ctx)) return;` add `if (!passesOncePerRoundGate(intent, ctx)) return;`.
- **heal/shield branch (~1464):** after `if (!passesProcChanceGate(intent, ctx)) return;` add `if (!passesOncePerRoundGate(intent, ctx)) return;` (placed before the per-recipient loop; the `oncePerCombat` check stays where it is).

- [ ] **Step 3: Run the new test — expect PASS.**

- [ ] **Step 4: Run the FULL combat suite — confirm ZERO drift** (existing oncePerRound users are debuff-only and unchanged):
Run: `npx vitest run src/utils/combat` → all pass, no snapshot diffs.

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/triggers.test.ts
git commit -m "refactor(combat): share oncePerRound gate across debuff/damage/shield executors"
```

---

## Task 5: Parser — Curator (purge + Block Buff inflict)

**Files:**
- Modify: `src/utils/skillTextParser.ts` (add `parseEnemyChargedCastReaction`)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (emit the abilities — mirror the `parseChargeRemoval` consumption site)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

**Curator corpus** (resolved via `getShipSkillRows`; R0 = `firstPassiveSkillText`, R2 = `secondPassiveSkillText`, R4 = `thirdPassiveSkillText`):
- R0: `"When an enemy uses their charged skill, this unit purges 1 buffs from that enemy."`
- R2: `"...purges 1 buffs from that enemy, and inflicts Block Buff for 1 turns."`
- R4: `"...purges 2 buffs from that enemy, and inflicts Block Buff for 2 turns."`

- [ ] **Step 1: Write failing parser unit tests** for all three Curator passive texts. Assert `parseEnemyChargedCastReaction` returns:
  - R0 → `[{ type:'purge', target:'enemy', trigger:'on-enemy-charged-cast', config:{ count:1 } }]`
  - R2 → the purge above (count 1) **plus** `{ type:'debuff', target:'enemy', trigger:'on-enemy-charged-cast', config:{ buffName:'Block Buff', duration:1 } }`
  - R4 → purge count 2 + debuff Block Buff duration 2.

(Confirm exact `config` field names against the real AbilityConfig variants. **purge** = `{ type:'purge', count }` (`abilities.ts:390`). **debuff** requires the FULL shape — `{ type:'debuff', buffName, parsedEffects:{}, stacks:1, isStackable:false, duration, application:'inflict' }` (`abilities.ts:332-341`); the canonical build template is `buildShipAbilities.ts:1656-1664` — copy that shape for the Block Buff debuff. Adjust the test assertions to the real field names.)

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts` → FAIL.

- [ ] **Step 2: Implement `parseEnemyChargedCastReaction`** in `skillTextParser.ts`. Sketch:
```typescript
const ENEMY_USES_CHARGED_RE =
    /\bwhen\s+an?\s+enemy\s+uses\s+(?:its|their)\s+charged\s+skill\b/i;
// purge clause: "purges N buffs from that enemy"
const ECC_PURGE_RE = /\bpurges?\s+(\d+|a|an)\s+buffs?\b/i;
// Block Buff inflict: "inflicts Block Buff for N turns"
const ECC_BLOCK_BUFF_RE = /\binflicts?\s+block\s+buff\s+for\s+(\d+)\s+turns?\b/i;

export function parseEnemyChargedCastReaction(text: string | null | undefined): Ability[] | null {
    if (!text) return null;
    const plain = stripUnitTags(text).replace(/[‘’]/g, "'");
    if (!ENEMY_USES_CHARGED_RE.test(plain)) return null;
    const out: Ability[] = [];
    const purge = ECC_PURGE_RE.exec(plain);
    if (purge) {
        const raw = purge[1].toLowerCase();
        const count = raw === 'a' || raw === 'an' ? 1 : parseInt(raw, 10);
        out.push(/* purge ability: type 'purge', target 'enemy', trigger 'on-enemy-charged-cast', config { count } */);
    }
    const block = ECC_BLOCK_BUFF_RE.exec(plain);
    if (block) {
        out.push(/* debuff ability: buffName 'Block Buff', duration parseInt(block[1]) */);
    }
    // (FrontLine damage+shield handled in Task 6 — extend this function there.)
    return out.length ? out : null;
}
```
Return the exact `Ability` shape used elsewhere (the `parseChargeRemoval` consumer in `buildShipAbilities.ts` shows the canonical `{ type, target, trigger, config, … }` object — match it, including any required `id`/slot fields the orchestrator sets).

- [ ] **Step 3: Wire into `buildShipAbilities.ts`** at the same orchestration point that consumes `parseChargeRemoval` (~:1199). Run `parseEnemyChargedCastReaction` against the passive skill text and push the returned abilities into the passive ability set. Ensure the abilities get stable ids (mirror how multi-ability builders index-suffix; the Block-Buff debuff and the purge need distinct ids).

- [ ] **Step 4: Run the parser tests — expect PASS.** Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 5: Run `npm run audit:skills`** — must remain 0 non-allowlisted findings (Curator clauses are now parsed; remove any stale Curator allowlist entry if one exists).

- [ ] **Step 6: Commit.**
```bash
git add src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(combat): parse Curator enemy-charged-cast purge + Block Buff inflict"
```

---

## Task 6: Parser — FrontLine (damage + shield, once per round)

**Files:**
- Modify: `src/utils/skillTextParser.ts` (extend `parseEnemyChargedCastReaction`)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

**FrontLine corpus** (R2 = `secondPassiveSkillText`, the `<br/>`-prefixed clause):
`"...When an enemy uses their Charged skill, it deals 80% and gains a Shield equal to 30% of the damage dealt, once per round."`

- [ ] **Step 1: Write failing parser test** asserting FrontLine's text yields TWO abilities on `on-enemy-charged-cast`, both `oncePerRound:true`:
  - `{ type:'damage', target:'enemy', trigger:'on-enemy-charged-cast', config:{ multiplier:80, hits:1 }, oncePerRound:true }`
  - `{ type:'shield', target:'self', trigger:'on-enemy-charged-cast', config:{ basis:'attack', pct:24 }, oncePerRound:true }` (24 = round(30 × 80 / 100); document the approximation in the test comment).

(Pin exact field names against the reactive `damage` config — `multiplier`/`hits` per `triggers.ts:1578` — and the `shield` config — `basis`/`pct` per `abilities.ts:363`.)

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts` → FAIL.

- [ ] **Step 2: Extend `parseEnemyChargedCastReaction`** to detect the FrontLine clause:
```typescript
// "deals N%" + "Shield equal to M% of the damage dealt" within the enemy-charged sentence.
const ECC_DAMAGE_RE = /\bdeals?\s+(\d+(?:\.\d+)?)\s*%/i;
const ECC_SHIELD_OF_DAMAGE_RE = /\bshield\s+equal\s+to\s+(\d+(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?damage\s+dealt/i;
const ECC_ONCE_PER_ROUND_RE = /\bonce\s+per\s+round\b/i;
```
When both damage and shield-of-damage match: emit a `damage` ability (`multiplier = damagePct`) and a `shield` ability with `basis:'attack', pct = round(shieldPct × damagePct / 100)`. Set `oncePerRound: ECC_ONCE_PER_ROUND_RE.test(plain)` on the emitted abilities. Document in-code WHY the shield is attack-based (see "Spec deviation" above — the reactive shield executor's `damage-dealt` basis reads the enemy's trigger damage, not FrontLine's own; the reactive-damage approximation is `attack × damagePct%` with no mitigation/crit, so the shield = `shieldPct%` of that).

NOTE the parser must not let FrontLine's clause leak a stray purge/Block-Buff match (it has none) and must not let Curator's clause emit a damage/shield (it has none) — the `if (match)` guards already handle this, but add a parser test for each ship confirming the OTHER ship's effect types are absent.

- [ ] **Step 3: Run parser tests — expect PASS.** Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 4: `npm run audit:skills`** — 0 findings.

- [ ] **Step 5: Commit.**
```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(combat): parse FrontLine enemy-charged-cast damage + shield (once per round)"
```

---

## Task 7: Engine integration goldens

**Files:**
- Modify: `src/utils/combat/__tests__/enemyChargedCast.integration.test.ts`

Mirror `enemyChargeRemoval.integration.test.ts` (runCombat with a two-team setup; one side has a ship whose charged skill is reachable, the other has Curator/FrontLine built via `buildShipAbilities`). Each test must be a genuine gate-flip (a control without the reaction proves the effect is caused by it), not vacuous.

- [ ] **Step 1: Curator purge-on-enemy-charged.** Set up an enemy with a buff and a charged skill it casts; Curator (R0) reacts → assert the enemy lost N buffs (a `purge-performed` event with `targetId` = the casting enemy, or the enemy's buff count dropped). Control: no enemy charged cast → no purge.

- [ ] **Step 2: Curator Block-Buff-on-enemy-charged (R4) + behavioral block.** Curator R4 reacts → purges 2 + inflicts Block Buff (2 turns) on the casting enemy. Then on the enemy's NEXT turn, assert it CANNOT gain a self-buff it would otherwise gain (gate-flip vs a no-Block-Buff control). This exercises Task 2's guard end-to-end.

- [ ] **Step 3: FrontLine damage+shield-on-enemy-charged.** Enemy casts charged → FrontLine credits reactive damage to the casting side AND gains a shield (assert `shieldPool > 0` / shield credited). Confirm shield magnitude ≈ `effectiveAttack × 0.24` (or assert it is non-zero + tracks attack via a higher-attack variant, mirroring the Spearhead/amplification test style).

- [ ] **Step 4: Once-per-round limiting.** TWO enemies each cast a charged skill in the SAME round → FrontLine reacts only ONCE (damage credited once, one shield grant). Next round, it can react again.

- [ ] **Step 5: Run the integration file + full combat suite.**
Run: `npx vitest run src/utils/combat` → all pass; inspect any `.snap` diffs (should be none unless a new snapshot is intentionally added for these fixtures).

- [ ] **Step 6: Commit.**
```bash
git add src/utils/combat/__tests__/enemyChargedCast.integration.test.ts
git commit -m "test(combat): enemy-charged-cast reaction goldens (Curator/FrontLine/Block Buff/once-per-round)"
```

---

## Task 8: Editor option, changelog, docs, final verification

**Files:**
- Modify: `src/components/skills/AbilityCard.tsx` (`TRIGGER_OPTIONS` ~127)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (conditional)

- [ ] **Step 1: Add the editor trigger option.** In `TRIGGER_OPTIONS`:
```typescript
    { value: 'on-enemy-charged-cast', label: 'When an enemy uses their charged skill' },
```
(If `AbilityCard.test.tsx` has a trigger-select test, confirm it still passes / extend if it asserts the full option list.)

- [ ] **Step 2: Changelog.** Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` (plain English): reactions to enemy charged-skill use (Curator purges & blocks buffs; FrontLine counter-attacks with a shield), and Block Buff now prevents the affected unit from gaining buffs in the simulator.

- [ ] **Step 3: Docs.** If `DocumentationPage.tsx` enumerates charge mechanics or control effects, add Block Buff / enemy-charged-cast reactions. If it does not enumerate them, skip (note skip in the commit body).

- [ ] **Step 4: FULL verification.**
```bash
npx tsc --noEmit
npm run lint
npm run audit:skills        # expect 0 non-allowlisted findings
npm test -- --run           # full suite green; inspect any golden/.snap diffs
```
Expected: tsc clean, lint clean (max-warnings 0), audit 0 findings, all tests green, ZERO unexpected golden drift.

- [ ] **Step 5: Commit.**
```bash
git add src/components/skills/AbilityCard.tsx src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "feat(combat): editor option + changelog + docs for enemy-charged-cast reactions"
```

---

## Done criteria

- `on-enemy-charged-cast` trigger fires symmetrically (player & enemy) and routes onto the casting enemy via `counterTargetId`.
- Curator purges (and at R2/R4 inflicts Block Buff) on an enemy charged cast; FrontLine deals damage + gains a shield, once per round.
- Block Buff prevents the carrier (either side) from receiving new timed buffs at the firing-skill + reactive-buff seams. Auras and start-of-combat seeding are documented out-of-scope limitations.
- Full suite green, tsc/lint clean, `audit:skills` 0 findings, zero unexpected golden drift.
- `UNRELEASED_CHANGES` + editor option updated.
