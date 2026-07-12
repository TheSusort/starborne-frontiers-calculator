/**
 * SP-0 Task 3 — RNG stream locality fixture.
 *
 * A tiny 3-round positional battle: one player ship (P1, front M4 — the focus 'attacker')
 * vs two enemies, E1 (front T4) and E2 (back T1). P1's active skill targets 'front', which
 * `resolvePositionalTarget` resolves to the highest-column living enemy (col 4 = front) —
 * so P1 ALWAYS attacks E1, NEVER E2 (see `src/utils/combat/positionalBinding.ts`). E1 and E2
 * both attack 'front' on the player side, which only ever has one candidate (P1) — so E1/E2's
 * OWN targeting is unaffected by which variant of E1 is used.
 *
 * `baseLocalityInput` gives E1 a plain single-clause damage skill (one crit-gate draw per own
 * turn). `withExtraE1Draw` gives E1 the SAME damage clause plus a real, parser-supported
 * "inflicts <debuff> for N turns" secondary clause (an 'inflict'-type debuff — verb "inflicts",
 * NOT "applies" — see `verbToApplication` in `src/utils/skillTextParser.ts`), which draws E1's
 * OWN `debuffLandingGate` (keyed `${e1.id}:landing`) once per E1 turn IN ADDITION to its crit
 * draw. The debuff targets P1 (E1's only opposing candidate) — it never touches E2's actor,
 * gates, or aggregate state, so it is gameplay-inert to E2 by construction:
 *   - E1 and E2 are on the SAME side (both enemies) — the debuff is enemy-targeted (hits the
 *     PLAYER side), never routed to an ally (E2).
 *   - Turn order is fixed by static speed values, unaffected by the debuff.
 *   - E1's and E2's RateGate streams are keyed by their own actor id (`${actorId}:${purpose}`,
 *     SP-0 Task 3) — E1's extra `landing` draw lives on a stream E2 never reads from.
 *
 * Intermediate crit (50) on both enemies exercises the RNG rather than pinning it to always/
 * never fire. HP (100_000) vastly exceeds any plausible 3-round damage total from a single
 * ~3000-attack opponent, so nothing dies and the round-by-round roster stays stable.
 */
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';
import { BattlePlacement, BattleSimulationInput } from '../../../calculators/battleSimulator';

const BASIC_ACTIVE = 'This Unit deals <unit-damage>100% damage</unit-damage>.';

// Real, parser-supported secondary clause (verb "inflicts" → 'inflict'-type application,
// i.e. resistible via the hacking-vs-security landing gate — NOT the affinity-based 'apply'
// path, which never draws a gate). See skillTextParser.test.ts's canonical
// "This Unit inflicts <unit-skill>Defense Down II</unit-skill> for N turns" fixtures.
const ACTIVE_WITH_DEBUFF =
    'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.';

const playerShip = (): Ship => ({
    id: 'p1',
    name: 'P1',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 100_000,
        attack: 3000,
        defence: 0,
        hacking: 100,
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
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
});

const enemyShip = (opts: { id: string; name: string; activeSkillText: string }): Ship => ({
    id: opts.id,
    name: opts.name,
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 100_000,
        attack: 3000,
        defence: 0,
        hacking: 100,
        security: 100,
        // Intermediate crit — exercises the crit RateGate rather than pinning it to
        // always/never (brief requirement).
        crit: 50,
        critDamage: 50,
        speed: 90,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: opts.activeSkillText,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
});

const placement = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: ship.baseStats.attack,
        crit: ship.baseStats.crit,
        critDamage: ship.baseStats.critDamage,
        defensePenetration: 0,
        hacking: ship.baseStats.hacking,
        defence: ship.baseStats.defence,
        hp: ship.baseStats.hp,
        speed: ship.baseStats.speed,
    },
});

/** Baseline: E1 has a plain single-clause damage skill (one crit-gate draw per own turn). */
export function baseLocalityInput(): BattleSimulationInput {
    const e1 = enemyShip({ id: 'e1', name: 'E1', activeSkillText: BASIC_ACTIVE });
    const e2 = enemyShip({ id: 'e2', name: 'E2', activeSkillText: BASIC_ACTIVE });
    return {
        playerTeam: [placement(playerShip(), 'M4')],
        // T4 = column 4 = front (P1's 'front' target always resolves here); T1 = column 1 = back.
        enemyTeam: [placement(e1, 'T4'), placement(e2, 'T1')],
        rounds: 3,
    };
}

/** Perturbed: E1 additionally inflicts a debuff on its target every turn, drawing ONE extra
 *  gate (its own `debuffLandingGate`) per E1 turn. E2 is untouched — same skill, same position,
 *  same stats as the baseline. Under keyed RNG streams, E2's per-round damage must be identical
 *  in both inputs. */
export function withExtraE1Draw(): BattleSimulationInput {
    const e1 = enemyShip({ id: 'e1', name: 'E1', activeSkillText: ACTIVE_WITH_DEBUFF });
    const e2 = enemyShip({ id: 'e2', name: 'E2', activeSkillText: BASIC_ACTIVE });
    return {
        playerTeam: [placement(playerShip(), 'M4')],
        enemyTeam: [placement(e1, 'T4'), placement(e2, 'T1')],
        rounds: 3,
    };
}
