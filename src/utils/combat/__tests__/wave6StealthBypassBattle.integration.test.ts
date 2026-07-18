/**
 * Ship-kit Wave 6, Task 5 — battleSimulator end-to-end wiring: a per-slot
 * `config.ignoresStealth` (Task 1, parsed from a real "This attack can target Stealthed
 * enemies." clause) must flow all the way through `simulateBattle` → `planPlacement`'s
 * derived `activeIgnoresStealth`/`chargedIgnoresStealth` → the stamped `ParsedTarget`
 * (`withStealthBypass`) fed to the engine's positional resolver (`resolvePositionalTarget`,
 * Task 3), which skips the Stealth visibility filter for that cast.
 *
 * Setup (mirrors `battleSimulatorDefenseSubstitution.test.ts`'s real-ship-text harness):
 *   - One player focus attacker ('attacker'), SLOW (speed 1), single-target 'front' active.
 *   - Two positioned enemies: 'front' (M4, the board's front-most cell, FAST speed 200) casts
 *     a real self-buff active ("This Unit gains <unit-skill>Stealth</unit-skill> for 2
 *     turns.") that lands on ITS OWN turn — which, being fastest, resolves before the slow
 *     focus attacker's turn within round 1 (mirrors `stealthedEnemyCountScaling.integration
 *     .test.ts`'s speed-ordering recipe, here driven through real skill text instead of a
 *     hand-built ability). 'back' (M1) is a plain, never-Stealthed enemy.
 *   - Deterministic: `setRateGateRng` pins non-crit, single fixed round.
 *
 * Two focus-ship variants, otherwise byte-identical:
 *   - CONTROL: plain "100% damage" active, front selection. Stealth filters M4 out of the
 *     candidate set → 'front' resolves to the only visible cell, M1 — the visible enemy takes
 *     the hit, the Stealthed one takes none.
 *   - BYPASS: same active PLUS "This attack can target Stealthed enemies." → `parseIgnoresStealth`
 *     stamps `config.ignoresStealth` on the built damage ability → `planPlacement`'s
 *     `activeIgnoresStealth` derives true → `withStealthBypass` stamps `ParsedTarget
 *     .ignoresStealth` on the focus's `target` → the resolver skips the Stealth filter
 *     entirely → 'front' resolves to the true front-most cell, M4 — the STEALTHED enemy takes
 *     the hit, the visible one takes none.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import {
    simulateBattle,
    BattlePlacement,
    BattleSimulationInput,
} from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

beforeEach(() => setRateGateRng(() => 0.999999)); // never crit — deterministic single-hit damage
afterEach(() => resetRateGateRng());

const BASIC_ACTIVE = 'This Unit deals <unit-damage>100% damage</unit-damage>.';
const BYPASS_ACTIVE =
    'This Unit deals <unit-damage>100% damage</unit-damage>.<br />This attack can target <unit-aid>Stealthed</unit-aid> enemies.';
const STEALTH_SELF_BUFF_ACTIVE = 'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns.';

const focusShip = (activeSkillText: string): Ship => ({
    id: 'focus',
    name: 'Focus',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 1_000_000,
        attack: 10_000,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        // SLOW — both enemies act before the focus within round 1, so the front enemy's own
        // Stealth self-cast has already landed by the time the focus's turn/target is resolved.
        speed: 1,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
});

// The front-most enemy (M4): FAST, casts a real self-buff Stealth grant on its own turn.
const stealthedFrontEnemy = (): Ship => ({
    id: 'front',
    name: 'Front',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 1_000_000,
        attack: 0, // zero-offense — the focus's HP/turn order is irrelevant to this assertion.
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 200,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: STEALTH_SELF_BUFF_ACTIVE,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
});

// The back-most enemy (M1): plain, never Stealthed, zero-offense.
const visibleBackEnemy = (): Ship => ({
    id: 'back',
    name: 'Back',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 1_000_000,
        attack: 0,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 50,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: BASIC_ACTIVE,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
});

const placement = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: ship.baseStats.attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: ship.baseStats.hacking,
        defence: ship.baseStats.defence,
        hp: ship.baseStats.hp,
        speed: ship.baseStats.speed,
    },
});

const runBattle = (activeSkillText: string): ReturnType<typeof simulateBattle> => {
    const input: BattleSimulationInput = {
        playerTeam: [placement(focusShip(activeSkillText), 'M4')],
        enemyTeam: [
            placement(stealthedFrontEnemy(), 'M4'), // front-most cell — highest column, col 4
            placement(visibleBackEnemy(), 'M1'), // back-most cell — lowest column, col 1
        ],
        rounds: 1,
    };
    return simulateBattle(input);
};

const damageTakenR1 = (result: ReturnType<typeof simulateBattle>, actorId: string): number => {
    const row = result.rounds[0].ships.find((s) => s.actorId === actorId);
    if (!row) throw new Error(`no round-1 row for actorId "${actorId}"`);
    return row.damageTaken;
};

const FRONT_ID = 'e:front:0';
const BACK_ID = 'e:back:1';

describe('simulateBattle — Wave 6 stealth-bypass wiring (battleSimulator → engine)', () => {
    it('CONTROL (no bypass): the Stealthed front enemy is untouched — the visible back enemy is hit', () => {
        const result = runBattle(BASIC_ACTIVE);
        expect(damageTakenR1(result, FRONT_ID)).toBe(0);
        expect(damageTakenR1(result, BACK_ID)).toBeGreaterThan(0);
    });

    it('BYPASS: the Stealthed front enemy takes the hit — the visible back enemy is untouched', () => {
        const result = runBattle(BYPASS_ACTIVE);
        expect(damageTakenR1(result, FRONT_ID)).toBeGreaterThan(0);
        expect(damageTakenR1(result, BACK_ID)).toBe(0);
    });
});
