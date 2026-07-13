# SP-M / M1 — Reactive-damage HP fidelity in positional sim (all 8 ships) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared reactive-damage executor reduce the true positional victim(s)' HP in `simulateBattle`, feeding F1 accounting (`perTargetDealt`/`damageTaken`), for all 8 reactive-damage ships; DPS/healing modes byte-identical.

**Architecture:** One mode-gated edit to `applyReactiveDamage` (positional → `applyVictimDamage` + `creditDealt`, mirroring `applyCounterAttack`; DPS/healing → unchanged credit-only), plus per-ship victim resolution (counterTargetId-routed for FrontLine/Paracelsus/Vindicator/Grif; reused cast-path selectors for Rhodium/Chakara; a shared conditional-AoE loop for Judge/Incinerator).

**Tech Stack:** TypeScript, Vitest, the combat engine (`src/utils/combat/`), the ability model (`src/utils/abilities/`).

**Spec:** `docs/superpowers/specs/2026-07-13-sp-m-reactive-damage-hp-fidelity-design.md`
**Epic:** Team-Agnostic Engine Unification & Sim Fidelity. **Branch:** off `main` (SP-F PR3 `ba5199e9`).
**Coordinator decisions (settled):** (1) build the round-boundary/selected target resolvers NOW — all 8 ships get real positional HP; (2) Grif mainline; (3) Finding A (`input.positionalTeamBattle` gate) adopted.

---

## Feasibility assessment

No ship needs disproportionate new machinery — build all four resolvers. Reuse map:

| Ship | Trigger | True target | Reusable primitive | New work |
|---|---|---|---|---|
| **Rhodium** | end-of-round | enemy with most buffs | `AbilityTarget 'enemy-most-buffs'` + `ctx.enemyWithMostBuffs` (already powers Rhodium's purge) | parser re-target the co-located 80% damage clause; drain selector resolution (mirror debuff branch `triggers.ts:2207-2213`). **LOW** |
| **Chakara** | start-of-round | highest-Speed enemy | `highestAttackAmong` generic picker; `enemyWithHighestAttack` pattern | new `AbilityTarget 'enemy-highest-speed'`, `highestSpeedInRoster` twin, `ctx.enemyWithHighestSpeed`, parser detector. **LOW–MOD** |
| **Judge** | start-of-round | all enemies < 50% HP | `parseHpThresholdCondition` (already attaches Judge's hp-threshold cond, `buildShipAbilities.ts:1430`); `ConditionContext.enemyHpPct` + `conditionsMet` | drain: living-opposing enumerator + per-victim condition eval + per-victim apply loop. **MOD** |
| **Incinerator** | end-of-round | all enemies with Inferno | `damageEnemyEffectNamesFromClause`/`enemyEffectConditions` (already attach the Inferno cond, `buildShipAbilities.ts:1452-1460`); `ConditionContext.enemyDebuffNames` | same AoE machinery as Judge (shared). **MOD** |
| **Grif** | on-enemy-cleansed | the cleansing enemy | `e.casterId` at the listener | one-line `counterTargetId` stamp (`triggers.ts:846`). **TRIVIAL** |
| FrontLine / Paracelsus / Vindicator | (as before) | counterTargetId-routed | — | none beyond Task 2. |

The single largest piece is the AoE damage-branch loop with per-victim condition evaluation (shared by Judge + Incinerator). Only genuinely new state is a per-side living-opposing enumerator (`livingOpposingActorIds`), bound exactly like the existing `enemyWithMostBuffs`.

---

## Resolved facts (file:line)

**R1 — the parser DROPS the target selector but ALREADY ATTACHES the per-victim condition.** Round-boundary reactive-damage ability built at `buildShipAbilities.ts:1099-1116` with `target:'enemy'` (`:1103`), config `{type:'damage', multiplier, hits?, noCrit?}`, trigger `start-of-round`/`end-of-round` (`:1090-1095`). Judge's "to all enemies with less than 50% HP" → `parseHpThresholdCondition` (`skillTextParser.ts:683`) attaches `{subject:'hp-threshold', hpComparator:'below', hpPercent:50, derivable:true}` (`buildShipAbilities.ts:1430-1441`). Incinerator's "to all enemies with Inferno" → `damageEnemyEffectNamesFromClause` + `enemyEffectConditions` attach the Inferno enemy-effect condition (`buildShipAbilities.ts:1452-1460`). The `target` stays `'enemy'`; NO parser step captures "highest Speed enemy" (Chakara) or "the enemy with the most buffs" (Rhodium's damage clause) as a selector.

**R2 — drain-time condition gate is GLOBAL, not per-victim.** `executeIntent` gates `conditionsMet(liveGateConditions(scrubbedConditions), buildDrainContext(ctx, ownerId))` (`triggers.ts:1949-1950`) against a single `enemyHpPct` (`triggers.ts:1308`) — the dummy in positional mode. Scrub precedent: the `on-hp-threshold-crossed` self-condition scrub (`triggers.ts:1938-1943`).

**R3 — selector resolvers.** `AbilityTarget` (`types/abilities.ts:73-83`) has `'all-enemies'`, `'enemy-most-buffs'`, `'enemy-highest-attack'`. Debuff branch resolves a selector then no-ops on undefined (`triggers.ts:2207-2213`). Engine resolvers: `mostBuffsAmong` (`engine.ts:5995`), `highestAttackInRoster` (`engine.ts:6010`, via generic `highestAttackAmong`, `highestAttack.ts:8`). Per-side ctx: `playerDrainCtx` (`engine.ts:6032`) → `enemyAttackerActors`; `enemyDrainCtx` (`engine.ts:6059`) → `allPlayerActors`.

**R4 — per-victim condition primitives.** `ConditionContext` (`evaluateConditions.ts:4`) carries `enemyHpPct` (`:31`) and `enemyDebuffNames` (`:20`, doc cites "Incinerator's 'to enemies afflicted with Inferno'"). DoT names are synthesized base-type names (`roundContext.ts`). `conditionsMet(conditions, ctx)` is the evaluator (imported `triggers.ts:18`). `ctx.actorById(id)` (`engine.ts:5945`) yields the victim; `victim.infernoEntries` (`state.ts:145`) is the Inferno store; `victim.currentHp` + max HP give HP%.

**R5 — roster/liveness.** `isActorAlive` (`engine.ts:2152`) on ctx; per-side rosters `enemyAttackerActors`/`allPlayerActors` are `CombatActor[]` with `destroyedRound`.

**F1 — `applyVictimDamage` (`engine.ts:3571`+).** Mutates `victim.currentHp`/`shieldPool`, `sink.addIncoming`(→`perActorIncoming`→`incomingDamage`/`hpPct`), emits `hp-changed`/`shield-destroyed`/`ship-destroyed` (via `recordDestroyed` `:4045`, honouring `killerId`/`byDirectDamage`). Does NOT call `creditDealt`/`roundPerTargetDamage` for the primary victim → the caller must (like `applyCounterAttack` `:4480-4485`).

**F2 — gate = `input.positionalTeamBattle`** (`engine.ts:1069`; true only via `simulateBattle`, `battleSimulator.ts:981`). `dpsEnemyTarget` is the WRONG gate (healing-mode guards run with `dpsEnemyTarget===false`). `positionalTeamBattle ⟹ !dpsEnemyTarget ⟹` the post-round aggregate (`engine.ts:7931`) does not fire → no double-count.

**F3 — dummy `enemy`** (`engine.ts:~2060`, in scope in the executor). The `victim.id !== enemy.id` guard keeps the HP path off the vestigial dummy — a defensive backstop (a proc that still resolves the dummy, e.g. an AoE over an empty roster, stays credit-only).

**F4 — decision:** positional branch = `applyVictimDamage` + `roundPerTargetDamage` + `creditDealt` + `reactiveDealtByOwner`, NO `creditDamage` (mirror `applyCounterAttack`). DPS/healing branch unchanged (`creditDamage`).

**F5 — harness:** `simulateBattle` → `result.rounds[].ships[].{damageDealt, damageTaken, incomingDamage, hpPct, alive}`; `place(ship,pos,attack,hp)` (`overloadLifecycle.test.ts:116`); ships from real skill text via `buildShipAbilities`; goldens `simGoldenFixtures.ts` + `simGolden.test.ts` (**`vitest -u` FORBIDDEN**); credit-only guards `reactiveDamageMitigation.integration.test.ts` + `enemyChargedCast.integration.test.ts`. Charged cast in `simulateBattle`: skill text containing "fully charged" + `chargeSkillCharge>=1` + a charged row.

**F6 — team symmetry:** enemy-side-lift precedent `reactiveDamageMitigation.integration.test.ts:243-318`; positional analogue = reactive ship on `enemyTeam`, assert a player victim's HP drops.

---

## Global Constraints (apply to every task)

- **`vitest -u` FORBIDDEN.** New sim fixtures carry any golden moves; existing goldens that move are audited line-by-line as genuine behaviour changes (real enemies now take reactive HP → may die sooner).
- **`npm run audit:skills` → 0 findings / 0 stale. No new allowlist entries.** (Pre-existing FrontLine `shield-penetration-innate` stays.)
- **Full suite green, `tsc` clean, `eslint --max-warnings 0`.** husky pre-commit runs the WHOLE vitest suite — every commit leaves the suite green.
- **Team-symmetric:** every mechanic verified with the ship on BOTH sides.
- **One plain-English `UNRELEASED_CHANGES` entry** (`src/constants/changelog.ts:8`).
- **Retire the F1-attribution pin** (`docs/superpowers/notes/2026-07-13-f1-attribution-audit.md` §5b / carry-forward #3).
- `reactiveDealtByOwner` + FrontLine shield untouched.
- **Parser changes stay disjoint/byte-identical for existing shapes:** re-targeting only fires for a round-boundary reactive damage ability whose targeting clause is detected; on-cast damage keeps `target:'enemy'`. Guard with `buildShipAbilities.test.ts` shape assertions.

---

## Task 1 — Characterization: lock the DPS/healing credit-only contract (no production change)

**Goal:** Green baseline the mode gate must preserve.

**Files (read/run only):** `src/utils/combat/__tests__/enemyChargedCast.integration.test.ts`, `src/utils/combat/__tests__/reactiveDamageMitigation.integration.test.ts`.

- [ ] **Step 1:** Run both guard suites; confirm GREEN. Record the contract assertions (shield>0 `:403`, control shield 0 `:415`, `focusCumulativeDamage(reaction)>control` `:420`, shield-tracks-dealt `:423`; mitigation `:160`, crit-scale `:186`, noCrit `:210`, zero-guard `:223`, enemy-owned `:293`).
- [ ] **Step 2:** Confirm by inspection both run with `enemyAttackers` present but no `positionalTeamBattle` → credit-only under the Task 2 gate. No commit.

Run: `npx vitest --run src/utils/combat/__tests__/enemyChargedCast.integration.test.ts src/utils/combat/__tests__/reactiveDamageMitigation.integration.test.ts`
Expected: PASS.

---

## Task 2 — Engine mode-gate + FrontLine positional HP (RED → GREEN foundation)

**Files:** **Create** `src/utils/combat/__tests__/reactiveDamagePositionalHp.test.ts`. **Modify** `src/utils/combat/engine.ts` (replace `:4594-4596`).

**Interfaces — Consumes:** `simulateBattle`, `BattlePlacement` (`../../calculators/battleSimulator`). **Produces:** exported test helpers `ship`/`place`/`sumDealt`/`sumTaken`/`minHpPct` reused by Tasks 3–8.

- [ ] **Step 1: Write the failing test (RED).** Create `reactiveDamagePositionalHp.test.ts`:

```ts
/**
 * SP-M M1: reactive-damage procs REDUCE the resolved victim's real HP in a positioned two-team
 * battle (simulateBattle → input.positionalTeamBattle), surface on the victim's damageTaken, and
 * are attributed to the owner via damageDealt (perTargetDealt). DPS/healing credit-only behaviour
 * is unchanged (guards: enemyChargedCast / reactiveDamageMitigation, which lack positionalTeamBattle).
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

const FRONTLINE_R2_TEXT =
    'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.<br /><br />When an enemy uses their Charged skill, it deals <unit-damage>80%</unit-damage> and gains a Shield equal to <unit-damage>30%</unit-damage> of the damage dealt, once per round.';

export const ship = (id: string, over: Partial<Ship>): Ship =>
    ({
        id, name: id, rarity: 'legendary', faction: 'TERRAN_COMBINE', type: 'Attacker',
        baseStats: {} as Ship['baseStats'], equipment: {}, implants: {}, refits: [],
        affinity: 'antimatter', activePattern: 'Pattern-Base', activeTarget: 'front',
        chargeSkillCharge: 0, ...over,
    }) as Ship;

export const place = (s: Ship, position: Position, attack: number, hp: number): BattlePlacement => ({
    ship: s, position,
    statOverrides: { attack, crit: 0, critDamage: 0, defensePenetration: 0, hacking: 200, defence: 0, hp },
});

export const sumDealt = (r: ReturnType<typeof simulateBattle>, id: string): number =>
    r.rounds.reduce((s, rd) => s + (rd.ships.find((x) => x.actorId === id)?.damageDealt ?? 0), 0);
export const sumTaken = (r: ReturnType<typeof simulateBattle>, id: string): number =>
    r.rounds.reduce((s, rd) => s + (rd.ships.find((x) => x.actorId === id)?.damageTaken ?? 0), 0);
export const minHpPct = (r: ReturnType<typeof simulateBattle>, id: string): number =>
    Math.min(...r.rounds.map((rd) => rd.ships.find((x) => x.actorId === id)?.hpPct ?? 100));

const frontline = (id: string): Ship =>
    ship(id, {
        type: 'Defender', activeTarget: 'allies',
        activeSkillText: 'This Unit repairs 1% of its Max HP.',
        secondPassiveSkillText: FRONTLINE_R2_TEXT,
        refits: [{}, {}] as unknown as Ship['refits'],
    });
const chargedEnemy = (id: string): Ship =>
    ship(id, {
        activeSkillText: 'This Unit deals <unit-damage>1% damage</unit-damage>. This Unit starts combat fully charged.',
        chargeSkillText: 'This Unit deals <unit-damage>50% damage</unit-damage>.', chargeSkillCharge: 1,
    });
const plainEnemy = (id: string): Ship =>
    ship(id, { activeSkillText: 'This Unit deals <unit-damage>1% damage</unit-damage>.' });

const ATTACKER = 'attacker';
const ENEMY = 'e:e1:0';

describe('SP-M M1: FrontLine reactive damage reduces the charging enemy HP (positional)', () => {
    const run = (enemy: Ship) =>
        simulateBattle({
            playerTeam: [place(frontline('fl'), 'M4', 10_000, 1e12)],
            enemyTeam: [place(enemy, 'M4', 1, 1e12)],
            rounds: 2,
        });

    it('the charging enemy loses HP to FrontLine reactive damage; delta reconciles dealt↔taken', () => {
        const reaction = run(chargedEnemy('e1'));
        const control = run(plainEnemy('e1'));
        const dealtDelta = sumDealt(reaction, ATTACKER) - sumDealt(control, ATTACKER);
        const takenDelta = sumTaken(reaction, ENEMY) - sumTaken(control, ENEMY);
        expect(dealtDelta).toBeGreaterThan(0);
        expect(takenDelta).toBeGreaterThan(0);
        expect(dealtDelta).toBeCloseTo(takenDelta, 5);
        expect(minHpPct(reaction, ENEMY)).toBeLessThan(minHpPct(control, ENEMY));
    });
});
```

- [ ] **Step 2: Run to confirm RED.** `npx vitest --run src/utils/combat/__tests__/reactiveDamagePositionalHp.test.ts`. Expected: FAIL (pre-fix positional reactive only `creditDamage`s → not in `perTargetDealt`/real HP → all deltas 0). If RED is "no reaction fired," fix the fixture first (verify the charged `skill-fired` via `result.combatLog`) — the RED must be "reactive lands 0 HP."

- [ ] **Step 3: GREEN — replace `engine.ts:4594-4596`** with the mode-gated dual path:

```ts
            reactiveDealtByOwner.set(ownerId, raw);
            // SP-M M1: in a positioned two-team battle (simulateBattle sets input.positionalTeamBattle)
            // a reactive proc REDUCES the resolved victim's real HP through the SAME shared funnel
            // counters use (applyVictimDamage) — surfacing on the victim's HP curve
            // (roundPerTargetDamage → damageTaken) and attributed to the owner (creditDealt →
            // perTargetDealt → damageDealt). Mirrors applyCounterAttack EXACTLY (isCounter:true → a
            // reactive hit is never itself reflected and never Protection-redirected; no shield
            // penetration) and deliberately does NOT creditDamage: positionalTeamBattle is never
            // dpsEnemyTarget, so the DPS-mode post-round aggregate (engine.ts:7931) never fires here
            // — cumulativeDamage only reports + declines the vestigial dummy, never a real victim, so
            // folding the reactive into it would double-count exactly like the per-victim DoT/
            // detonation split documented at engine.ts:7898.
            //
            // victim.id !== enemy.id: defensive backstop keeping the HP path off the vestigial dummy
            // (a proc whose target resolved to ctx.enemy — e.g. an AoE with an empty living roster —
            // stays credit-only). After Tasks 4-7 all eight ships resolve a real positioned victim.
            if (input.positionalTeamBattle && victim.id !== enemy.id) {
                applyVictimDamage(raw, victim, sink, {
                    killerId: ownerId, byDirectDamage: true, isCounter: true,
                    shieldPenetrationPct: 0, bombPortion: 0,
                });
                roundPerTargetDamage.set(victim.id, (roundPerTargetDamage.get(victim.id) ?? 0) + raw);
                creditDealt(ownerId, victim.id, raw);
                return { dealt: raw, didCrit };
            }
            // DPS / healing mode (byte-identical): credit-only.
            creditDamage(ownerId, 'direct', raw);
            return { dealt: raw, didCrit };
```

- [ ] **Step 4: Run to confirm GREEN.** New test PASS; Task 1 guards still PASS (they lack `positionalTeamBattle`). `npx tsc --noEmit` clean; `npx eslint --max-warnings 0 src/utils/combat/engine.ts`.
- [ ] **Step 5: Commit.** No golden should move yet — run the full suite to verify; if any *existing* golden moves, STOP and audit before committing (expected: none — no existing golden fixture contains a `counterTargetId`-routed reactive ship). `git add` engine + new test; commit `feat(sim): reactive damage reduces victim HP in positional battles (FrontLine)`.

---

## Task 3 — hpBasisPct retaliations: Paracelsus (on-destroyed) + Vindicator (on-resist)

**Files:** **Modify** `reactiveDamagePositionalHp.test.ts` (two `describe` blocks). No production change expected (the `hpBasisPct` path shares the executor tail edited in Task 2).

**Interfaces — Consumes:** the Task 2 test helpers; the executor branch from Task 2.

- [ ] **Step 1:** Build a **Vindicator** fixture (real on-resist passive from `docs/ship-skills.csv` — "…it deals 30% of its Max HP as damage to the inflictor"; Vindicator high `security`, enemy low `hacking`, enemy inflicts a debuff Vindicator resists). Assert the *inflicting enemy's* HP drops and Vindicator's `damageDealt` includes it, delta-reconciled vs a control where the debuff lands (no resist → no proc). Victim = `counterTargetId = e.sourceId`/`e.targetId` → real roster enemy.
- [ ] **Step 2:** Build a **Paracelsus** fixture (real on-destroyed passive — "…retaliates for 50% of its Max HP"): a killable Paracelsus vs a strong enemy; when the enemy kills Paracelsus, the killer's HP drops in the death round and appears in Paracelsus's `damageDealt` (`allowDeadOwner`/`fromOwnDeath`, `triggers.ts:2754`, executor `:4516-4522`). Control = huge-HP Paracelsus that survives → no proc.
- [ ] **Step 3:** Run — both PASS with no engine change (confirms the shared branch covers `hpBasisPct`). If a production tweak is needed, keep the Task 1 guards green (debug via `superpowers:systematic-debugging`). `tsc`+lint.
- [ ] **Step 4: Commit** `test(sim): Paracelsus/Vindicator reactive retaliations reduce HP in positional`.

---

## Task 4 — Grif (on-enemy-cleansed): route to the real cleanser

**Files:** **Modify** `src/utils/combat/triggers.ts:846`; **Modify** `reactiveDamagePositionalHp.test.ts`.

- [ ] **Step 1: RED test.** Positional battle: player-side **Grif** (real refit passive: "When an enemy cleanses a Debuff, this Unit deals 75% Damage that cannot critically hit") vs an enemy that cleanses a debuff (seed the enemy with a debuff + a cleanse skill, or an ally cleanses it — resolve the exact trigger from `docs/ship-skills.csv` during execution). Assert the **cleansing enemy** loses HP and Grif's `damageDealt` carries it (delta vs a no-cleanse control).
- [ ] **Step 2: Confirm RED** (Grif resolves the dummy → excluded by the `victim.id !== enemy.id` backstop → 0 HP).
- [ ] **Step 3: GREEN — one-line stamp at `triggers.ts:846`:**

```ts
                        // SP-M M1: stamp the cleansing enemy as the reaction victim so Grif's 75%
                        // damage lands on the REAL cleanser in positional mode. In DPS/healing mode
                        // the only opposing actor IS the dummy `enemy`, so counterTargetId ===
                        // ctx.enemy.id and this is byte-identical there.
                        if (isOpposing(e.casterId))
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, counterTargetId: e.casterId },
                            });
```

- [ ] **Step 4: Run GREEN.** Verify `cleanseReactivePath.test.ts`, `enemyReactiveRouting.test.ts`, and the Task 1 guards stay green (the added `counterTargetId` must not change DPS/healing routing — it equals `ctx.enemy.id` there). `tsc`+lint.
- [ ] **Step 5: Commit** separately `feat(sim): Grif on-cleanse damage lands on the real cleanser in positional`.

---

## Task 5 — Rhodium (end-of-round): route to the enemy with the most buffs

> **Orchestrator note:** Task 5's rewritten drain branch references `resolveAoEReactiveDamageVictims` (the `'all-enemies'` arm), which is not defined until Task 7. To keep the Task 5 commit compiling (husky runs `tsc`), in Task 5 add a temporary local `const resolveAoEReactiveDamageVictims = (_i: Intent, _c: IntentExecContext): string[] => [];` stub at the top of the damage branch (or omit the `'all-enemies'` arm entirely and add it in Task 7). Task 7 replaces the stub with the real helper. Rhodium never hits the `'all-enemies'` arm, so `[]` is inert for this task.

**Files:** **Modify** `src/utils/abilities/buildShipAbilities.ts` (~`:1461`); **Modify** `src/utils/combat/triggers.ts` damage branch (`:2759-2787`); **Modify** `reactiveDamagePositionalHp.test.ts`; **Modify** `src/utils/abilities/__tests__/buildShipAbilities.test.ts`.

- [ ] **Step 1: RED test.** Positional: player-side **Rhodium** (real refit-3 passive: "At the end of the round, this Unit purges 2 buffs from the enemy with the most buffs and deals 80% damage that cannot critically hit") vs two enemies, one carrying more buffs than the other (give one enemy a self-buff skill). Assert the **most-buffed** enemy loses HP (not the other), delta vs control; Rhodium's `damageDealt` carries it.
- [ ] **Step 2: Confirm RED** (Rhodium's damage clause → dummy → 0 HP).
- [ ] **Step 3: GREEN — parser re-target.** In `buildShipAbilities.ts` (new block after `:1460`): if `out[0]` is a round-boundary reactive damage ability and the text carries a "most buffs" enemy target for the DAMAGE clause (reuse the same detector the purge target uses — locate the `'enemy-most-buffs'`-producing detector during execution), set `out[0].ability.target = 'enemy-most-buffs'`. Sentence/position-scoped so on-cast damage is unaffected.
- [ ] **Step 4: GREEN — drain selector resolution.** Rewrite the `cfg.type==='damage'` multiplier branch (`triggers.ts:2759-2787`):

```ts
        if (!passesOncePerRoundGate(intent, ctx)) return;
        // SP-M M1: resolve the reactive damage victim SET. Single-selector targets
        // (enemy-most-buffs / enemy-highest-speed) resolve one living opposing actor via the ctx
        // resolvers (mirrors the debuff branch's enemy-highest-attack resolution, triggers.ts:2207);
        // 'all-enemies' enumerates the living opposing roster (Judge/Incinerator, Task 7); everything
        // else keeps the eventCtx-routed counterparty else the ctx.enemy fallback (FrontLine/Grif/
        // the DPS dummy). A selector that resolves nothing is a NO-OP (never fall back to the dummy).
        const tgt = intent.ability.target;
        let victimIds: (string | undefined)[];
        if (tgt === 'enemy-most-buffs') {
            const id = ctx.enemyWithMostBuffs?.(intent.ownerId);
            if (id === undefined) return;
            victimIds = [id];
        } else if (tgt === 'enemy-highest-speed') {
            const id = ctx.enemyWithHighestSpeed?.(intent.ownerId);
            if (id === undefined) return;
            victimIds = [id];
        } else if (tgt === 'all-enemies') {
            victimIds = resolveAoEReactiveDamageVictims(intent, ctx); // Task 7 helper (stub until then)
        } else {
            victimIds = [intent.eventCtx?.counterTargetId ?? ctx.enemy.id];
        }
        for (const victimId of victimIds) {
            if (victimId === undefined) continue;
            const outcome = ctx.applyReactiveDamage?.(
                intent.ownerId, victimId, intent.ability.id,
                cfg.multiplier, cfg.hits ?? 1, cfg.noCrit ?? false
            );
            emitReactiveDamageLog(ctx, intent.ownerId, victimId, outcome);
        }
        return;
```

- [ ] **Step 5: Shape assertion.** Add a `buildShipAbilities.test.ts` assertion that Rhodium's round-boundary damage ability now has `target:'enemy-most-buffs'`. `noCrit` preserved (flows through `cfg.noCrit`); `passesOncePerRoundGate` fires once for the whole proc.
- [ ] **Step 6: Run GREEN**; guards green; `tsc`+lint. **Commit** `feat(sim): Rhodium end-of-round damage hits the most-buffed enemy in positional`.

---

## Task 6 — Chakara (start-of-round): route to the highest-Speed enemy

**Files:** **Modify** `src/types/abilities.ts:82` (union); **Modify** `src/utils/combat/engine.ts` (`highestSpeedInRoster` + `ReactiveSideCtx` field + 2 bindings + ctx pass-through); **Modify** `src/utils/combat/triggers.ts` (`IntentExecContext` field — consumed in Task 5's branch); **Modify** `src/utils/skillTextParser.ts` + `src/utils/abilities/buildShipAbilities.ts` (detector + re-target); **Modify** `reactiveDamagePositionalHp.test.ts`, `buildShipAbilities.test.ts`.

- [ ] **Step 1: RED test.** Positional: player-side **Chakara** (real refit passive from `docs/ship-skills.csv`: "…deals 60% damage to the highest Speed Enemy") vs two enemies with different Speed. Assert the **higher-Speed** enemy loses HP (not the slower), delta vs control.
- [ ] **Step 2: Confirm RED.**
- [ ] **Step 3: GREEN — type.** In `types/abilities.ts:82` add `'enemy-highest-speed'` to the `AbilityTarget` union (after `'enemy-highest-attack'`).
- [ ] **Step 4: GREEN — engine resolver** next to `highestAttackInRoster` (`engine.ts:6018`):

```ts
        // SP-M M1: living opposing actor with the greatest LIVE effective SPEED (Chakara's
        // enemy-highest-speed round-boundary hit). Reuses the generic highestAttackAmong picker
        // (a max-of-a-stat selector) with a speed accessor. Ties → roster order.
        const highestSpeedInRoster = (roster: CombatActor[]): string | undefined =>
            highestAttackAmong(
                roster.map((a) => a.id),
                (id) => {
                    const a = roster.find((x) => x.id === id);
                    return a ? effectiveStatsOf(statusEngine, selfBuffLookup, a).speed : 0;
                },
                (id) => roster.find((a) => a.id === id)?.destroyedRound === undefined
            );
```

Then: `ReactiveSideCtx` (`engine.ts:1276`) add `enemyWithHighestSpeed?: (ownerId: string) => string | undefined;`. `playerDrainCtx` (`:6041`) + `enemyDrainCtx` (`:6068`) add `enemyWithHighestSpeed: () => highestSpeedInRoster(enemyAttackerActors|allPlayerActors)`. Ctx assembly (`:5959`, beside `enemyWithHighestAttack`): `enemyWithHighestSpeed: sideCtx.enemyWithHighestSpeed,`. `IntentExecContext` (`triggers.ts:~1180`) add the same field signature.

- [ ] **Step 5: GREEN — parser.** Add `parseHighestSpeedEnemyTarget(text, damagePos)` in `skillTextParser.ts` (sentence-scoped detector for "to the highest Speed Enemy", mirroring the position-scoped detectors); in `buildShipAbilities.ts` (after `:1460`), if `out[0]` is a round-boundary reactive damage ability and the detector matches at `damagePos`, set `out[0].ability.target = 'enemy-highest-speed'`.
- [ ] **Step 6: Run GREEN**; `buildShipAbilities.test.ts` shape assertion for Chakara; guards green; `tsc`+lint. **Commit** `feat(sim): Chakara start-of-round damage hits the highest-Speed enemy in positional`.

---

## Task 7 — Judge + Incinerator (AoE): all matching enemies lose HP (the largest piece)

**Files:** **Modify** `src/utils/combat/triggers.ts` (add `resolveAoEReactiveDamageVictims` + `buildPerVictimConditionCtx`; extend the global-gate scrub `:1938-1943`; replace the Task 5 stub); **Modify** `src/utils/combat/engine.ts` + `triggers.ts` (`livingOpposingActorIds` ctx resolver, bound per-side); **Modify** `src/utils/abilities/buildShipAbilities.ts` (re-target AoE damage abilities to `'all-enemies'`); **Modify** `reactiveDamagePositionalHp.test.ts`, `buildShipAbilities.test.ts`.

- [ ] **Step 1: RED tests (two).**
  - **Judge** (real passive: "At the start of the round, this Unit deals 60% damage to all enemies with less than 50% HP") vs three enemies, two below 50% HP (pre-damage them via a strong player) and one above. Assert **exactly the two <50%-HP enemies** lose HP from Judge (the above-50% one does not), and Judge's `damageDealt` == Σ of the two victims' Judge-attributed `damageTaken` (reconciliation).
  - **Incinerator** (real passive: "At the end of the round, this unit deals 100% damage to all enemies with Inferno") vs two enemies, one afflicted with Inferno (Incinerator's active inflicts it) and one not. Assert **only the Inferno-afflicted** enemy takes the end-of-round hit.
- [ ] **Step 2: Confirm RED** (single dummy hit / no per-victim HP).
- [ ] **Step 3: GREEN — roster enumerator.** Add `livingOpposingActorIds?: (ownerId: string) => string[];` to `ReactiveSideCtx` (`engine.ts:1276`) and `IntentExecContext` (`triggers.ts:~1180`); bind per-side:
  - `playerDrainCtx` (`:6046`): `livingOpposingActorIds: () => enemyAttackerActors.filter((a) => a.destroyedRound === undefined).map((a) => a.id),`
  - `enemyDrainCtx` (`:6073`): the `allPlayerActors` mirror.
  - Ctx assembly (near `:5980`): `livingOpposingActorIds: sideCtx.livingOpposingActorIds,`.
- [ ] **Step 4: GREEN — global-gate scrub (`triggers.ts:1938-1943`).** Extend so per-victim enemy conditions on an `all-enemies` round-boundary reactive damage ability are NOT gated globally (re-checked per victim below), mirroring the `on-hp-threshold-crossed` self-scrub:

```ts
    const scrubbedConditions =
        intent.ability.trigger === 'on-hp-threshold-crossed'
            ? intent.ability.conditions.filter(
                  (c) => !(c.subject === 'hp-threshold' && c.hpSubject === 'self')
              )
            : // SP-M M1: an all-enemies reactive DAMAGE proc re-evaluates its enemy hp-threshold /
              // enemy-effect conditions PER VICTIM in the damage branch — scrub them from the
              // single global drain gate (which reads one enemyHpPct/enemyDebuffNames, the dummy in
              // positional mode) so it neither blocks nor false-passes the whole AoE.
              intent.ability.type === 'damage' && intent.ability.target === 'all-enemies'
              ? intent.ability.conditions.filter(
                    (c) => c.subject !== 'hp-threshold' && c.subject !== 'enemy-debuff'
                )
              : intent.ability.conditions;
```

*(Confirm the exact enemy-effect condition `subject` string during execution — `damageEnemyEffectNamesFromClause`→`enemyEffectConditions` produces it; the scrub filter must match whatever it emits, e.g. `'enemy-debuff'`.)*

- [ ] **Step 5: GREEN — AoE resolver** (`triggers.ts`, replacing the Task 5 stub):

```ts
/** SP-M M1: living opposing victims for an 'all-enemies' reactive DAMAGE proc, filtered by the
 *  ability's per-victim enemy conditions (Judge: hp-threshold <50%; Incinerator: enemy-effect
 *  Inferno). Reuses conditionsMet against a per-victim ConditionContext built from each victim's
 *  live HP% + synthesized DoT/status names (mirrors roundContext.ts's enemyDebuffNames synthesis).
 *  Falls back to [] (no-op) when the roster resolver is absent (unit-test ctx) — never the dummy. */
function resolveAoEReactiveDamageVictims(intent: Intent, ctx: IntentExecContext): string[] {
    const roster = ctx.livingOpposingActorIds?.(intent.ownerId) ?? [];
    const perVictim = intent.ability.conditions.filter(
        (c) => c.subject === 'hp-threshold' || c.subject === 'enemy-debuff'
    );
    return roster.filter((victimId) => {
        if (perVictim.length === 0) return true;
        const victim = ctx.actorById?.(victimId);
        if (!victim) return false;
        const perVictimCtx = buildPerVictimConditionCtx(ctx, intent.ownerId, victim);
        return conditionsMet(perVictim, perVictimCtx);
    });
}
```

Implement `buildPerVictimConditionCtx` by cloning `buildDrainContext(ctx, ownerId)` and overriding `enemyHpPct = 100 * victim.currentHp / recipientMaxHpOf(victim)` and `enemyDebuffNames = synthesized names for victim` (Inferno if `victim.infernoEntries.length > 0`, Corrosion/Bomb analogously — reuse the exact synthesis `roundContext.ts` uses, referenced by the `ConditionContext.enemyDebuffNames` doc `evaluateConditions.ts:20`). Expose the victim's max HP via a ctx accessor if not already reachable (`ctx.effectiveStatsFor(victimId)` gives stats; confirm it carries `hp`, else add a small `recipientMaxHpFor` to the ctx bound to the engine's `recipientMaxHp`).

- [ ] **Step 6: GREEN — parser re-target** (`buildShipAbilities.ts`, after the condition attaches `:1460`): if `out[0]` is a round-boundary reactive damage ability AND it now carries an `hp-threshold`/`enemy-debuff` condition, set `out[0].ability.target = 'all-enemies'`. Disjoint: on-cast damage with the same condition (a damage-bonus gate, not a target filter) must NOT be re-targeted — gate on `trigger` ∈ {start-of-round, end-of-round}. Add `buildShipAbilities.test.ts` shape assertions for Judge/Incinerator (`target:'all-enemies'` + the per-victim condition present).
- [ ] **Step 7: Run both RED tests → GREEN**; guards green; `tsc`+lint. **Watch AoE once-per-round:** `passesOncePerRoundGate` fires once for the whole proc (all victims share one gate draw). **Commit** `feat(sim): Judge/Incinerator round-boundary AoE damage hits all matching enemies in positional`.

---

## Task 8 — Team symmetry sweep (all 8 mechanics, enemy side)

**Files:** **Modify** `reactiveDamagePositionalHp.test.ts` (enemy-side blocks for each mechanic).

- [ ] **Step 1:** For each of FrontLine, Paracelsus, Vindicator, Grif, Rhodium, Chakara, Judge, Incinerator, add a mirror fixture placing the reactive ship on `enemyTeam` and asserting a **player** victim's HP drops (and the enemy reactive ship's `damageDealt` carries it). These pass under the team-agnostic engine (`playerDrainCtx`/`enemyDrainCtx` bind the mirror rosters — `engine.ts:6040-6041/6067-6068`; Task 6/7's new resolvers are bound on BOTH). Any failure surfaces a side-asymmetry to debug (`superpowers:systematic-debugging`).
- [ ] **Step 2: Run GREEN**; `tsc`+lint. **Commit** `test(sim): team-symmetry for all reactive-damage positional HP mechanics`.

---

## Task 9 — Sim golden fixtures + audit moved goldens

**Files:** **Modify** `src/utils/calculators/__tests__/__fixtures__/simGoldenFixtures.ts` (+`reactiveDamagePositional`); **Modify** `src/utils/calculators/__tests__/simGolden.test.ts` (register); **Modify** `src/utils/calculators/__tests__/__snapshots__/simGolden.test.ts.snap` (inspected, not `-u`'d).

- [ ] **Step 1:** Add `reactiveDamagePositional` following the existing construction pattern (verbatim skill text, `placement`, crit ~50, `rounds:8`), covering a `counterTargetId` mechanic AND an AoE mechanic — e.g. a Judge + an Incinerator + FrontLine vs a positioned enemy roster — so per-victim AoE HP + reconciliation are visible.
- [ ] **Step 2:** Register in `simGolden.test.ts`'s `it.each`; run once to WRITE the snapshot; **inspect by hand** (correct victims decline; owners' `damageDealt` carries it; reconciliation holds).
- [ ] **Step 3:** Run the full suite. **Audit any moved pre-existing golden** — any fixture containing one of the eight ships now shows real reactive HP. Diff each moved line, confirm it's a genuine behaviour change (real enemy takes reactive damage → possibly earlier death), record in the commit body. Never accept an unexplained golden move.
- [ ] **Step 4:** Confirm the `simGolden.test.ts` reconciliation invariant passes on the new fixture. **Commit** `test(sim): golden fixture for positional reactive-damage HP` (+ audited golden moves in the body).

---

## Task 10 — F1 pin retire + changelog + verification gate

**Files:** **Modify** `docs/superpowers/notes/2026-07-13-f1-attribution-audit.md` (§5b 2nd bullet / carry-forward #3); **Modify** `src/constants/changelog.ts:8`.

- [ ] **Step 1: Pin retire.** Amend §5b's second bullet — the reactive `damage` executor now calls `applyVictimDamage` + `roundPerTargetDamage` + `creditDealt` in positional mode for **all eight** mechanics, routing each to its true target (counterTargetId; enemy-most-buffs; enemy-highest-speed; all-enemies-with-condition). Mark "retired by SP-M M1 <date>." Keep historical accuracy (don't delete).
- [ ] **Step 2: Changelog.** Append to `UNRELEASED_CHANGES`:
  > `"Combat sim: reactive damage procs now actually reduce the target's HP in positioned battles and show up in damage dealt and damage taken, instead of being tracked but never applied — and each now hits its correct target: FrontLine's on-enemy-charged-cast hit, Grif's on-cleanse hit, Paracelsus's on-destroyed and Vindicator's on-resist retaliations, Rhodium's end-of-round hit on the enemy with the most buffs, Chakara's start-of-round hit on the highest-Speed enemy, and Judge's / Incinerator's round-boundary hits on every enemy below 50% HP / afflicted with Inferno respectively."`
- [ ] **Step 3: Verification gate** (`superpowers:verification-before-completion`): full `vitest` (green), `tsc --noEmit` (clean), `eslint --max-warnings 0` (clean), `npm run audit:skills` (0/0). Paste outputs into the commit. **Commit** docs + changelog.

---

## Task sequencing & dependencies

1 (baseline) → **2 (engine gate + FrontLine)** → 3 (hpBasisPct) → 4 (Grif) → 5 (Rhodium selector + the drain victim-set loop — introduces `resolveAoEReactiveDamageVictims` seam, stubbed) → 6 (Chakara: new selector primitive) → **7 (Judge/Incinerator AoE — the largest piece; fills the `all-enemies` seam)** → 8 (symmetry) → 9 (goldens) → 10 (pin/changelog/verify). Task 5 introduces the victim-set loop that Task 7 completes; sequence 5→6→7 so each ship's RED test drives its own minimal increment.

---

## Critical files for implementation
- `src/utils/combat/engine.ts` (executor `applyReactiveDamage` `:4504-4597`; edit `:4594-4596`; new `highestSpeedInRoster` + `livingOpposingActorIds` near `:6010-6074`; `ReactiveSideCtx` `:1276`; ctx assembly `:5934-5981`; gate `input.positionalTeamBattle` `:1069`; dummy `enemy`/`dpsEnemyTarget` `:2055`)
- `src/utils/combat/triggers.ts` (damage branch rewrite `:2759-2787`; global-gate scrub `:1938-1950`; new `resolveAoEReactiveDamageVictims`/`buildPerVictimConditionCtx`; selector precedent `:2207-2213`; Grif stamp `:846`; `IntentExecContext` fields `:1150-1320`)
- `src/utils/abilities/buildShipAbilities.ts` (reactive damage ability build `:1099-1116`; condition attach `:1428-1460`; new re-target block after `:1460`)
- `src/types/abilities.ts` (`AbilityTarget` union `:73-83` — add `'enemy-highest-speed'`; damage config `:519-536`) + `src/utils/abilities/evaluateConditions.ts` (`ConditionContext` `enemyHpPct`/`enemyDebuffNames`, `conditionsMet`)
- `src/utils/combat/__tests__/reactiveDamagePositionalHp.test.ts` (NEW — Tasks 2–8) + `simGoldenFixtures.ts` / `simGolden.test.ts` (Task 9)
