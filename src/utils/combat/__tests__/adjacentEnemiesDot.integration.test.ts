/**
 * Ship-kit Wave 5, Task B2 — engine fan-out for a `target-and-adjacent-enemies` DoT
 * (Asphyxiator active Inferno III, set by Task B1's parser work). Prior to this task,
 * `dotsFromSkill` (applyAbilities.ts) drops the ability's `target` entirely, and the
 * `applyNewDoTs` call site (playerTurn.ts) only ever pushes onto the single resolved
 * primary target's containers — so a splash-scoped DoT lands on the primary target ONLY,
 * never its board-neighbours. This file drives the fix through a real positional battle
 * (`simulateBattle`), mirroring Task A3's debuff fan-out test
 * (`adjacentEnemiesDebuff.integration.test.ts`) for roster/board layout.
 *
 * Board layout (src/utils/targeting/board.ts hex adjacency): the primary target sits at M4
 * (the unique front/col-4 cell in this roster, so single-target `front` selection
 * deterministically picks it). neighbors(M4) = [M3, T3, T4, B3, B4] — nbrA (M3) and nbrB (T3)
 * are real neighbours; `far` (T1) is not (`{q:0,r:0}` vs M4's `{q:2,r:1}` — no hex-adjacency),
 * proving the fan-out doesn't leak to the whole roster.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../../calculators/battleSimulator';
import { runCombat, CombatEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { createEventBus, CombatEvent } from '../events';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import { flattenCombatLog } from '../log/__testutils__/flattenCombatLog';

// Verbatim-shaped phrasing (matches Asphyxiator's real active Inferno III sentence structure:
// "... then inflicts Inferno III for 3 turns on the targeted enemy and all enemies adjacent to
// it."). Parsed via `adjacentEnemyScopeForName` (Task B1) into `target: 'target-and-adjacent-
// enemies'` on the `dot` ability, which `dotsFromSkill` (Task B2 Step 1) turns into
// `splashTarget: 'target-and-adjacent-enemies'` on the DoT application entry.
const SPLASH_INFERNO_TEXT =
    'This Unit deals <unit-damage>1% damage</unit-damage>, then inflicts <unit-skill>Inferno III</unit-skill> for 3 turns on the targeted enemy and all enemies adjacent to it.';

// Baseline: the SAME Inferno III DoT with plain `target: 'enemy'` (no adjacency phrase) — used
// for the DPS-invariance byte-identical comparison.
const PLAIN_INFERNO_TEXT =
    'This Unit deals <unit-damage>1% damage</unit-damage> and inflicts <unit-skill>Inferno III</unit-skill> for 3 turns.';

const ship = (id: string, over: Partial<Ship>): Ship =>
    ({
        id,
        name: id,
        rarity: 'legendary',
        faction: 'TERRAN_COMBINE',
        type: 'Attacker',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        affinity: 'antimatter',
        activePattern: 'Pattern-Base',
        activeTarget: 'front',
        chargeSkillCharge: 0,
        ...over,
    }) as Ship;

interface Placement {
    ship: Ship;
    position: Position;
    statOverrides: {
        attack: number;
        crit: number;
        critDamage: number;
        defensePenetration: number;
        hacking: number;
        security?: number;
        defence: number;
        hp: number;
    };
}

// hacking 200 vs default security 100 → debuffLandingChance saturates to 1.0, so the shared DoT
// landing roll (roundDebuffLanded, playerTurn.ts) always lands — deterministic, no RNG flake.
const place = (
    s: Ship,
    position: Position,
    attack: number,
    hp: number,
    security?: number
): Placement => ({
    ship: s,
    position,
    statOverrides: {
        attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        ...(security !== undefined ? { security } : {}),
        defence: 0,
        hp,
    },
});

const splashCaster = (id: string): Ship => ship(id, { activeSkillText: SPLASH_INFERNO_TEXT });
const plainCaster = (id: string): Ship => ship(id, { activeSkillText: PLAIN_INFERNO_TEXT });
const dummy = (id: string): Ship =>
    ship(id, { activeSkillText: 'This Unit deals <unit-damage>1% damage</unit-damage>.' });

/** Every `kind: 'dot-applied'` inferno entry attributed to `actorId`, across the whole run —
 *  one entry per landed recipient (emitDotApplied is called once per recipient in the fan-out
 *  loop, same pattern as A3's debuff-applied fan-out). */
const infernoRecipients = (result: ReturnType<typeof simulateBattle>, actorId: string): string[] =>
    flattenCombatLog(result)
        .filter(
            (e) =>
                e.kind === 'dot-applied' && e.actorId === actorId && e.note?.startsWith('inferno')
        )
        .map((e) => e.targets[0]?.targetId)
        .filter((id): id is string => id !== undefined);

/** Every `kind: 'debuff-resisted'` Inferno entry attributed to `actorId` — the resist log line
 *  emitted when a splash DoT fails its per-neighbour landing roll (note carries the dotResistLabel
 *  'Inferno III'). */
const infernoResisted = (result: ReturnType<typeof simulateBattle>, actorId: string): string[] =>
    flattenCombatLog(result)
        .filter(
            (e) =>
                e.kind === 'debuff-resisted' &&
                e.actorId === actorId &&
                e.note?.startsWith('Inferno')
        )
        .map((e) => e.targets[0]?.targetId)
        .filter((id): id is string => id !== undefined);

describe('Ship-kit W5 Task B2: target-and-adjacent-enemies Inferno DoT fan-out (positional, player caster)', () => {
    const run = (caster: Ship) =>
        simulateBattle({
            playerTeam: [place(caster, 'M4', 1000, 1e9)],
            enemyTeam: [
                place(dummy('tgt'), 'M4', 1, 1e9), // primary target (unique front cell)
                place(dummy('nbrA'), 'M3', 1, 1e9), // neighbour of M4
                place(dummy('nbrB'), 'T3', 1, 1e9), // neighbour of M4
                place(dummy('far'), 'T1', 1, 1e9), // NOT a neighbour of M4
            ],
            rounds: 1,
        });

    const TGT = 'e:tgt:0';
    const NBR_A = 'e:nbrA:1';
    const NBR_B = 'e:nbrB:2';
    const FAR = 'e:far:3';

    it('the primary target AND both neighbours accrue Inferno; the non-neighbour does not', () => {
        const result = run(splashCaster('atk'));
        const recipients = infernoRecipients(result, 'attacker');

        expect(recipients).toContain(TGT);
        expect(recipients).toContain(NBR_A);
        expect(recipients).toContain(NBR_B);
        expect(recipients).not.toContain(FAR);
    });
});

/**
 * Per-victim independence (code-review fix, B2): the review found the splash loop nested
 * inside the PRIMARY target's own Block-Debuff-immunity/landing gates, so a neighbour's
 * Inferno depended on the PRIMARY's security and the PRIMARY's single shared landing roll —
 * never the neighbour's own (reintroducing the defect PR #185 fixed for non-DoT debuffs).
 * Here the PRIMARY ('tgt') is given security 300 — hacking 200 vs security 300 clamps
 * debuffLandingChance to 0, so the PRIMARY's shared `roundDebuffLanded()` roll deterministically
 * FAILS (no RNG mocking; same saturation mechanism the `place` helper's default 100 security
 * relies on for a deterministic PASS). Both neighbours keep the default security (100) → their
 * OWN `landsDebuffOnVictim` roll deterministically LANDS. Under the OLD (pre-fix) placement the
 * splash loop lived inside `if (dotsLanded)` — which is false here — so neither neighbour would
 * receive Inferno at all; this assertion is the load-bearing proof the splash is independent.
 */
describe('Ship-kit W5 Task B2: per-victim independence — a neighbour lands Inferno even when the PRIMARY resists', () => {
    const run = (caster: Ship) =>
        simulateBattle({
            playerTeam: [place(caster, 'M4', 1000, 1e9)],
            enemyTeam: [
                place(dummy('tgt'), 'M4', 1, 1e9, 300), // primary target: security 300 → its own landing roll always fails
                place(dummy('nbrA'), 'M3', 1, 1e9), // neighbour of M4, default security → always lands
                place(dummy('nbrB'), 'T3', 1, 1e9), // neighbour of M4, default security → always lands
                place(dummy('far'), 'T1', 1, 1e9), // NOT a neighbour of M4
            ],
            rounds: 1,
        });

    const TGT = 'e:tgt:0';
    const NBR_A = 'e:nbrA:1';
    const NBR_B = 'e:nbrB:2';
    const FAR = 'e:far:3';

    it('the primary resists its own DoT but both neighbours still accrue Inferno independently', () => {
        const result = run(splashCaster('atk'));
        const recipients = infernoRecipients(result, 'attacker');

        expect(recipients).not.toContain(TGT);
        expect(recipients).toContain(NBR_A);
        expect(recipients).toContain(NBR_B);
        expect(recipients).not.toContain(FAR);
    });
});

/**
 * Resisted-splash log visibility (code-review follow-up): a splash DoT that FAILS a neighbour's
 * own landing roll must emit a `debuff-resisted` line for that neighbour, symmetric with the
 * primary-target resist path. Here nbrA (M3) is given security 300 → hacking 200 vs 300 clamps
 * its own `landsDebuffOnVictim` roll to 0 (deterministic FAIL), while the primary (tgt) and nbrB
 * keep default security (100) → LAND. The resisted neighbour must surface a resist event AND must
 * not accrue Inferno.
 */
describe('Ship-kit W5 Task B2: a splash DoT that a neighbour resists emits a per-neighbour resist line', () => {
    const run = (caster: Ship) =>
        simulateBattle({
            playerTeam: [place(caster, 'M4', 1000, 1e9)],
            enemyTeam: [
                place(dummy('tgt'), 'M4', 1, 1e9), // primary target: default security → lands
                place(dummy('nbrA'), 'M3', 1, 1e9, 300), // neighbour: security 300 → its own roll FAILS
                place(dummy('nbrB'), 'T3', 1, 1e9), // neighbour: default security → lands
                place(dummy('far'), 'T1', 1, 1e9),
            ],
            rounds: 1,
        });

    const TGT = 'e:tgt:0';
    const NBR_A = 'e:nbrA:1';
    const NBR_B = 'e:nbrB:2';

    it('the resisting neighbour gets a debuff-resisted line and no Inferno; the others land', () => {
        const result = run(splashCaster('atk'));
        const recipients = infernoRecipients(result, 'attacker');
        const resisted = infernoResisted(result, 'attacker');

        // The neighbour that resisted surfaces a resist line and does NOT accrue Inferno.
        expect(resisted).toContain(NBR_A);
        expect(recipients).not.toContain(NBR_A);
        // The primary and the other neighbour still land normally.
        expect(recipients).toContain(TGT);
        expect(recipients).toContain(NBR_B);
    });
});

describe('Ship-kit W5 Task B2: team symmetry — an ENEMY-side caster splashes onto its PLAYER-side mirror', () => {
    const run = (caster: Ship) =>
        simulateBattle({
            playerTeam: [
                place(dummy('tgt'), 'M4', 1, 1e9),
                place(dummy('nbrA'), 'M3', 1, 1e9),
                place(dummy('nbrB'), 'T3', 1, 1e9),
                place(dummy('far'), 'T1', 1, 1e9),
            ],
            enemyTeam: [place(caster, 'M4', 1000, 1e9)],
            rounds: 1,
        });

    // player[0] is always the reserved focus id 'attacker'; the rest are `p:<shipId>:<idx>`
    // (battleSimulator.ts's naming convention). The caster is the sole enemy → `e:atk:0`.
    const TGT = 'attacker';
    const NBR_A = 'p:nbrA:1';
    const NBR_B = 'p:nbrB:2';
    const FAR = 'p:far:3';
    const CASTER = 'e:atk:0';

    it('splashes onto the player target AND its neighbours, not the non-neighbour', () => {
        const result = run(splashCaster('atk'));
        const recipients = infernoRecipients(result, CASTER);

        expect(recipients).toContain(TGT);
        expect(recipients).toContain(NBR_A);
        expect(recipients).toContain(NBR_B);
        expect(recipients).not.toContain(FAR);
    });
});

/**
 * DPS invariance: the DPS calculator's single-dummy mode calls `runCombat` DIRECTLY with no
 * `position`/`pattern`/`enemyAttackers`/`mode: 'battle'` — the vestigial `enemy` sink
 * actor is the sole opponent, `targetId` is never threaded, and `adjacentEnemyIdsFor` is never
 * supplied. The splash fan-out's own guard (`targetId !== undefined && adjacentEnemyIdsFor`)
 * means it can never fire here — so a `target-and-adjacent-enemies` Inferno DoT must produce
 * BYTE-IDENTICAL `dot-applied` events to the SAME DoT with plain `target: 'enemy'` (this is the
 * real DPS-page shape; dpsSimulator.ts calls runCombat the same way).
 */
describe('Ship-kit W5 Task B2: DPS invariance (single-dummy, non-positional)', () => {
    const BASE: Omit<CombatEngineInput, 'shipSkills' | 'bus'> = {
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
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
        speed: 100,
        hacking: 200,
        enemySecurity: 0,
    };

    const runDots = (caster: Ship) => {
        const bus = createEventBus();
        const dotsApplied: Extract<CombatEvent, { type: 'dot-applied' }>[] = [];
        bus.on('dot-applied', (e) => dotsApplied.push(e));
        runCombat({ ...BASE, shipSkills: buildShipAbilities(caster), bus });
        return dotsApplied.filter((e) => e.dotType === 'inferno');
    };

    it('target-and-adjacent-enemies produces byte-identical dot-applied events to plain target:enemy', () => {
        const splashApplied = runDots(splashCaster('atk'));
        const plainApplied = runDots(plainCaster('atk'));

        expect(splashApplied.length).toBeGreaterThan(0);
        // Strip the non-deterministic/irrelevant `round` timing dimension isn't needed here —
        // both runs use the identical deterministic BASE, so a straight equality (minus any
        // ReactiveStamp-only fields, none present for a cast-time application) proves the
        // splash-config path is a complete no-op in this mode.
        expect(splashApplied).toEqual(plainApplied);
        // Never lands on anyone but the dummy sink — no splash leakage even by accident.
        expect(splashApplied.every((e) => e.targetId === 'enemy')).toBe(true);
    });
});
