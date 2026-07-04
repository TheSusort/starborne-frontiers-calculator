import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { Ship } from '../../../types/ship';
import { ShipSkills } from '../../../types/abilities';

// 2 refits → getShipSkillRows selects the Passive R2 row (secondPassiveSkillText).
function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}], ...over } as Ship;
}

// A realistic Selenite-style ship exercising active + charged + passive slots.
// chargeSkillText is REQUIRED for buildShipAbilities to emit a charged slot (no CSV column for it).
const selenite = ship({
    activeSkillText:
        "This Unit deals <unit-damage>200% damage</unit-damage> with additional damage equal to <unit-damage>10%</unit-damage> of this Unit's max HP. If any target is <unit-aid>Stealthed</unit-aid>, it <unit-aid>adds 1 charge</unit-aid> to this Unit's Charged Skill.",
    chargeSkillText: 'This Unit deals <unit-damage>350% damage</unit-damage>.',
    chargeSkillCharge: 4,
    secondPassiveSkillText:
        'Friendly <unit-aid>Stealthed</unit-aid> units deal 40% more direct damage.',
});

function baseInput(shipSkills: ShipSkills): DPSSimulationInput {
    return {
        attack: 15000,
        crit: 100,
        critDamage: 0,
        defensePenetration: 0,
        // Ignored because shipSkills is provided, but the type requires them.
        activeMultiplier: 0,
        chargedMultiplier: 0,
        chargeCount: selenite.chargeSkillCharge!, // 4 — flat sim param, not derived from abilities
        activeDoTs: [],
        chargedDoTs: [],
        enemyDefense: 0,
        enemyHp: 500000,
        rounds: 12,
        selfBuffs: [],
        enemyDebuffs: [],
        defence: 5000,
        hp: 100000, // powers the +10% max-HP additional damage
        shipSkills,
    };
}

describe('parser → simulator integration (real ship)', () => {
    it('composes buildShipAbilities → simulateDPS for active + charged + passive', () => {
        const shipSkills = buildShipAbilities(selenite);

        // Sanity on the parsed model: all three slots present with expected core abilities.
        const active = shipSkills.slots.find((s) => s.slot === 'active');
        const charged = shipSkills.slots.find((s) => s.slot === 'charged');
        const passive = shipSkills.slots.find((s) => s.slot === 'passive');
        expect(active?.abilities.some((a) => a.type === 'damage')).toBe(true);
        expect(active?.abilities.some((a) => a.type === 'additional-damage')).toBe(true);
        expect(active?.abilities.some((a) => a.type === 'charge')).toBe(true);
        expect(charged?.abilities.some((a) => a.type === 'damage')).toBe(true);
        expect(passive?.abilities.some((a) => a.type === 'modifier')).toBe(true);

        const result = simulateDPS(baseInput(shipSkills));

        // 1. Pipeline runs without throwing and returns the requested rounds.
        expect(result.rounds).toHaveLength(12);

        // 2. The parsed active skill drives damage on every active round.
        const activeRounds = result.rounds.filter((r) => r.action === 'active');
        expect(activeRounds.length).toBeGreaterThan(0);
        expect(activeRounds.every((r) => r.directDamage > 0)).toBe(true);

        // 3. Charged cadence fires, and charged rounds (350%) out-hit active rounds (200%).
        const chargedRounds = result.rounds.filter((r) => r.action === 'charged');
        expect(chargedRounds.length).toBeGreaterThan(0);
        const maxActive = Math.max(...activeRounds.map((r) => r.directDamage));
        const minCharged = Math.min(...chargedRounds.map((r) => r.directDamage));
        expect(minCharged).toBeGreaterThan(maxActive);
    });

    it('consumes the parsed additional-damage: removing it lowers active-round damage', () => {
        const full = buildShipAbilities(selenite);

        // Same ship, but strip the additional-damage ability out of every slot.
        const withoutAdditional: ShipSkills = {
            slots: full.slots.map((s) => ({
                ...s,
                abilities: s.abilities.filter((a) => a.type !== 'additional-damage'),
            })),
        };

        const withDD = simulateDPS(baseInput(full)).rounds.find(
            (r) => r.action === 'active'
        )!.directDamage;
        const withoutDD = simulateDPS(baseInput(withoutAdditional)).rounds.find(
            (r) => r.action === 'active'
        )!.directDamage;

        expect(withoutDD).toBeLessThan(withDD);
    });
});

// PR11 (epic PR11): debuff-duration reduction has no single-ship DPS number — the mechanic
// lives entirely in the combat sim's status store (statusEngine), which the DPS calculator
// never touches. This locks that the NEW 'cleanse'/reduce-duration ability the parser now
// emits for Heliodor/Pestilence-shaped ships is fully DPS-inert: total damage output is
// byte-identical with or without it present.
describe('debuff-duration reduction is DPS-inert (PR11 parity)', () => {
    // A synthetic ship pairing a damaging active skill with Heliodor's EXACT verbatim
    // first-passive text (docs/ship-skills.csv) — the reactive heal + duration-reduction pair.
    const heliodorShape = ship({
        activeSkillText: 'This Unit deals <unit-damage>200% damage</unit-damage>.',
        firstPassiveSkillText:
            'When directly damaged, this Unit reduces the duration of all active <unit-aid>Debuffs</unit-aid> on itself by 1 turn and <unit-damage>repairs itself for 8%</unit-damage> of its Max HP.',
    });

    it('parses BOTH the heal and the NEW cleanse/reduce-duration ability from the passive', () => {
        const shipSkills = buildShipAbilities(heliodorShape);
        const passive = shipSkills.slots.find((s) => s.slot === 'passive');
        expect(passive?.abilities.some((a) => a.type === 'heal')).toBe(true);
        expect(
            passive?.abilities.some(
                (a) =>
                    a.type === 'cleanse' &&
                    a.config.type === 'cleanse' &&
                    a.config.mode === 'reduce-duration'
            )
        ).toBe(true);
    });

    it('simulateDPS total damage is IDENTICAL with vs without the reduce-duration ability present', () => {
        const full = buildShipAbilities(heliodorShape);
        const withoutReduction: ShipSkills = {
            slots: full.slots.map((s) => ({
                ...s,
                abilities: s.abilities.filter(
                    (a) =>
                        !(
                            a.type === 'cleanse' &&
                            a.config.type === 'cleanse' &&
                            a.config.mode === 'reduce-duration'
                        )
                ),
            })),
        };

        const input = (skills: ShipSkills): DPSSimulationInput => ({
            attack: 15000,
            crit: 100,
            critDamage: 0,
            defensePenetration: 0,
            activeMultiplier: 0,
            chargedMultiplier: 0,
            chargeCount: 0,
            activeDoTs: [],
            chargedDoTs: [],
            enemyDefense: 0,
            enemyHp: 500000,
            rounds: 10,
            selfBuffs: [],
            enemyDebuffs: [],
            defence: 5000,
            hp: 100000,
            shipSkills: skills,
        });

        const withReduction = simulateDPS(input(full));
        const withoutReductionResult = simulateDPS(input(withoutReduction));

        expect(withReduction.rounds.map((r) => r.directDamage)).toEqual(
            withoutReductionResult.rounds.map((r) => r.directDamage)
        );
        expect(withReduction.summary.totalDamage).toEqual(
            withoutReductionResult.summary.totalDamage
        );
    });
});
