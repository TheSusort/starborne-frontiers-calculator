/**
 * Ship-kit Wave 7 — parser trigger classification (production path via buildShipAbilities).
 *
 * Two distinct bomb-detonation semantics previously collapsed onto ONE trigger
 * (`on-bomb-detonated`):
 *   - Demolisher: "When a Bomb explodes on an enemy …" — VICTIM-scoped, fires on any bomb bursting
 *     on the opposing side.  → stays `on-bomb-detonated`.
 *   - Lingshe: "When this Unit detonates a Bomb …" — DETONATOR-scoped, fires only when THIS unit
 *     actively causes a detonation.  → new `on-self-bomb-detonated`.
 *
 * #345 later split a THIRD reading out of the same trigger: Valkyrie's "When an Echoing Burst
 * explodes on an enemy …" is not about the Bomb DoT at all (an Echoing Burst is an
 * accumulate-then-detonate container) → APPLIER-scoped `on-own-echoing-burst-detonated`.
 *
 * Separately, Warden's "when this Unit inflicts a Debuff, it inflicts Out. Damage Down II" was
 * mis-parsed as `on-cast` (the existing recognizer only matched the gerund "inflicting/applying",
 * not the present-tense "inflicts"), landing it in a passive-slot enemy-timed path that the engine
 * never dispatches. It must route to the existing reactive `on-debuff-inflicted` trigger.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { detectReactiveTrigger } from '../../skillTextParser';
import type { Ship } from '../../../types/ship';

// Verbatim from docs/ship-skills.csv.
const WARDEN_PASSIVE_R2 =
    'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.<br /><br />Additionally, when this Unit inflicts a <unit-skill>Debuff</unit-skill>, it inflicts <unit-skill>Out. Damage Down II</unit-skill> for 1 turn.';
const LINGSHE_PASSIVE_R4 =
    'When this Unit detonates a <unit-skill>Bomb</unit-skill> it gains <unit-skill>Stealth</unit-skill> for 2 turn.<br /><br />\n\nThis Unit deals 1% more detonation damage per 10% crit power it has.';
const DEMOLISHER_PASSIVE_R2 =
    "When a Bomb explodes on an enemy, this Unit <unit-aid>removes 2 charges</unit-aid> from the enemy's Charged Skill and deals <unit-damage>100% of the Bomb's damage</unit-damage> to all adjavent enemies. This damage ignores Defense and cannot result in a critical hit.";

const shipWith = (over: Partial<Ship>): Ship =>
    ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}], // R4 — the highest passive applies
        ...over,
    }) as Ship;

const wardenShip = (): Ship =>
    shipWith({
        activeSkillText:
            'This Unit deals <unit-damage>165% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.',
        secondPassiveSkillText: WARDEN_PASSIVE_R2,
    });

const lingsheShip = (): Ship =>
    shipWith({
        activeSkillText:
            'This Unit inflicts 3 stacks of <unit-skill>Bomb I</unit-skill> for 4 turns.',
        thirdPassiveSkillText: LINGSHE_PASSIVE_R4,
    });

const demolisherShip = (): Ship =>
    shipWith({
        activeSkillText:
            'This Unit deals <unit-damage>170% damage</unit-damage> and inflicts <unit-skill>Bomb III</unit-skill> for 2 turns.',
        secondPassiveSkillText: DEMOLISHER_PASSIVE_R2,
    });

const passiveAbilities = (ship: Ship) =>
    buildShipAbilities(ship).slots.find((s) => s.slot === 'passive')?.abilities ?? [];

describe('Wave 7 parser — bomb-detonation trigger split', () => {
    it("Lingshe's Stealth self-buff rides the DETONATOR-scoped on-self-bomb-detonated trigger", () => {
        const stealth = passiveAbilities(lingsheShip()).find(
            (a) => a.type === 'buff' && a.config.type === 'buff' && a.config.buffName === 'Stealth'
        );
        expect(stealth).toBeDefined();
        expect(stealth!.trigger).toBe('on-self-bomb-detonated');
    });

    it("Demolisher's splash damage stays VICTIM-scoped on on-bomb-detonated (regression)", () => {
        const splash = passiveAbilities(demolisherShip()).find((a) => a.type === 'damage');
        expect(splash).toBeDefined();
        expect(splash!.trigger).toBe('on-bomb-detonated');
    });

    it("Demolisher's charge-removal stays VICTIM-scoped on on-bomb-detonated (regression)", () => {
        const charge = passiveAbilities(demolisherShip()).find((a) => a.type === 'charge');
        expect(charge).toBeDefined();
        expect(charge!.trigger).toBe('on-bomb-detonated');
    });

    it('detectReactiveTrigger: "detonates a Bomb" → on-self-bomb-detonated', () => {
        expect(
            detectReactiveTrigger(
                'When this Unit detonates a Bomb it gains Stealth for 2 turn.',
                'Stealth'
            )
        ).toBe('on-self-bomb-detonated');
    });

    it('detectReactiveTrigger: "bomb explodes on an enemy" → on-bomb-detonated', () => {
        expect(
            detectReactiveTrigger(
                'When a Bomb explodes on an enemy, this Unit gains Stealth for 2 turns.',
                'Stealth'
            )
        ).toBe('on-bomb-detonated');
    });
});

describe('Wave 7 parser — Warden self-inflicted-debuff reactive', () => {
    it("Warden's Out. Damage Down II rides on-debuff-inflicted (not on-cast)", () => {
        const debuff = passiveAbilities(wardenShip()).find(
            (a) =>
                a.type === 'debuff' &&
                a.config.type === 'debuff' &&
                a.config.buffName === 'Out. Damage Down II'
        );
        expect(debuff).toBeDefined();
        expect(debuff!.trigger).toBe('on-debuff-inflicted');
    });

    it('detectReactiveTrigger: present-tense "when this Unit inflicts a Debuff" → on-debuff-inflicted', () => {
        expect(
            detectReactiveTrigger(
                'When this Unit inflicts a Debuff, it inflicts Out. Damage Down II for 1 turn.',
                'Out. Damage Down II'
            )
        ).toBe('on-debuff-inflicted');
    });
});
