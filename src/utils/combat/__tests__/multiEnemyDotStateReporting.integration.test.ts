/**
 * SP-4b-2 D3 — the per-round DoT-state REPORTING fields describe every enemy-side carrier.
 *
 * `RoundData.activeCorrosionStacks` / `activeInfernoStacks` / `activeBombCount` /
 * `activeDoTStates` used to read four module-scope closures (`engine.ts` ~2334) bound ONCE at
 * construction to the vestigial DUMMY actor's containers. DoT APPLICATION and the per-victim TICK
 * both correctly target the real positioned victim's own arrays, so on any positional run the
 * dummy's arrays were never written and all four fields froze at 0 / [] — a state-reporting
 * split-brain, measured: `enemy-1.infernoEntries` carried [{stacks:1,tier:15}] on a round the row
 * reported `activeInfernoStacks: 0`, with `summary.totalDamage` byte-identical either way.
 *
 * THE MULTI-ENEMY DESIGN CALL THIS FILE PINS. On a board with several positioned enemies these
 * fields are BOARD-WIDE:
 *   - the three counts SUM across every enemy-side carrier. Stacks and bomb counts are EXTENSIVE
 *     quantities (they add). This is deliberately NOT the `finalHpPct` treatment — HP% is an
 *     INTENSIVE per-actor ratio, which is why it had to become an HP-weighted remainder (#318);
 *     weighting a COUNT would yield a number that is neither the board total nor any one actor's
 *     real stack count.
 *   - `activeDoTStates` is the UNION of every carrier's entries — the one lossless answer for a
 *     list. Grouping stays TYPE-MAJOR (all carriers' corrosion, then inferno, then bombs, then
 *     generic) so the single-carrier shape is byte-identical and type-filtering consumers (the
 *     `extend-dot` readers) are unaffected.
 * Reporting only `enemyAttackers[0]` — the defect class this epic has hit repeatedly — is
 * explicitly rejected: the fixtures below seed ASYMMETRIC values, so a first-enemy-only read
 * produces a demonstrably different number than the asserted sum.
 *
 * SEEDING. Containers are pre-seeded per enemy through the `__testTapActors` construction hook
 * (the same technique `perVictimEnemyDetonation.integration.test.ts` uses), because what changed
 * is the REPORTING read, not the application path — seeding isolates the read under test from the
 * separate question of which victims a cast can fan a DoT out to. The naturally-applied
 * single-carrier path is covered by the RED tests in `dpsSimulator.test.ts`.
 *
 * ENEMY-SIDE MIRROR. There is none to construct: these four fields are a PLAYER-perspective row
 * describing the ENEMY side, and `RoundData` carries no enemy-perspective twin of them (its
 * nearest relative, `enemyStatuses`, is names-only and already keyed per real enemy actor). The
 * mirror obligation is discharged by stating that, not by inventing a field.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { ActiveDoTStack, PendingBomb, CombatActor } from '../state';
import type { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

const HUGE_HP = 1_000_000_000;

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });

/** A seeded DoT stack. `sourceId` is the focus attacker so the per-victim tick can resolve an
 *  applier ctx once the focus has acted. */
const dot = (tier: number, stacks: number, remainingRounds: number): ActiveDoTStack => ({
    stacks,
    tier,
    remainingRounds,
    sourceId: 'attacker',
});

/** A seeded bomb whose countdown is far from 0, so it never bursts inside the window. */
const bomb = (stacks: number): PendingBomb => ({
    countdown: 9,
    damagePerStack: 1,
    stacks,
    tier: 100,
    sourceId: 'attacker',
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A positioned, ZERO-OFFENSE enemy: attack 0 makes it RNG-stream-inert (SP-1's narrowed lesson —
 *  a positioned enemy only perturbs the stream once it ACTS offensively), so adding a second one
 *  cannot shift any draw the assertions depend on. `hp` is overridable so a fixture can decide
 *  which carrier dies and when. */
const inertEnemy = (id: string, position: Position, hp = HUGE_HP): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp,
            speed: 50,
        },
        chargeCount: 0,
        startCharged: false,
        position,
    }) as EnemyAttacker;

/** The anchor cell alone (range MUST be 0 — see DEFAULT_BASE_PATTERN). */
const singleCell = (): ParsedPattern => ({ raw: 'single', shape: 'base', range: 0, modifiers: {} });

/** A single-target damage cast, so the fixture below kills exactly one carrier. */
const damageKit = (multiplier: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'md1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier },
                } as Ability,
            ],
        },
    ],
});

/** Focus attacker with no damage skill: the row's DoT-state fields are the only thing under test,
 *  and a zero-damage focus keeps every enemy alive for the whole window. */
const BASE: Omit<CombatEngineInput, 'shipSkills'> = {
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: HUGE_HP,
    numRounds: 1,
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
    hp: HUGE_HP,
    speed: 100,
    hacking: 200,
    enemySecurity: 0,
};

/** Run one round against a positioned roster, seeding each named actor's containers at
 *  construction. Returns the single assembled row. */
const runSeeded = (
    enemies: EnemyAttacker[],
    seed: (byId: Map<string, CombatActor>) => void,
    overrides: Partial<CombatEngineInput> = {}
) =>
    runCombat({
        ...BASE,
        shipSkills: { slots: [] },
        position: 'M1',
        target: frontTarget(),
        enemyAttackers: enemies,
        __testTapActors: (actors) => seed(new Map(actors.map((a) => [a.id, a]))),
        ...overrides,
    }).rounds[0];

describe('SP-4b-2 D3: DoT-state reporting follows the real enemy carriers', () => {
    it('sums the counts across BOTH positioned enemies, not just the first', () => {
        const row = runSeeded([inertEnemy('e1', 'M4'), inertEnemy('e2', 'M3')], (byId) => {
            // ASYMMETRIC on purpose: an `enemyAttackers[0]`-only read would report 2 / 1 / 1
            // instead of the asserted 5 / 4 / 3, so this fixture cannot pass by accident.
            byId.get('e1')!.corrosionEntries.push(dot(9, 2, 5));
            byId.get('e1')!.infernoEntries.push(dot(15, 1, 5));
            byId.get('e1')!.pendingBombs.push(bomb(1));
            byId.get('e2')!.corrosionEntries.push(dot(9, 3, 5));
            byId.get('e2')!.infernoEntries.push(dot(30, 3, 5));
            byId.get('e2')!.pendingBombs.push(bomb(2));
        });

        expect(row.activeCorrosionStacks).toBe(2 + 3);
        expect(row.activeInfernoStacks).toBe(1 + 3);
        // activeBombCount counts ENTRIES, not stacks (it always has — `pendingBombs.length`).
        expect(row.activeBombCount).toBe(2);
    });

    it('unions activeDoTStates across both enemies, type-major', () => {
        const row = runSeeded([inertEnemy('e1', 'M4'), inertEnemy('e2', 'M3')], (byId) => {
            byId.get('e1')!.corrosionEntries.push(dot(9, 2, 5));
            byId.get('e1')!.infernoEntries.push(dot(15, 1, 5));
            byId.get('e2')!.corrosionEntries.push(dot(3, 4, 5));
            byId.get('e2')!.infernoEntries.push(dot(30, 3, 5));
        });

        // Type-major: both carriers' corrosion first (board order e1, e2), then both infernos.
        // `ticksRemaining` is 4, not the seeded 5: each carrier's own per-victim tick ran this
        // round before the row was assembled — which is exactly the live state the field should
        // report, and independently proves the read is NOT the frozen dummy array.
        expect(row.activeDoTStates).toEqual([
            { type: 'corrosion', tier: 9, stacks: 2, ticksRemaining: 4 },
            { type: 'corrosion', tier: 3, stacks: 4, ticksRemaining: 4 },
            { type: 'inferno', tier: 15, stacks: 1, ticksRemaining: 4 },
            { type: 'inferno', tier: 30, stacks: 3, ticksRemaining: 4 },
        ]);
    });

    it('a DoT on the SECOND enemy alone is reported (the first-enemy-only read would say 0)', () => {
        const row = runSeeded([inertEnemy('e1', 'M4'), inertEnemy('e2', 'M3')], (byId) => {
            byId.get('e2')!.corrosionEntries.push(dot(9, 7, 5));
        });

        expect(row.activeCorrosionStacks).toBe(7);
        expect(row.activeDoTStates).toEqual([
            { type: 'corrosion', tier: 9, stacks: 7, ticksRemaining: 4 },
        ]);
    });

    it('a NON-positional run still reports the dummy sink (legacy path unchanged)', () => {
        // No `enemyAttackers` → the dummy `enemy` is the sole opponent and stays in the turn
        // order, exactly as before this fix. The carrier list is then [enemy], so the reads are
        // byte-identical to the old closure.
        const row = runCombat({
            ...BASE,
            shipSkills: { slots: [] },
            __testTapActors: (actors) => {
                const dummy = actors.find((a) => a.id === 'enemy')!;
                dummy.corrosionEntries.push(dot(9, 6, 5));
                dummy.pendingBombs.push(bomb(1));
            },
        }).rounds[0];

        expect(row.activeCorrosionStacks).toBe(6);
        expect(row.activeBombCount).toBe(1);
        expect(row.activeDoTStates).toEqual([
            { type: 'corrosion', tier: 9, stacks: 6, ticksRemaining: 4 },
            { type: 'bomb', tier: 100, stacks: 1, ticksRemaining: 8 },
        ]);
    });

    /**
     * Task-14 finding 3 — A CORPSE IS NOT STANDING STATE.
     *
     * Nothing clears a DoT container on death (`recordDestroyed` only stamps `destroyedRound`),
     * and a destroyed positioned enemy is `continue`d at the top of the turn loop BEFORE its
     * DoT-tick prologue. So a killed carrier's stacks freeze at their death-round values: they
     * deal nothing, never expire, and — before this filter — kept being summed into every
     * remaining round's row. On a multi-enemy board that is a permanent phantom.
     *
     * The fixture below is the direct measurement: identical seeding, one carrier killed at the
     * start of round 2, and the reported totals drop by exactly that carrier's contribution while
     * the SURVIVOR's entries keep ticking. Without the filter round 2 would still read 5 / 4 / 2
     * and list four entries, with the dead carrier's `ticksRemaining` frozen at its round-1 value.
     */
    it("drops a killed enemy's stacks from the round it dies, keeping the survivor's ticking", () => {
        // Captured at construction so the death can be asserted directly on the actor.
        let e1Actor: CombatActor | undefined;
        const rounds = runCombat({
            ...BASE,
            attack: 1000,
            // 2100 HP against a 1000-damage single-target cast: alive after round 1 (1100 left),
            // destroyed during round 2. So round 1 measures BOTH carriers and round 2 measures the
            // survivor alone — the drop is observed within one run, not across two fixtures.
            shipSkills: damageKit(100),
            position: 'M1',
            target: frontTarget(),
            pattern: singleCell(),
            numRounds: 3,
            enemyAttackers: [inertEnemy('e1', 'M4', 2100), inertEnemy('e2', 'M3')],
            __testTapActors: (actors) => {
                const byId = new Map(actors.map((a) => [a.id, a]));
                e1Actor = byId.get('e1');
                // Long remainingRounds so nothing expires inside the window — every change in the
                // reported numbers is the death, not an expiry.
                byId.get('e1')!.corrosionEntries.push(dot(9, 2, 20));
                byId.get('e1')!.infernoEntries.push(dot(15, 1, 20));
                byId.get('e1')!.pendingBombs.push(bomb(1));
                byId.get('e2')!.corrosionEntries.push(dot(9, 3, 20));
                byId.get('e2')!.infernoEntries.push(dot(30, 3, 20));
                byId.get('e2')!.pendingBombs.push(bomb(2));
            },
        }).rounds;

        // Round 1 — both alive: the board-wide sums of D3.
        expect(rounds[0].activeCorrosionStacks).toBe(2 + 3);
        expect(rounds[0].activeInfernoStacks).toBe(1 + 3);
        expect(rounds[0].activeBombCount).toBe(2);

        // e1 really did die in round 2 — otherwise the rounds below would be a vacuous repeat of
        // round 1 — and its containers really are still populated (nothing clears them on death),
        // which is what makes the filter the only reason they stop being reported.
        expect(e1Actor?.destroyedRound).toBe(2);
        expect(e1Actor!.corrosionEntries.length).toBeGreaterThan(0);

        // Rounds 2 and 3 — e1 is a corpse: only e2's stacks are reported, and they are the SAME
        // numbers e2 contributed above (2/3 corrosion → 3, 1/3 inferno → 3, 2 bombs → 1).
        for (const row of [rounds[1], rounds[2]]) {
            expect(row.activeCorrosionStacks).toBe(3);
            expect(row.activeInfernoStacks).toBe(3);
            expect(row.activeBombCount).toBe(1);
            expect(row.activeDoTStates.map((s) => s.type)).toEqual([
                'corrosion',
                'inferno',
                'bomb',
            ]);
        }

        // The survivor's entries are still LIVE — `ticksRemaining` keeps counting down after the
        // other carrier died, so the filter removed a corpse rather than freezing the whole read.
        const survivorCorrosion = (i: number) =>
            rounds[i].activeDoTStates.find((s) => s.type === 'corrosion')!.ticksRemaining;
        expect(survivorCorrosion(2)).toBe(survivorCorrosion(1) - 1);
    });
});
