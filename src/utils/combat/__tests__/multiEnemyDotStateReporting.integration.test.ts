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
import type { ParsedTarget } from '../../targetingParser';
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
 *  cannot shift any draw the assertions depend on. */
const inertEnemy = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: HUGE_HP,
            speed: 50,
        },
        chargeCount: 0,
        startCharged: false,
        position,
    }) as EnemyAttacker;

/** Focus attacker with no damage skill: the row's DoT-state fields are the only thing under test,
 *  and a zero-damage focus keeps every enemy alive for the whole window. */
const BASE: Omit<CombatEngineInput, 'shipSkills'> = {
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
});
