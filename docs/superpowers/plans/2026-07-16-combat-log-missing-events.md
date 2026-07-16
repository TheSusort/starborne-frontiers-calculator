# Combat Log — Surface Four Missing Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make four already-emitted engine events (`buff-expired`, `debuff-resisted`, `shield-destroyed`, `cheat-death-activated`) visible in the rich combat log.

**Architecture:** Pure log-layer work plus one small engine emit-site change. Each event is forwarded via `LOG_EVENT_TYPES`, folded into a `CombatLogEntry` by `buildCombatLog`, and rendered by `RoundEventLog`. The two events that fire inside `applyVictimDamage` (`shield-destroyed`, `cheat-death-activated`) reuse the existing reflect-log defer-flush buffer so they nest under the triggering attack on the positional path. No numeric combat behavior changes; DPS/healing numeric goldens stay byte-identical.

**Tech Stack:** TypeScript, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-combat-log-missing-events-design.md`

## Global Constraints

- **No numeric behavior change.** DPS and healing numeric goldens must remain byte-identical. Only `buildCombatLog`/combat-log snapshots may gain entries, and only deliberately (never `vitest -u` blind — regenerate and eyeball).
- **`npm test` is the full guard** — it also runs the `audit:skills` golden audit. It must end green (audit findings 0).
- **`.env` must exist in the repo root** before running the full suite (husky runs vitest on commit; some `.tsx` tests need it). It is present on this machine; do not delete it.
- **`docs/` is gitignored** — commit doc/spec/plan files with `git add -f`. Code files add normally.
- **Commit trailer:** end each commit message with the repo's `Co-Authored-By` / `Claude-Session` trailer per environment convention.
- **`formatters` in `RoundEventLog.tsx` is a total `Record<CombatLogEntryKind, …>`** — every new kind added to the union MUST get a formatter entry or TypeScript fails to compile.

## File Structure

- `src/utils/combat/log/types.ts` — add four values to `CombatLogEntryKind`.
- `src/utils/combat/log/buildCombatLog.ts` — add four event handlers.
- `src/utils/calculators/battleSimulator.ts` — add three types to `LOG_EVENT_TYPES` (`buff-expired` is already present).
- `src/components/simulator/RoundEventLog.tsx` — add four `colorForKind` cases and four `formatters` entries.
- `src/utils/combat/engine.ts` — add a `pendingConsequenceLogs` buffer drained by `flushReflectLogs`; route the `shield-destroyed` and `cheat-death-activated` emits through it (defer on the positional path, inline otherwise) with a `duringTurnOf` stamp.
- `src/utils/combat/log/__tests__/buildCombatLog.test.ts` — unit tests for the four handlers.
- `src/utils/combat/__tests__/shieldDestroyedCheatDeathLog.integration.test.ts` — new end-to-end test (created in Task 3, extended in Task 4).
- `src/constants/changelog.ts` — one `UNRELEASED_CHANGES` entry.

---

### Task 1: `buff-expired` — status-lifecycle line

Cheapest of the four: `buff-expired` is already in `LOG_EVENT_TYPES`; it just has no `buildCombatLog` handler, so it is silently dropped. Fires at the owner's `turn-ended` (emitted before the `turn-ended` event, so `currentTurn` is still that actor's turn).

**Files:**
- Modify: `src/utils/combat/log/types.ts` (`CombatLogEntryKind`)
- Modify: `src/utils/combat/log/buildCombatLog.ts` (new handler)
- Modify: `src/components/simulator/RoundEventLog.tsx` (color + formatter)
- Test: `src/utils/combat/log/__tests__/buildCombatLog.test.ts`

**Interfaces:**
- Consumes: `CombatEvent` variant `{ type: 'buff-expired'; actorId: string; round: number; buffName: string } & ReactiveStamp` (already defined in `events.ts`).
- Produces: `CombatLogEntry` with `kind: 'buff-expired'`, `note: '<buffName> expired'`.

- [ ] **Step 1: Write the failing test**

Add to `src/utils/combat/log/__tests__/buildCombatLog.test.ts` (inside the top-level `describe('buildCombatLog', …)`):

```ts
it('renders a buff-expired event as a status line in the owner turn', () => {
    const events: CombatEvent[] = [
        ev({ type: 'round-started', round: 1 }),
        ev({ type: 'turn-started', actorId: 'A', round: 1 }),
        ev({ type: 'buff-expired', actorId: 'A', round: 1, buffName: 'Shield Wall' }),
    ];
    const rounds = buildCombatLog(events, roster, initialCharge);
    const entries = rounds[0].turns[0].entries;
    const expired = entries.find((e) => e.kind === 'buff-expired');
    expect(expired).toBeDefined();
    expect(expired!.actorId).toBe('A');
    expect(expired!.note).toBe('Shield Wall expired');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/log/__tests__/buildCombatLog.test.ts -t "buff-expired"`
Expected: FAIL — no entry with `kind === 'buff-expired'` (handler missing; kind not in union).

- [ ] **Step 3: Add the `buff-expired` kind**

In `src/utils/combat/log/types.ts`, extend the `CombatLogEntryKind` union (add after `'bomb'`):

```ts
    | 'bomb'
    | 'buff-expired';
```

- [ ] **Step 4: Add the handler**

In `src/utils/combat/log/buildCombatLog.ts`, add to the `handlers` map (place near the other status handlers, e.g. after `'buff-applied'`):

```ts
    'buff-expired': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'buff-expired',
            actorId: e.actorId,
            targets: [],
            reactions: [],
            note: `${e.buffName} expired`,
        };
        ctx.attachEntry(entry);
    },
```

- [ ] **Step 5: Add color + formatter in the renderer**

In `src/components/simulator/RoundEventLog.tsx`:

Add to `colorForKind`'s muted group (with `cleanse`/`purge`/`charge-changed` before `default`):

```ts
        case 'cleanse':
        case 'purge':
        case 'charge-changed':
        case 'buff-expired':
        default:
            return 'text-theme-text-secondary';
```

Add to the `formatters` map:

```ts
    'buff-expired': noteLine,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/utils/combat/log/__tests__/buildCombatLog.test.ts -t "buff-expired"`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (confirms the new kind has a formatter entry).

- [ ] **Step 8: Commit**

```bash
git add src/utils/combat/log/types.ts src/utils/combat/log/buildCombatLog.ts src/components/simulator/RoundEventLog.tsx src/utils/combat/log/__tests__/buildCombatLog.test.ts
git commit -m "feat: surface buff-expired in the combat log"
```

---

### Task 2: `debuff-resisted` — resisted-infliction line

`debuff-resisted` is emitted (cast-rider resist, immunity, reactive) but is not in `LOG_EVENT_TYPES`, so it never reaches `buildCombatLog`. Render it as a standalone line in the acting turn: *"{source} → {target}: {buffName} resisted"* (or *"{target}: {buffName} resisted"* when `sourceId` is absent).

**Files:**
- Modify: `src/utils/calculators/battleSimulator.ts` (`LOG_EVENT_TYPES`)
- Modify: `src/utils/combat/log/types.ts`
- Modify: `src/utils/combat/log/buildCombatLog.ts`
- Modify: `src/components/simulator/RoundEventLog.tsx`
- Test: `src/utils/combat/log/__tests__/buildCombatLog.test.ts`

**Interfaces:**
- Consumes: `CombatEvent` variant `{ type: 'debuff-resisted'; sourceId?: string; targetId: string; round: number; buffName: string } & ReactiveStamp`.
- Produces: `CombatLogEntry` with `kind: 'debuff-resisted'`, `actorId: sourceId ?? targetId`, `targets: [{ targetId }]`, `note: buffName`.

- [ ] **Step 1: Write the failing tests**

Add to `buildCombatLog.test.ts`:

```ts
it('renders a debuff-resisted event with source and target', () => {
    const events: CombatEvent[] = [
        ev({ type: 'round-started', round: 1 }),
        ev({ type: 'turn-started', actorId: 'A', round: 1 }),
        ev({ type: 'debuff-resisted', sourceId: 'A', targetId: 'B', round: 1, buffName: 'Stun' }),
    ];
    const rounds = buildCombatLog(events, roster, initialCharge);
    const resisted = rounds[0].turns[0].entries.find((e) => e.kind === 'debuff-resisted');
    expect(resisted).toBeDefined();
    expect(resisted!.actorId).toBe('A');
    expect(resisted!.targets[0].targetId).toBe('B');
    expect(resisted!.note).toBe('Stun');
});

it('renders a debuff-resisted event with no source (falls back to target)', () => {
    const events: CombatEvent[] = [
        ev({ type: 'round-started', round: 1 }),
        ev({ type: 'turn-started', actorId: 'A', round: 1 }),
        ev({ type: 'debuff-resisted', targetId: 'B', round: 1, buffName: 'Stun' }),
    ];
    const rounds = buildCombatLog(events, roster, initialCharge);
    const resisted = rounds[0].turns[0].entries.find((e) => e.kind === 'debuff-resisted');
    expect(resisted).toBeDefined();
    expect(resisted!.actorId).toBe('B');
    expect(resisted!.targets[0].targetId).toBe('B');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/combat/log/__tests__/buildCombatLog.test.ts -t "debuff-resisted"`
Expected: FAIL — no `debuff-resisted` entry.

- [ ] **Step 3: Forward the event**

In `src/utils/calculators/battleSimulator.ts`, add to the `LOG_EVENT_TYPES` array (after `'debuff-applied'`):

```ts
    'debuff-applied',
    'debuff-resisted',
```

- [ ] **Step 4: Add the kind**

In `types.ts`, extend `CombatLogEntryKind`:

```ts
    | 'buff-expired'
    | 'debuff-resisted';
```

- [ ] **Step 5: Add the handler**

In `buildCombatLog.ts` `handlers` map (after `'debuff-applied'`):

```ts
    'debuff-resisted': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'debuff-resisted',
            actorId: e.sourceId ?? e.targetId,
            targets: [{ targetId: e.targetId }],
            reactions: [],
            note: e.buffName,
        };
        ctx.attachEntry(entry);
    },
```

- [ ] **Step 6: Add color + formatter**

In `RoundEventLog.tsx`, add `debuff-resisted` to the muted `colorForKind` group (alongside `buff-expired`):

```ts
        case 'charge-changed':
        case 'buff-expired':
        case 'debuff-resisted':
        default:
            return 'text-theme-text-secondary';
```

Add to `formatters` (a small custom formatter — `noteLine` cannot render the target name):

```ts
    'debuff-resisted': (entry, ctx) => {
        const src = ctx.nameOf(entry.actorId);
        const tgt = entry.targets[0] ? ctx.nameOf(entry.targets[0].targetId) : undefined;
        const label = entry.note ? `${entry.note} resisted` : 'resisted';
        return tgt && tgt !== src ? `${src} → ${tgt}: ${label}` : `${src}: ${label}`;
    },
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/utils/combat/log/__tests__/buildCombatLog.test.ts -t "debuff-resisted"`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/utils/calculators/battleSimulator.ts src/utils/combat/log/types.ts src/utils/combat/log/buildCombatLog.ts src/components/simulator/RoundEventLog.tsx src/utils/combat/log/__tests__/buildCombatLog.test.ts
git commit -m "feat: surface debuff-resisted in the combat log"
```

---

### Task 3: `shield-destroyed` — nested attack consequence (engine defer-flush)

`shield-destroyed` fires inside `applyVictimDamage`, which on the positional path runs before the attack's deferred `ability-performed`. Reuse the reflect-log defer-flush buffer so the event is emitted right after the attack entry exists and nests under it. This task introduces the shared `pendingConsequenceLogs` buffer (Task 4 reuses it).

**Files:**
- Modify: `src/utils/combat/engine.ts` (buffer + flush drain + emit site ~`4011`)
- Modify: `src/utils/calculators/battleSimulator.ts` (`LOG_EVENT_TYPES`)
- Modify: `src/utils/combat/log/types.ts`
- Modify: `src/utils/combat/log/buildCombatLog.ts`
- Modify: `src/components/simulator/RoundEventLog.tsx`
- Test: `src/utils/combat/log/__tests__/buildCombatLog.test.ts` (unit/nesting)
- Create: `src/utils/combat/__tests__/shieldDestroyedCheatDeathLog.integration.test.ts` (end-to-end)

**Interfaces:**
- Consumes: `CombatEvent` variant `{ type: 'shield-destroyed'; victimId: string; round: number } & ReactiveStamp`.
- Produces: `CombatLogEntry` with `kind: 'shield-destroyed'`, `actorId: victimId`, `targets: [{ targetId: victimId }]`. When stamped with `duringTurnOf`, nests under the trigger via `routeReaction`.
- Produces (engine, reused by Task 4): `const pendingConsequenceLogs: CombatEvent[]` declared beside `pendingReflectLogs`; drained inside `flushReflectLogs`.

- [ ] **Step 1: Write the failing unit test (nesting under an attack)**

Add to `buildCombatLog.test.ts`:

```ts
it('nests a stamped shield-destroyed under the triggering attack', () => {
    const events: CombatEvent[] = [
        ev({ type: 'round-started', round: 1 }),
        ev({ type: 'turn-started', actorId: 'A', round: 1 }),
        ev({
            type: 'ability-performed',
            actorId: 'A',
            targetId: 'B',
            round: 1,
            abilityType: 'damage',
            damage: 5000,
            didCrit: false,
            didHit: true,
        }),
        ev({ type: 'attacked', actorId: 'A', targetId: 'B', round: 1, damage: 5000, didCrit: false, isPrimaryTarget: true }),
        // Emitted after the attack entry exists (defer-flush), stamped to A's turn.
        ev({ type: 'shield-destroyed', victimId: 'B', round: 1, reactive: true, duringTurnOf: 'A', triggerActorId: 'A' }),
    ];
    const rounds = buildCombatLog(events, roster, initialCharge);
    const attack = rounds[0].turns[0].entries.find((e) => e.kind === 'attack');
    expect(attack).toBeDefined();
    const nested = attack!.reactions.find((r) => r.kind === 'shield-destroyed');
    expect(nested).toBeDefined();
    expect(nested!.actorId).toBe('B');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/log/__tests__/buildCombatLog.test.ts -t "shield-destroyed"`
Expected: FAIL — no `shield-destroyed` entry / kind not in union.

- [ ] **Step 3: Add the kind + handler + renderer**

In `types.ts`, extend `CombatLogEntryKind`:

```ts
    | 'debuff-resisted'
    | 'shield-destroyed';
```

In `buildCombatLog.ts` `handlers` (after `'shield-applied'`):

```ts
    'shield-destroyed': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'shield-destroyed',
            actorId: e.victimId,
            targets: [{ targetId: e.victimId }],
            reactions: [],
        };
        ctx.attachEntry(entry);
    },
```

In `RoundEventLog.tsx`, add a `colorForKind` case with the shield family (cyan):

```ts
        case 'buff':
        case 'shield':
        case 'shield-destroyed':
            return 'text-cyan-400';
```

Add to `formatters`:

```ts
    'shield-destroyed': (entry, ctx) => `${ctx.nameOf(entry.actorId)}'s shield destroyed`,
```

- [ ] **Step 4: Forward the event**

In `battleSimulator.ts` `LOG_EVENT_TYPES` (after `'shield-applied'`):

```ts
    'shield-applied',
    'shield-destroyed',
```

- [ ] **Step 5: Run unit test to verify it passes**

Run: `npx vitest run src/utils/combat/log/__tests__/buildCombatLog.test.ts -t "shield-destroyed"`
Expected: PASS. (`tsc --noEmit` also clean.)

- [ ] **Step 6: Write the failing end-to-end test**

Create `src/utils/combat/__tests__/shieldDestroyedCheatDeathLog.integration.test.ts`. Modeled on `sentinelReactionLog.integration.test.ts` (same `makeShip`/`placement`/`simulateBattle`/`flattenCombatLog` harness). A big player attacker breaks an enemy's start-of-combat self-shield:

```ts
/**
 * End-to-end log visibility for shield-destroyed (Task 3) and cheat-death-activated (Task 4)
 * through the REAL positional sim path (planPlacement -> simulateBattle -> buildCombatLog).
 * These events fire inside applyVictimDamage; the engine buffers them (defer-flush) so they
 * surface nested under the triggering attack rather than out of order.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

const makeShip = (id: string, name: string, over: Partial<Ship> = {}): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'Attacker',
    baseStats: {
        hp: 0, attack: 0, defence: 0, hacking: 0, security: 0, crit: 0, critDamage: 0, speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    ...over,
});

const placement = (
    ship: Ship,
    position: BattlePlacement['position'],
    over: Partial<NonNullable<BattlePlacement['statOverrides']>>
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 1000, crit: 0, critDamage: 100, defensePenetration: 0,
        hacking: 0, defence: 0, hp: 20_000, speed: 100, ...over,
    },
});

const noGear = (): GearPiece | undefined => undefined;

describe('shield-destroyed surfaces in the combat log (real sim path)', () => {
    it('a broken enemy shield appears as a shield-destroyed entry', () => {
        // Enemy seeds a start-of-combat self-shield; a fast, hard-hitting player breaks it.
        const shielded = makeShip('shielded', 'Shielded', {
            secondPassiveSkillText:
                'This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.',
            refits: [{}, {}] as Ship['refits'],
        });
        const breaker = makeShip('breaker', 'Breaker');
        const result = simulateBattle(
            {
                playerTeam: [placement(breaker, 'M2', { attack: 5000, crit: 0, hp: 20_000, speed: 300 })],
                enemyTeam: [placement(shielded, 'M4', { attack: 1, crit: 0, defence: 0, hp: 20_000, speed: 1 })],
                rounds: 2,
            },
            noGear
        );
        const shieldBreaks = flattenCombatLog(result).filter((e) => e.kind === 'shield-destroyed');
        expect(shieldBreaks.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 7: Run the end-to-end test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/shieldDestroyedCheatDeathLog.integration.test.ts`
Expected: FAIL — `shield-destroyed` is not yet buffered/forwarded through the positional path (0 entries).

Note: if 0 shield breaks occur because the shield never fully depletes, raise `breaker` `attack` (e.g. `8000`) or lower `shielded` `hp` until one direct hit exceeds the 25%-of-HP pool. The event requires `byDirectDamage && shieldBefore > 0 && shieldPool === 0`.

- [ ] **Step 8: Implement the engine buffer + emit routing**

In `src/utils/combat/engine.ts`:

(a) Beside `const pendingReflectLogs …` (~line 3580), declare the shared buffer:

```ts
const pendingConsequenceLogs: CombatEvent[] = [];
```

(Confirm `CombatEvent` is imported in `engine.ts`; it is used by the bus. If not, add it to the existing `../events`/`./events` import.)

(b) Inside `flushReflectLogs` (~line 3581–3595), after the reflect loop clears `pendingReflectLogs`, drain the consequence buffer:

```ts
            pendingReflectLogs.length = 0;
            for (const ev of pendingConsequenceLogs) bus.emit(ev);
            pendingConsequenceLogs.length = 0;
```

(c) At the `shield-destroyed` emit site (~line 4010–4012), replace the direct emit with defer-aware routing + stamp:

```ts
            if (cause?.byDirectDamage && shieldBeforeThisAbsorb > 0 && victim.shieldPool === 0) {
                const ev: CombatEvent = {
                    type: 'shield-destroyed',
                    victimId: victim.id,
                    round: r,
                    reactive: true,
                    duringTurnOf: actingActorId,
                    triggerActorId: actingActorId,
                };
                if (deferReflectLogs) pendingConsequenceLogs.push(ev);
                else bus.emit(ev);
            }
```

- [ ] **Step 9: Run the end-to-end + unit tests to verify they pass**

Run: `npx vitest run src/utils/combat/__tests__/shieldDestroyedCheatDeathLog.integration.test.ts`
Expected: PASS.
Run: `npx vitest run src/utils/combat/log/__tests__/buildCombatLog.test.ts -t "shield-destroyed"`
Expected: PASS.

- [ ] **Step 10: Verify the existing shield-destroyed engine test still passes**

The `shield-destroyed` event now carries `reactive`/`duringTurnOf` fields and, on the positional path, is emitted at flush time rather than inline.

Run: `npx vitest run src/utils/combat/__tests__/onAllyShieldDestroyed.test.ts`
Expected: PASS. If an assertion checks the emitted event object with `toEqual` (exact shape) rather than field-by-field, update it to expect the added `reactive: true` / `duringTurnOf` fields (the count-of-events and `victimId` assertions are unaffected — the AEGIS reaction still fires once).

- [ ] **Step 11: Full suite + lint**

Run: `npm test`
Expected: green, `audit:skills` 0. If any combat-log snapshot golden or entry-count assertion moved, confirm the delta is exactly the new `shield-destroyed` entries and regenerate that snapshot deliberately (never blind `-u`).
Run: `npm run lint`
Expected: 0 warnings.

- [ ] **Step 12: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/calculators/battleSimulator.ts src/utils/combat/log/types.ts src/utils/combat/log/buildCombatLog.ts src/components/simulator/RoundEventLog.tsx src/utils/combat/log/__tests__/buildCombatLog.test.ts src/utils/combat/__tests__/shieldDestroyedCheatDeathLog.integration.test.ts
git commit -m "feat: surface shield-destroyed in the combat log (defer-flush nesting)"
```

---

### Task 4: `cheat-death-activated` — nested survival save (reuse the buffer)

`cheat-death-activated` fires in the same `applyVictimDamage` region. Route it through the `pendingConsequenceLogs` buffer introduced in Task 3.

**Files:**
- Modify: `src/utils/combat/engine.ts` (emit site ~`4063`)
- Modify: `src/utils/calculators/battleSimulator.ts` (`LOG_EVENT_TYPES`)
- Modify: `src/utils/combat/log/types.ts`
- Modify: `src/utils/combat/log/buildCombatLog.ts`
- Modify: `src/components/simulator/RoundEventLog.tsx`
- Test: `src/utils/combat/log/__tests__/buildCombatLog.test.ts`
- Modify: `src/utils/combat/__tests__/shieldDestroyedCheatDeathLog.integration.test.ts`

**Interfaces:**
- Consumes: `CombatEvent` variant `{ type: 'cheat-death-activated'; actorId: string; round: number } & ReactiveStamp`.
- Produces: `CombatLogEntry` with `kind: 'cheat-death'`, `actorId`, `targets: [{ targetId: actorId }]`. Reuses `pendingConsequenceLogs` from Task 3.

- [ ] **Step 1: Write the failing unit test**

Add to `buildCombatLog.test.ts`:

```ts
it('nests a stamped cheat-death-activated under the triggering attack', () => {
    const events: CombatEvent[] = [
        ev({ type: 'round-started', round: 1 }),
        ev({ type: 'turn-started', actorId: 'A', round: 1 }),
        ev({
            type: 'ability-performed',
            actorId: 'A', targetId: 'B', round: 1,
            abilityType: 'damage', damage: 9999, didCrit: false, didHit: true,
        }),
        ev({ type: 'attacked', actorId: 'A', targetId: 'B', round: 1, damage: 9999, didCrit: false, isPrimaryTarget: true }),
        ev({ type: 'cheat-death-activated', actorId: 'B', round: 1, reactive: true, duringTurnOf: 'A', triggerActorId: 'A' }),
    ];
    const rounds = buildCombatLog(events, roster, initialCharge);
    const attack = rounds[0].turns[0].entries.find((e) => e.kind === 'attack');
    const nested = attack!.reactions.find((r) => r.kind === 'cheat-death');
    expect(nested).toBeDefined();
    expect(nested!.actorId).toBe('B');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/log/__tests__/buildCombatLog.test.ts -t "cheat-death"`
Expected: FAIL.

- [ ] **Step 3: Add the kind + handler + renderer**

In `types.ts`:

```ts
    | 'shield-destroyed'
    | 'cheat-death';
```

In `buildCombatLog.ts` `handlers`:

```ts
    'cheat-death-activated': (e, ctx) => {
        if (!ctx.currentTurn && !ctx.currentRound) return;
        const entry: CombatLogEntry = {
            kind: 'cheat-death',
            actorId: e.actorId,
            targets: [{ targetId: e.actorId }],
            reactions: [],
        };
        ctx.attachEntry(entry);
    },
```

In `RoundEventLog.tsx`, add a `colorForKind` case (survival save — green):

```ts
        case 'heal':
        case 'cheat-death':
            return 'text-green-400';
```

Add to `formatters`:

```ts
    'cheat-death': (entry, ctx) => `${ctx.nameOf(entry.actorId)} cheats death!`,
```

- [ ] **Step 4: Forward the event**

In `battleSimulator.ts` `LOG_EVENT_TYPES` (near the other reactive/consequence types):

```ts
    'shield-destroyed',
    'cheat-death-activated',
```

- [ ] **Step 5: Run unit test to verify it passes**

Run: `npx vitest run src/utils/combat/log/__tests__/buildCombatLog.test.ts -t "cheat-death"`
Expected: PASS. (`tsc --noEmit` clean.)

- [ ] **Step 6: Add the failing end-to-end case**

Add a second `it` to `shieldDestroyedCheatDeathLog.integration.test.ts` (inside a new or the existing describe — reuse the `makeShip`/`placement`/`noGear` helpers already in the file):

```ts
describe('cheat-death-activated surfaces in the combat log (real sim path)', () => {
    it('a lethal hit on a Cheat-Death carrier appears as a cheat-death entry', () => {
        const survivor = makeShip('survivor', 'Survivor', {
            secondPassiveSkillText:
                'At the start of combat, this Unit gains <unit-skill>Cheat Death</unit-skill>.',
            refits: [{}, {}] as Ship['refits'],
        });
        const killer = makeShip('killer', 'Killer');
        const result = simulateBattle(
            {
                playerTeam: [placement(killer, 'M2', { attack: 9000, crit: 0, hp: 20_000, speed: 300 })],
                enemyTeam: [placement(survivor, 'M4', { attack: 1, crit: 0, defence: 0, hp: 2_000, speed: 1 })],
                rounds: 1,
            },
            noGear
        );
        const saves = flattenCombatLog(result).filter((e) => e.kind === 'cheat-death');
        expect(saves.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/shieldDestroyedCheatDeathLog.integration.test.ts -t "cheat-death"`
Expected: FAIL — `cheat-death-activated` not yet routed through the buffer / forwarded.

- [ ] **Step 8: Implement the engine emit routing**

In `src/utils/combat/engine.ts`, at the `cheat-death-activated` emit site (~line 4063), replace the direct emit:

```ts
                    const ev: CombatEvent = {
                        type: 'cheat-death-activated',
                        actorId: targetId,
                        round: r,
                        reactive: true,
                        duringTurnOf: actingActorId,
                        triggerActorId: actingActorId,
                    };
                    if (deferReflectLogs) pendingConsequenceLogs.push(ev);
                    else bus.emit(ev);
```

- [ ] **Step 9: Run the end-to-end + unit tests to verify they pass**

Run: `npx vitest run src/utils/combat/__tests__/shieldDestroyedCheatDeathLog.integration.test.ts`
Expected: PASS (both shield-destroyed and cheat-death cases).
Run: `npx vitest run src/utils/combat/log/__tests__/buildCombatLog.test.ts -t "cheat-death"`
Expected: PASS.

- [ ] **Step 10: Verify existing cheat-death engine test still passes**

Run: `npx vitest run src/utils/combat/__tests__/applyVictimDamage.characterization.test.ts`
Expected: PASS. The healing-mode scenario is non-positional (`deferReflectLogs` false) → `cheat-death-activated` still emits inline exactly once; it now carries `reactive`/`duringTurnOf` fields. If that test asserts the event with `toEqual`, update it to include the new fields (the `cheated.length === 1` and HP-floor assertions are unaffected).

- [ ] **Step 11: Full suite + lint**

Run: `npm test`
Expected: green, `audit:skills` 0. Confirm any moved combat-log snapshot delta is exactly the new entries; regenerate deliberately.
Run: `npm run lint`
Expected: 0 warnings.

- [ ] **Step 12: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/calculators/battleSimulator.ts src/utils/combat/log/types.ts src/utils/combat/log/buildCombatLog.ts src/components/simulator/RoundEventLog.tsx src/utils/combat/log/__tests__/buildCombatLog.test.ts src/utils/combat/__tests__/shieldDestroyedCheatDeathLog.integration.test.ts
git commit -m "feat: surface cheat-death-activated in the combat log (defer-flush nesting)"
```

---

### Task 5: Changelog

One user-facing changelog line for the whole feature (the project batches changelog entries weekly).

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Add the changelog entry**

In `src/constants/changelog.ts`, add to the `UNRELEASED_CHANGES` array (match the existing entry format — inspect a neighbouring entry first):

```ts
    'Combat log now shows resisted debuffs, expired buffs, destroyed shields, and Cheat Death saves.',
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/constants/changelog.ts
git commit -m "docs: changelog for new combat-log events"
```

---

## Self-Review

**Spec coverage:**
- `buff-expired` → Task 1. ✓
- `debuff-resisted` → Task 2. ✓
- `shield-destroyed` → Task 3 (defer-flush per spec). ✓
- `cheat-death-activated` → Task 4 (defer-flush per spec). ✓
- Shared plumbing (LOG_EVENT_TYPES, handler, kind, color, formatter) → in each task. ✓
- Testing (per-handler unit + end-to-end for the two defer-flush events) → Tasks 1–4. ✓
- Golden discipline (numeric byte-identical, combat-log snapshots regenerated deliberately) → Global Constraints + Steps 11. ✓
- Changelog → Task 5. ✓
- Non-goals (emit-side coverage, Tier-2) → not implemented, correct.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. The one judgement call (raising attack/lowering HP if the shield doesn't break) is bounded with the exact engine condition to satisfy.

**Type consistency:** `CombatLogEntryKind` additions (`'buff-expired'`, `'debuff-resisted'`, `'shield-destroyed'`, `'cheat-death'`) are used identically in `types.ts`, `buildCombatLog.ts` handlers, and `RoundEventLog.tsx` formatters/colors. Note the event type `cheat-death-activated` maps to the entry kind `cheat-death` (event vs. entry names intentionally differ). `pendingConsequenceLogs` is declared in Task 3 and reused in Task 4. `LOG_EVENT_TYPES` gains `debuff-resisted`, `shield-destroyed`, `cheat-death-activated` (not `buff-expired`, already present).

## Execution Handoff

Ready to implement.
