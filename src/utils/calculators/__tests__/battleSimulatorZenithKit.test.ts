/**
 * battleSimulatorZenithKit.test.ts — Zenith's refit-active passive on the REAL production path
 * (SimulatorPage → battleSimulator.ts → runCombat), built from its verbatim `docs/ship-skills.csv`
 * text rather than hand-injected abilities.
 *
 * The engine-level behaviour of each clause is proven in its own integration file
 * (`shieldGatedStasisExemption.integration.test.ts`, `allyShieldCountScaling.integration.test.ts`).
 * What THIS file adds is the threading: `buildShipAbilities` must fold the clause onto `ShipSkills`
 * and `simulateBattle` must carry it onto the engine actor. A dropped thread is invisible to both
 * of the other files — exactly the gap `battleSimulatorDefenseSubstitution.test.ts` was written to
 * close for Meatshield.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../rateAccumulator';
import { simulateBattle, BattlePlacement, BattleSimulationInput } from '../battleSimulator';
import type { Ship, Refit } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

beforeEach(() => setRateGateRng(() => 0.999999)); // never crit — deterministic single-hit damage
afterEach(() => resetRateGateRng());

/** Zenith's R4 refit-active passive, verbatim from `docs/ship-skills.csv` (`grep '^Zenith,'`). */
const ZENITH_P4 =
    'When this Unit has a <unit-aid>shield</unit-aid> its attacks do not reduce <unit-skill>Stasis</unit-skill>. <br /><br />\nAt the start of each round this Unit gains a <unit-damage>shield equal to 50%</unit-damage> of its attack.<br /><br />\nThis Unit deals <unit-damage>8% more direct damage</unit-damage> for each ally with a shield.';

/** Zenith's active, verbatim from the same row. */
const ZENITH_ACTIVE =
    'This Unit deals <unit-damage>230% damage</unit-damage> and <unit-aid>removes 1 charge</unit-aid> from the enemy charged skill.';

const FOUR_REFITS: Refit[] = [
    { id: 'r1', stats: [] },
    { id: 'r2', stats: [] },
    { id: 'r3', stats: [] },
    { id: 'r4', stats: [] },
];

const BASIC_ACTIVE = 'This Unit deals <unit-damage>100% damage</unit-damage>.';
const STASIS_ACTIVE =
    'This Unit deals <unit-damage>1% damage</unit-damage> and inflicts <unit-skill>Stasis</unit-skill> for 8 turns.';

interface ShipSpec {
    id: string;
    name: string;
    attack: number;
    speed: number;
    hp?: number;
    hacking?: number;
    activeTarget?: string;
    activeSkillText: string;
    thirdPassiveSkillText?: string;
}

const mkShip = (spec: ShipSpec): Ship => ({
    id: spec.id,
    name: spec.name,
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: spec.hp ?? 1_000_000_000,
        attack: spec.attack,
        defence: 0,
        hacking: spec.hacking ?? 0,
        security: 0,
        crit: 0,
        critDamage: 0,
        speed: spec.speed,
    },
    equipment: {},
    implants: {},
    refits: spec.thirdPassiveSkillText ? FOUR_REFITS : [],
    affinity: 'antimatter',
    activeSkillText: spec.activeSkillText,
    activeTarget: spec.activeTarget ?? 'front',
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
    ...(spec.thirdPassiveSkillText ? { thirdPassiveSkillText: spec.thirdPassiveSkillText } : {}),
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

const STRIKER_ATTACK = 20_000;

/** A harmless focus placeholder, so Zenith can be tested from a WALKED-TEAM slot as well as the
 *  focus slot — `simulateBattle` threads the two through different branches. It only ever repairs
 *  itself, so its cast resolves no opposing victim and cannot break anyone's Stasis. */
const bystanderFocus = (): Ship =>
    mkShip({
        id: 'bystander',
        name: 'Bystander',
        attack: 0,
        speed: 1,
        activeTarget: 'self',
        activeSkillText: 'This Unit <unit-aid>repairs itself</unit-aid> for 1% of its Max HP.',
    });

/**
 * Turn order: freezer (400) → striker (350) → Zenith (300) → victim (100).
 *
 * Round 1 the freezer inflicts Stasis(8) on the enemy victim and the striker kills the freezer
 * (hp 1, front column), so the Stasis is applied exactly ONCE. From round 2 the front-most living
 * player is Zenith, so the striker's 20,000-point hit lands on it before its own turn.
 *
 * `zenithAttack` is the ONLY axis, and it is the shield axis: the round-start grant is 50% of
 * attack, so 10,000 attack ⇒ a 5,000 pool the striker empties, and 1,000,000 attack ⇒ a 500,000
 * pool that survives. The engine's Stasis break is DEFERRED (it lands on the victim's own skip),
 * so a broken victim resumes acting a round or two later — the observable is WHETHER it ever acts
 * inside the run: 8 turns of Stasis outlast 6 rounds of the natural post-turn decrement alone.
 */
const battle = (
    zenithAttack: number,
    zenithSlot: 'focus' | 'team' = 'focus'
): BattleSimulationInput => ({
    playerTeam: [
        ...(zenithSlot === 'team' ? [placement(bystanderFocus(), 'B1')] : []),
        placement(
            mkShip({
                id: 'zenith',
                name: 'Zenith',
                attack: zenithAttack,
                speed: 300,
                activeSkillText: ZENITH_ACTIVE,
                thirdPassiveSkillText: ZENITH_P4,
            }),
            'M3'
        ),
        placement(
            mkShip({
                id: 'freezer',
                name: 'Freezer',
                attack: 1,
                speed: 400,
                hp: 1,
                hacking: 100_000,
                activeSkillText: STASIS_ACTIVE,
            }),
            'M4'
        ),
    ],
    enemyTeam: [
        placement(
            mkShip({
                id: 'victim',
                name: 'Victim',
                attack: 1_000,
                speed: 100,
                activeSkillText: BASIC_ACTIVE,
            }),
            'M4'
        ),
        placement(
            mkShip({
                id: 'striker',
                name: 'Striker',
                attack: STRIKER_ATTACK,
                speed: 350,
                activeSkillText: BASIC_ACTIVE,
            }),
            'M1'
        ),
    ],
    rounds: 6,
});

/** Rounds in which the stasised enemy victim dealt damage — i.e. rounds it was not locked. */
const victimActiveRounds = (
    zenithAttack: number,
    zenithSlot: 'focus' | 'team' = 'focus'
): number[] => {
    const result = simulateBattle(battle(zenithAttack, zenithSlot));
    const victimId = result.roster.find((r) => r.name === 'Victim')?.actorId;
    if (!victimId) throw new Error('victim not on the roster');
    return result.rounds
        .filter((r) => (r.ships.find((s) => s.actorId === victimId)?.damageDealt ?? 0) > 0)
        .map((r) => r.round);
};

describe('simulateBattle — Zenith: shield-gated Stasis exemption reaches the engine', () => {
    it('while its round-start shield outlasts the incoming hit, Zenith never frees the stasised enemy', () => {
        // 1,000,000 attack ⇒ a 500,000 shield each round; the striker's 20,000 cannot empty it.
        expect(victimActiveRounds(1_000_000)).toEqual([]);
    });

    it('when that shield is emptied first, the very same Zenith starts freeing it', () => {
        // 10,000 attack ⇒ a 5,000 shield the striker's 20,000 empties before Zenith's own turn.
        // Everything else — the freezer, the victim, the striker, the board — is unchanged.
        expect(victimActiveRounds(10_000).length).toBeGreaterThan(0);
    });

    it('the same holds from a WALKED-TEAM slot, which is a different threading branch', () => {
        // `simulateBattle` builds the focus actor and the team actors in separate branches, each
        // with its own copy of the ShipSkills→engine field list. Proving one says nothing about
        // the other.
        expect(victimActiveRounds(1_000_000, 'team')).toEqual([]);
        expect(victimActiveRounds(10_000, 'team').length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------------------------
// "8% more direct damage for each ally with a shield" on the same production path.
// ---------------------------------------------------------------------------------------------

/** Crucialis's start-of-combat self shield, verbatim shape — a real parsed clause, so the allies'
 *  pools come from the same pipeline Zenith's own do. */
const START_OF_COMBAT_SHIELD =
    'This Unit gains <unit-aid>Shield</unit-aid> equal to <unit-damage>25%</unit-damage> of its Max HP at the start of combat.';

const damageBattle = (shieldedAllies: number): BattleSimulationInput => ({
    playerTeam: [
        placement(
            mkShip({
                id: 'zenith',
                name: 'Zenith',
                attack: 10_000,
                speed: 300,
                activeSkillText: ZENITH_ACTIVE,
                thirdPassiveSkillText: ZENITH_P4,
            }),
            'M4'
        ),
        ...Array.from({ length: shieldedAllies }, (_, i) =>
            placement(
                mkShip({
                    id: `buddy${i}`,
                    name: `Buddy${i}`,
                    attack: 0,
                    speed: 10,
                    activeSkillText: BASIC_ACTIVE,
                    thirdPassiveSkillText: START_OF_COMBAT_SHIELD,
                }),
                (['M3', 'M2', 'M1', 'B1'] as Position[])[i]
            )
        ),
    ],
    enemyTeam: [
        placement(
            mkShip({
                id: 'bag',
                name: 'Bag',
                attack: 0,
                speed: 1,
                activeSkillText: BASIC_ACTIVE,
            }),
            'M4'
        ),
    ],
    rounds: 1,
});

const zenithRoundOneDamage = (shieldedAllies: number): number => {
    const result = simulateBattle(damageBattle(shieldedAllies));
    return result.rounds[0].ships.find((s) => s.actorId === 'attacker')?.damageDealt ?? 0;
};

describe('simulateBattle — Zenith: per-shielded-ally damage scaling reaches the engine', () => {
    it('alone, Zenith still counts ITSELF — and each shielded ally adds another step', () => {
        const alone = zenithRoundOneDamage(0);
        expect(alone).toBeGreaterThan(0);
        // 1 step (itself) → 3 steps (itself + two shielded allies): 1.24 / 1.08.
        expect(zenithRoundOneDamage(2) / alone).toBeCloseTo(1.24 / 1.08, 3);
        // 1 → 5 steps: the owner's "+40% with five shielded ships" figure.
        expect(zenithRoundOneDamage(4) / alone).toBeCloseTo(1.4 / 1.08, 3);
    });
});
