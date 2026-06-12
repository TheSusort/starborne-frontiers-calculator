import { describe, it, expect } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { TeamActorInput, CombatStatBlock } from '../../../types/calculator';
import { Ability, ShipSkills } from '../../../types/abilities';

// --- Fixture builders (mirrors teamWalk.test.ts) ---------------------------

const damageAbility = (multiplier: number, id = 'dmg'): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** An ally-targeted charge ability (target 'all-allies') — bumps every player actor. */
const allyChargeAbility = (amount: number, id = 'ac'): Ability => ({
    id,
    type: 'charge',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'charge', amount },
});

/** A self-targeted charge ability (no reach to the attacker) — the control. */
const selfChargeAbility = (amount: number, id = 'sc'): Ability => ({
    id,
    type: 'charge',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'charge', amount },
});

const teamStats = (overrides: Partial<CombatStatBlock> = {}) => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    hacking: 250,
    defence: 0,
    hp: 0,
    ...overrides,
});

const walkedTeam = (
    shipSkills: ShipSkills,
    overrides: Partial<TeamActorInput> = {}
): TeamActorInput => ({
    id: 't1',
    speed: 150, // faster than the attacker (100) → acts first each round
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills,
    stats: teamStats(),
    ...overrides,
});

const baseInput = (overrides: Partial<DPSSimulationInput> = {}): DPSSimulationInput => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 100_000_000,
    rounds: 6,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: { slots: [{ slot: 'active', abilities: [damageAbility(100)] }] },
    hacking: 250,
    enemySecurity: 100,
    ...overrides,
});

// The Hayyan pattern: the ally-charge grant rides the CHARGED skill (not the active one).
// A team ship started charged fires its charged skill round 1; that skill's all-allies charge
// ability must grant charges to the attacker on that charged turn. Before the gate
// generalization the cast-path ally-charge grant only fired on `action === 'active'`, so a
// charged-skill grant never reached anyone.
describe('ally-charge grant on a charged turn (Hayyan)', () => {
    // Hayyan-shaped granter: startCharged so its CHARGED skill fires round 1; the charged slot
    // carries an all-allies +charge ability. High chargeCount so it only fires charged once
    // (the round-1 grant is the signal). Attacker: chargeCount 3 + a charged damage ability —
    // its charged round should arrive a round EARLIER with the round-1 ally-charge grant.
    const attackerCharged: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [damageAbility(50, 'aa')] },
            { slot: 'charged', abilities: [damageAbility(400, 'ac')] },
        ],
    };

    const hayyan = (chargedGrant: Ability): TeamActorInput =>
        walkedTeam(
            {
                slots: [
                    { slot: 'active', abilities: [damageAbility(50, 'ha')] },
                    { slot: 'charged', abilities: [damageAbility(50, 'hc'), chargedGrant] },
                ],
            },
            {
                id: 'thayyan',
                speed: 150,
                chargeCount: 5,
                startCharged: true, // charged skill fires round 1
            }
        );

    // The attacker's first charged round (directDamage > 2× the active hit) arrives EARLIER
    // when Hayyan's charged-skill all-allies grant fires on round 1.
    const firstChargedRound = (rounds: { directDamage: number }[]): number =>
        rounds.findIndex((r) => r.directDamage > rounds[0].directDamage * 2);

    it("fires the all-allies charge grant on Hayyan's charged turn, advancing the attacker's charge", () => {
        // +2 to all allies on round 1 → attacker (chargeCount 3) reaches charged a round sooner.
        const withGrant = simulateDPS(
            baseInput({
                shipSkills: attackerCharged,
                chargeCount: 3,
                teamActors: [hayyan(allyChargeAbility(2, 'hgrant'))],
                rounds: 8,
            })
        );
        // Control: identical Hayyan ship but the charged-skill grant is SELF-only (no reach to
        // the attacker) → the attacker charges at its natural cadence.
        const withoutGrant = simulateDPS(
            baseInput({
                shipSkills: attackerCharged,
                chargeCount: 3,
                teamActors: [hayyan(selfChargeAbility(2, 'hself'))],
                rounds: 8,
            })
        );

        expect(firstChargedRound(withGrant.rounds)).toBeGreaterThanOrEqual(0);
        expect(firstChargedRound(withoutGrant.rounds)).toBeGreaterThanOrEqual(0);
        expect(firstChargedRound(withGrant.rounds)).toBeLessThan(
            firstChargedRound(withoutGrant.rounds)
        );
    });
});
