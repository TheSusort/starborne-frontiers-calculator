/**
 * Critical-review fix (post SP-F F5, commit be86b1f6): Meatshield's defense-substitution
 * invariant — "a DEFENDER victim must NOT be substituted" — silently failed in the app's
 * PRIMARY production path (SimulatorPage → battleSimulator.ts → runCombat), because
 * `simulateBattle` never threaded `PlacementPlan.role` onto the engine actors it builds
 * (`teamActors` / `enemyAttackers` / the focus actor). `roleByActorId` was therefore empty
 * for every real Simulator run, and the engine's OLD unknown-role default (substitute unless
 * PROVEN DEFENDER) meant a Meatshield would substitute a real Defender ally's damage too.
 *
 * This file exercises the REAL production surface end-to-end: a Ship carrying Meatshield's
 * verbatim R4 refit-active passive text (parsed via `skillTextParser`/`buildShipAbilities`,
 * NOT hand-injected like `defenseSubstitution.test.ts`), run through `simulateBattle` itself
 * — proving (a) role now reaches the engine from the real placement pipeline and (b) the
 * DEFENDER/non-defender split is now correctly observed on that path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../rateAccumulator';
import { simulateBattle, BattlePlacement, BattleSimulationInput } from '../battleSimulator';
import type { Ship, Refit } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { ShipTypeName } from '../../../constants/shipTypes';

beforeEach(() => setRateGateRng(() => 0.999999)); // never crit — deterministic single-hit damage
afterEach(() => resetRateGateRng());

// Meatshield's R4 refit-active passive, verbatim from docs/ship-skills.csv (also used by
// modelCompletenessTriage.test.ts's parser-level probe). Requires refits.length >= 4 to
// resolve as the active passive (getShipSkillRows).
const MEATSHIELD_P4 =
    "At the start of combat, this Unit gains 3 stacks of <unit-skill>Protection</unit-skill>.<br /><br />Any damage this Unit takes from <unit-skill>Protection</unit-skill> is transformed into a <unit-aid>Damage over Time effect</unit-aid> for 2 turns.<br /><br />Any direct damage dealt to a non-defender ally that is not transferred by <unit-skill>Protection</unit-skill> is dealt as if that ally had this Unit's defense.";

const FOUR_REFITS: Refit[] = [
    { id: 'r1', stats: [] },
    { id: 'r2', stats: [] },
    { id: 'r3', stats: [] },
    { id: 'r4', stats: [] },
];

const BASIC_ACTIVE = 'This Unit deals <unit-damage>100% damage</unit-damage>.';

const meatshieldShip = (): Ship => ({
    id: 'meatshield',
    name: 'Meatshield',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 100_000,
        attack: 0,
        defence: 5000, // high — the substituted defence value non-defender allies inherit.
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: FOUR_REFITS, // unlocks the R4 passive (getShipSkillRows: refitCount >= 4).
    affinity: 'antimatter',
    activeSkillText: BASIC_ACTIVE,
    activeTarget: 'back',
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
    thirdPassiveSkillText: MEATSHIELD_P4,
});

/** An ally ship at the board's front (targeted by the enemy's `front` selection below).
 *  `role` drives the R4 clause's "non-defender ally" gate end-to-end. */
const allyShip = (role: ShipTypeName): Ship => ({
    id: 'ally',
    name: 'Ally',
    rarity: 'legendary',
    faction: 'MPL',
    type: role,
    baseStats: {
        hp: 100_000,
        attack: 0,
        defence: 200, // low — its OWN defence, used only if substitution does NOT apply.
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: BASIC_ACTIVE,
    activeTarget: 'back',
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
});

const enemyShip = (): Ship => ({
    id: 'enemy',
    name: 'Enemy',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 100_000,
        attack: 3000,
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
    activeTarget: 'front', // anchors the front-most (M4) player.
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

/** Ally-only team (player[0] = focus = 'attacker') vs the single enemy, 1 round — the
 *  UNMITIGATED baseline: whatever damage the ally's OWN defence (200) yields. */
const allyAloneInput = (role: ShipTypeName): BattleSimulationInput => ({
    playerTeam: [placement(allyShip(role), 'M4')],
    enemyTeam: [placement(enemyShip(), 'T1')],
    rounds: 1,
});

/** Ally (front, M4, focus/'attacker') + Meatshield (back, M1) team vs the single enemy. */
const allyWithMeatshieldInput = (role: ShipTypeName): BattleSimulationInput => ({
    playerTeam: [placement(allyShip(role), 'M4'), placement(meatshieldShip(), 'M1')],
    enemyTeam: [placement(enemyShip(), 'T1')],
    rounds: 1,
});

const incomingDamageR1 = (result: ReturnType<typeof simulateBattle>): number => {
    const row = result.rounds[0].ships.find((s) => s.actorId === 'attacker');
    if (!row) throw new Error('no round-1 row for the focus actor');
    return row.incomingDamage;
};

describe('simulateBattle — Meatshield defense-substitution on the REAL production path (Critical fix)', () => {
    it('a DEFENDER ally is NOT substituted: damage taken is IDENTICAL with or without the Meatshield teammate', () => {
        const alone = incomingDamageR1(simulateBattle(allyAloneInput('DEFENDER')));
        const withMeatshield = incomingDamageR1(
            simulateBattle(allyWithMeatshieldInput('DEFENDER'))
        );

        expect(alone).toBeGreaterThan(0);
        expect(withMeatshield).toBeCloseTo(alone, 5);
    });

    it('an ATTACKER (non-defender) ally IS substituted: damage taken drops when the Meatshield teammate is present', () => {
        const alone = incomingDamageR1(simulateBattle(allyAloneInput('ATTACKER')));
        const withMeatshield = incomingDamageR1(
            simulateBattle(allyWithMeatshieldInput('ATTACKER'))
        );

        expect(alone).toBeGreaterThan(0);
        expect(withMeatshield).toBeLessThan(alone);
    });
});
