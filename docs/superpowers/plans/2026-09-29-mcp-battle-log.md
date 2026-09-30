# MCP `battle_log` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new read-only MCP tool `battle_log` that replays one seeded fight and returns its full turn-by-turn combat log as compact text.

**Architecture:** A pure text formatter over the engine's existing `CombatLogRound[]` (`src/utils/combat/log/formatText.ts`), and a tool in `src/mcp/tools/simulate.ts` that builds the board exactly as `simulate_battle` does, runs one `runSeededBattle`, and returns outcome + per-ship totals + the formatted log. Per-ship totals share one helper with `simulate_battle` so the two cannot drift.

**Tech Stack:** TypeScript, zod, vitest, `@modelcontextprotocol/sdk`.

Spec: `docs/superpowers/specs/2026-09-29-mcp-battle-log-design.md`.

## Global Constraints

- Work in the worktree `.claude/worktrees/battle-log` (branch `feat/mcp-battle-log`). `.env`, `docs/` reference data, `node_modules` (symlink) and `.husky/_` are already in place — do NOT delete, move or recreate `.env`.
- Use Node 22: prefix every `npx`/`npm` command with `export PATH="$(ls -d ~/.nvm/versions/node/v22*/bin | tail -1):$PATH";` (Node 20 fails `nodeLoad.test.ts`).
- Never run the Supabase CLI in any form.
- Never run `vitest -u`.
- The husky pre-commit hook runs lint-staged, `tsc --noEmit` and the full test suite; a commit only counts if the hook passed. Do not use `--no-verify` for code commits.
- Code comments: present-tense behaviour contracts only — no task numbers, no change history, no call-site counts (CLAUDE.md "Code Comments").
- Changelog entry, verbatim: `AI assistants: can now read one simulated battle's full turn-by-turn log.`
- Commit message trailer (every commit):
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp
  ```

---

### Task 1: Combat-log text formatter

**Files:**
- Create: `src/utils/combat/log/formatText.ts`
- Test: `src/utils/combat/log/__tests__/formatText.test.ts`

**Interfaces:**
- Consumes: `CombatLogRound`, `CombatLogEntry`, `CombatLogTarget` from `src/utils/combat/log/types.ts` (existing).
- Produces:
  ```ts
  export interface LogRosterEntry { actorId: string; side: 'player' | 'enemy'; name: string; position: string }
  export function formatCombatLogText(combatLog: readonly CombatLogRound[], roster: readonly LogRosterEntry[]): string
  ```
  `BattleResult['roster']` (from `battleSimulator.ts`) is assignable to `readonly LogRosterEntry[]`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/log/__tests__/formatText.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatCombatLogText, type LogRosterEntry } from '../formatText';
import type { CombatLogRound } from '../types';

const roster: LogRosterEntry[] = [
    { actorId: 'p1', side: 'player', name: 'Alpha', position: 'T1' },
    { actorId: 'e1', side: 'enemy', name: 'Beta', position: 'M2' },
];

const snapshot = {
    attack: 1,
    defence: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    speed: 100,
    hacking: 0,
    security: 0,
    currentHp: 1000.4,
    maxHp: 2000,
    shieldPool: 0,
};

const log: CombatLogRound[] = [
    {
        round: 1,
        startOfRound: [
            { kind: 'buff', actorId: 'e1', note: 'Stealth', targets: [{ targetId: 'e1' }], reactions: [] },
        ],
        turns: [
            {
                actorId: 'p1',
                chargeBefore: 0,
                chargeMax: 3,
                statsSnapshot: snapshot,
                entries: [
                    {
                        kind: 'attack',
                        actorId: 'p1',
                        skillName: 'Strike',
                        slot: 'active',
                        targets: [
                            { targetId: 'e1', amount: 1234.6, didCrit: true, didHit: true, resultingHpPct: 61.7 },
                        ],
                        reactions: [
                            {
                                kind: 'heal',
                                actorId: 'e1',
                                targets: [{ targetId: 'e1', amount: 0, overheal: 500.2 }],
                                reactions: [
                                    {
                                        kind: 'charge-changed',
                                        actorId: 'p1',
                                        note: 'charge 0→1 (manip)',
                                        targets: [],
                                        reactions: [],
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        kind: 'attack',
                        actorId: 'p1',
                        targets: [{ targetId: 'ghost', amount: 10, didHit: false }],
                        reactions: [],
                    },
                ],
            },
            {
                actorId: 'e1',
                chargeBefore: 1,
                chargeMax: 2,
                entries: [
                    {
                        kind: 'shield',
                        actorId: 'e1',
                        targets: [{ targetId: 'e1', amount: 300, overshield: 50, shieldWasHit: true }],
                        reactions: [],
                    },
                ],
            },
        ],
        endOfRound: [
            {
                kind: 'reversed-repair',
                actorId: 'e1',
                healerId: 'p1',
                targets: [{ targetId: 'p1', amount: 99.5 }],
                reactions: [],
            },
        ],
    },
];

describe('formatCombatLogText', () => {
    it('renders rounds, turns, targets and nested reactions as indented lines', () => {
        expect(formatCombatLogText(log, roster)).toBe(
            [
                '=== ROUND 1',
                '  [start] buff E.Beta@M2 {Stealth} -> E.Beta@M2',
                '-- TURN P.Alpha@T1 charge 0/3 hp 1000/2000',
                '  attack P.Alpha@T1 "Strike" (active) -> E.Beta@M2 1235 crit [62%]',
                '    heal E.Beta@M2 -> E.Beta@M2 0 overheal 500',
                '      charge-changed P.Alpha@T1 {charge 0→1 (manip)}',
                '  attack P.Alpha@T1 -> ghost 10 miss',
                '-- TURN E.Beta@M2 charge 1/2',
                '  shield E.Beta@M2 -> E.Beta@M2 300 overshield 50 shield hit',
                '  [end] reversed-repair E.Beta@M2 healer P.Alpha@T1 -> P.Alpha@T1 100',
                '',
            ].join('\n')
        );
    });

    it('renders an empty log as an empty string', () => {
        expect(formatCombatLogText([], roster)).toBe('');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$(ls -d ~/.nvm/versions/node/v22*/bin | tail -1):$PATH"; npx vitest run src/utils/combat/log/__tests__/formatText.test.ts`
Expected: FAIL — cannot resolve `../formatText`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/combat/log/formatText.ts`:

```ts
import type { CombatLogEntry, CombatLogRound, CombatLogTarget } from './types';

/** The roster fields the formatter reads. `BattleResult['roster']` satisfies it. */
export interface LogRosterEntry {
    actorId: string;
    side: 'player' | 'enemy';
    name: string;
    position: string;
}

/**
 * The combat log as plain text: one line per entry, reactions indented two spaces under the
 * entry that caused them. Ships print as `P.<name>@<position>` / `E.<name>@<position>` so two
 * ships of one name stay distinct; an id missing from `roster` prints raw. Numbers are rounded.
 * An empty log is an empty string; otherwise the text ends with a newline.
 */
export function formatCombatLogText(
    combatLog: readonly CombatLogRound[],
    roster: readonly LogRosterEntry[]
): string {
    const labels = new Map(
        roster.map((r) => [r.actorId, `${r.side === 'player' ? 'P' : 'E'}.${r.name}@${r.position}`])
    );
    const label = (id: string) => labels.get(id) ?? id;

    const target = (t: CombatLogTarget): string => {
        let text = label(t.targetId);
        if (t.amount !== undefined) text += ` ${Math.round(t.amount)}`;
        if (t.didCrit) text += ' crit';
        if (t.didHit === false) text += ' miss';
        if (t.overheal) text += ` overheal ${Math.round(t.overheal)}`;
        if (t.overshield) text += ` overshield ${Math.round(t.overshield)}`;
        if (t.shieldWasHit) text += ' shield hit';
        if (t.resultingHpPct !== undefined) text += ` [${Math.round(t.resultingHpPct)}%]`;
        return text;
    };

    const lines: string[] = [];
    const entry = (e: CombatLogEntry, depth: number, prefix = ''): void => {
        let text = `${'  '.repeat(depth)}${prefix}${e.kind} ${label(e.actorId)}`;
        if (e.skillName) text += ` "${e.skillName}"`;
        if (e.slot) text += ` (${e.slot})`;
        if (e.note) text += ` {${e.note}}`;
        if (e.healerId) text += ` healer ${label(e.healerId)}`;
        if (e.targets.length > 0) text += ` -> ${e.targets.map(target).join(', ')}`;
        lines.push(text);
        for (const reaction of e.reactions) entry(reaction, depth + 1);
    };

    for (const round of combatLog) {
        lines.push(`=== ROUND ${round.round}`);
        for (const e of round.startOfRound) entry(e, 1, '[start] ');
        for (const turn of round.turns) {
            let header = `-- TURN ${label(turn.actorId)} charge ${turn.chargeBefore}/${turn.chargeMax}`;
            const s = turn.statsSnapshot;
            if (s) header += ` hp ${Math.round(s.currentHp)}/${Math.round(s.maxHp)}`;
            lines.push(header);
            for (const e of turn.entries) entry(e, 1);
        }
        for (const e of round.endOfRound) entry(e, 1, '[end] ');
    }
    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$(ls -d ~/.nvm/versions/node/v22*/bin | tail -1):$PATH"; npx vitest run src/utils/combat/log/__tests__/formatText.test.ts`
Expected: 2 passed. If `tsc` complains that a fixture object is missing a required field of `CombatLogEntry`/`CombatLogTurn`/`StatsSnapshot`, add that field to the fixture with a neutral value (it must not change the expected text) — do not loosen the formatter's types.

- [ ] **Step 5: Commit**

```bash
export PATH="$(ls -d ~/.nvm/versions/node/v22*/bin | tail -1):$PATH"
git add src/utils/combat/log/formatText.ts src/utils/combat/log/__tests__/formatText.test.ts
git commit -m "feat(combat-log): plain-text formatter for the combat log

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```

---

### Task 2: `battle_log` MCP tool, docs and changelog

**Files:**
- Modify: `src/mcp/tools/simulate.ts` (split `CAVEATS`, add `shipTotals` helper, add `battleLog` tool)
- Modify: `src/mcp/registry.ts` (register `battleLog`)
- Modify: `src/mcp/__tests__/registry.test.ts:44-54` (tool-name list)
- Modify: `src/mcp/__tests__/tools.simulate.test.ts` (new `describe('battle_log')`)
- Modify: `src/pages/DocumentationPage.tsx` (MCP "What the Assistant Can Do" list, ~line 4655)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

**Interfaces:**
- Consumes: `formatCombatLogText(combatLog, roster): string` from `src/utils/combat/log/formatText.ts` (Task 1); `runSeededBattle(input, seed, getGearPiece): BattleResult` and `summarizeRun(result, seed): SeedRunSummary` (`perActor: Record<string, ActorTotals>`) from `src/utils/simulator/seededRuns.ts`; `loadBoardData`, `buildBattleInput`, `boardInputShape`, `refineBoards` (existing, in/imported by `simulate.ts`).
- Produces: `export const battleLog: McpTool<...>` named `'battle_log'`, returning
  `{ seed: number; outcome: { winner: 'player' | 'enemy' | 'draw'; rounds: number }; ships: { side; position; name; damage_dealt; damage_taken; healing_done }[]; unsimulated: { ship: string; texts: string[] }[]; log: string }`.

- [ ] **Step 1: Write the failing tests**

In `src/mcp/__tests__/tools.simulate.test.ts`, change the tools import to:

```ts
import { battleLog, simulateBattle, sweepStat } from '../tools/simulate';
```

Add after the `BattleOut` interface:

```ts
interface LogOut {
    seed: number;
    outcome: { winner: string; rounds: number };
    ships: BattleOut['ships'];
    unsimulated: unknown[];
    log: string;
}
```

Append this `describe` block after `describe('simulate_battle', …)`:

```ts
describe('battle_log', () => {
    it('returns one fight with its full log, every line naming a roster ship', async () => {
        const { ctx } = ctxOver(tables());

        const out = (await call(battleLog, vsAtlas('s1', { seed: 7 }), ctx)) as LogOut;

        expect(out.seed).toBe(7);
        expect(['player', 'enemy', 'draw']).toContain(out.outcome.winner);
        expect(out.outcome.rounds).toBeGreaterThan(0);
        expect(out.ships.map((s) => [s.side, s.position, s.name])).toEqual([
            ['player', 'T1', 'Geared'],
            ['enemy', 'T1', 'Atlas'],
        ]);
        expect(out.log.startsWith('=== ROUND 1\n')).toBe(true);
        expect(out.log).toContain('P.Geared@T1');
        expect(out.log).toContain('E.Atlas@T1');
        // A raw engine actor id in place of a label means the roster and the log disagree.
        const lineShape =
            /^(=== ROUND \d+|-- TURN [PE]\..+?@[TMB][1-4] .*|\s+(\[start\] |\[end\] )?[a-z-]+ [PE]\..+?@[TMB][1-4].*)$/;
        for (const line of out.log.split('\n').filter(Boolean)) {
            expect(line).toMatch(lineShape);
        }
    });

    it('is the same fight simulate_battle reports for one run of that seed', async () => {
        const { ctx } = ctxOver(tables());

        for (const seed of [1, 2, 3]) {
            const log = (await call(battleLog, vsAtlas('s1', { seed }), ctx)) as LogOut;
            const sim = (await call(
                simulateBattle,
                vsAtlas('s1', { seed, runs: 1 }),
                ctx
            )) as BattleOut & { outcome: { mean_rounds: number } };

            expect(log.ships).toEqual(sim.ships);
            expect(log.outcome.rounds).toBe(sim.outcome.mean_rounds);
            expect(log.unsimulated).toEqual(sim.unsimulated);
        }
    });

    it('lists squad-leader effects the simulator does not model', async () => {
        const { ctx } = ctxOver(tables());

        const out = (await call(
            battleLog,
            vsAtlas('m1', { player_leader: BRANDISHER }),
            ctx
        )) as LogOut;

        expect(out.unsimulated).toEqual([{ ship: 'Marauder', texts: [BRANDISHER_UNSIMULATED] }]);
    });

    it('takes no runs', () => {
        expect(battleLog.input.safeParse(vsAtlas('s1', { runs: 2 })).success).toBe(false);
    });
});
```

In `src/mcp/__tests__/registry.test.ts`, add `'battle_log',` as the FIRST element of the sorted tool-name array (it sorts before `'get_my_fleet'`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$(ls -d ~/.nvm/versions/node/v22*/bin | tail -1):$PATH"; npx vitest run src/mcp/__tests__/tools.simulate.test.ts src/mcp/__tests__/registry.test.ts`
Expected: FAIL — `battleLog` is not exported; registry list lacks `battle_log`.

Note on `takes no runs`: zod objects strip unknown keys by default, so `safeParse` of an object with `runs` SUCCEEDS unless the schema is `.strict()`. The implementation below makes the input strict. If `boardInputShape`'s board-level `.strict()` breaks the existing `simulate_battle`-shaped fixtures used here (it should not — `vsAtlas` only adds keys you pass), fix the fixture call, not the strictness.

- [ ] **Step 3: Implement the tool**

In `src/mcp/tools/simulate.ts`:

(a) Add imports:

```ts
import { formatCombatLogText } from '../../utils/combat/log/formatText';
import type { BattleResult } from '../../utils/calculators/battleSimulator';
```

and extend the `seededRuns` import to include `summarizeRun` and the `ActorTotals` type:

```ts
import {
    runSeedSet,
    runSeededBattle,
    summarizeRun,
    SimulationDeadlineError,
    type ActorTotals,
} from '../../utils/simulator/seededRuns';
```

(`BattleSimulationInput` is already imported as a type from the same module as `BattleResult`; merge them into one `import type { BattleResult, BattleSimulationInput } from '../../utils/calculators/battleSimulator';`.)

(b) Replace the `CAVEATS` constant with:

```ts
const DATA_CAVEATS = ` An implant stored by its description rather than an id is not read (#578). \`unsimulated\` lists squad-leader effects the simulator does not model; figures are less reliable when it is not empty.`;

const CAVEATS =
    ` One call has about ${SIM_TIME_BUDGET_MS / 1000} seconds; long fights fit fewer battles, and a call that runs out stops with an error saying how many battles finished.` +
    DATA_CAVEATS;
```

(c) Add, after `unsimulatedEffects`:

```ts
/** Per-ship figures in roster order, as every sim tool reports them. */
const shipTotals = (
    roster: BattleResult['roster'],
    totalsById: Record<string, ActorTotals>
) =>
    roster.map((entry) => {
        const totals = totalsById[entry.actorId];
        return {
            side: entry.side,
            position: entry.position,
            name: entry.name,
            damage_dealt: Math.round(totals?.damageDealt ?? 0),
            damage_taken: Math.round(totals?.damageTaken ?? 0),
            healing_done: Math.round(totals?.healingDone ?? 0),
        };
    });
```

(d) In `simulateBattle.run`, replace the inline `ships: aggregate.roster.map(...)` block with:

```ts
            ships: shipTotals(aggregate.roster, aggregate.perActorMean),
```

(e) Add after `simulateBattle`:

```ts
const battleLogInput = z.object(boardInputShape).strict().superRefine(refineBoards);

export const battleLog: McpTool<z.output<typeof battleLogInput>> = {
    name: 'battle_log',
    description:
        "Replay one simulated fight and return its full turn-by-turn log: every turn, attack, heal, shield, buff, debuff, resist, charge change and death, with each reaction indented under the event that caused it. Ships are labelled P.<name>@<position> (yours) and E.<name>@<position> (enemy). Token-intensive: one fight is thousands of tokens, so find the seed worth reading with simulate_battle first. The same board and seed give the same fight simulate_battle reports for that seed. Also returns the outcome and each ship's damage dealt, taken and healing done in this fight." +
        DATA_CAVEATS,
    input: battleLogInput,
    run: async (board, ctx) => {
        const { input, getGearPiece } = buildBattleInput(board, await loadBoardData(board, ctx));
        const result = runSeededBattle(input, board.seed, getGearPiece);
        return {
            seed: board.seed,
            outcome: { winner: result.outcome.winner, rounds: result.outcome.lastRound },
            ships: shipTotals(result.roster, summarizeRun(result, board.seed).perActor),
            unsimulated: (result.preFight?.unsimulated ?? []).map(({ name, texts }) => ({
                ship: name,
                texts,
            })),
            log: formatCombatLogText(result.combatLog, result.roster),
        };
    },
};
```

If `z.object(boardInputShape).strict().superRefine(refineBoards)` fails to type-check because `refineBoards` expects `BoardInput`, mirror exactly how `simulateBattleInput` is declared (it is `z.object({...boardInputShape, runs}).superRefine(refineBoards)`) and only add `.strict()` before `.superRefine`.

In `src/mcp/registry.ts`, change the simulate import to `import { battleLog, simulateBattle, sweepStat } from './tools/simulate';` and add `defineTool(battleLog),` after `defineTool(sweepStat),`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="$(ls -d ~/.nvm/versions/node/v22*/bin | tail -1):$PATH"; npx vitest run src/mcp`
Expected: all MCP tests pass, including the existing `simulate_battle` tests (the `shipTotals` refactor must not change their output).

- [ ] **Step 5: Docs and changelog**

In `src/pages/DocumentationPage.tsx`, in the MCP section's "What the Assistant Can Do" `<ul>`, replace the last `<li>` (the one starting "Run your ships through the combat simulator") with:

```tsx
                                    <li>
                                        Run your ships through the combat simulator against your own
                                        ships or reference ships, and sweep one stat to see where it
                                        stops mattering
                                    </li>
                                    <li>
                                        Replay one simulated fight as a full turn-by-turn log, to
                                        see exactly what each ship did and why
                                    </li>
```

In `src/constants/changelog.ts`, add as the first element of `UNRELEASED_CHANGES`:

```ts
    "AI assistants: can now read one simulated battle's full turn-by-turn log.",
```

- [ ] **Step 6: Full verification**

Run: `export PATH="$(ls -d ~/.nvm/versions/node/v22*/bin | tail -1):$PATH"; npx tsc --noEmit && npx eslint src/mcp src/utils/combat/log src/pages/DocumentationPage.tsx src/constants/changelog.ts && npx vitest run`
Expected: tsc clean, lint clean, full suite green.

- [ ] **Step 7: Commit**

```bash
export PATH="$(ls -d ~/.nvm/versions/node/v22*/bin | tail -1):$PATH"
git add src/mcp src/pages/DocumentationPage.tsx src/constants/changelog.ts
git commit -m "feat(mcp): battle_log tool returns one fight's full turn-by-turn log

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UPzHv8pLkbvSY8pbsJy7Wp"
```
