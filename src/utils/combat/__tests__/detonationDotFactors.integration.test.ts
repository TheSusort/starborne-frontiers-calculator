/**
 * A detonation reads the same two DoT-damage factors a tick on that victim reads:
 *  - the victim's own DoT reductions (Voron's "20% less damage from damage over time effects");
 *  - the dealer-side gated bonus (Wildfire's Scorching Radiation Inferno bonus).
 * Run with the subject on both sides.
 *
 * Board: a dealer lays Inferno III (attack 1000) on a durable victim, a detonator then bursts it at
 * 100% power the same round. A tick on the same victim is the control for each factor.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(1));

const INFERNO_TEXT = 'This Unit inflicts <unit-skill>Inferno III</unit-skill> for 3 turns.';
const DETONATE_TEXT =
    'This Unit deals <unit-damage>100% damage</unit-damage> and <unit-skill>detonates</unit-skill> <unit-skill>Inferno</unit-skill> effects with <unit-damage>100%</unit-damage> of their power.';
const SCORCHING_TEXT =
    'This Unit inflicts <unit-skill>Scorching Radiation</unit-skill> for 3 turns.';

interface Measured {
    detonated: number;
    ticked: number;
}

const measure = (
    placement: Placement,
    victimKit: ShipSkills,
    extraAllies: BoardUnit[] = [],
    opts: { dealerAttack?: number; detonatorAttack?: number; rounds?: number } = {}
): Measured => {
    const dealer: BoardUnit = {
        id: 'dealer',
        kit: textKit('Dealer', { active: INFERNO_TEXT }),
        position: 'M4',
        speed: 300,
        attack: opts.dealerAttack ?? 1000,
        hacking: 1e6,
    };
    const detonator: BoardUnit = {
        id: 'detonator',
        kit: textKit('Detonator', { active: DETONATE_TEXT }),
        position: 'M3',
        speed: 200,
        attack: opts.detonatorAttack ?? 1000,
        hacking: 1e6,
    };
    // Lays its stack after the burst, so one stack is left to tick: the control for each factor.
    const late: BoardUnit = {
        id: 'late',
        kit: textKit('Late', { active: INFERNO_TEXT }),
        position: 'M2',
        speed: 100,
        attack: opts.dealerAttack ?? 1000,
        hacking: 1e6,
    };
    const victim: BoardUnit = { id: 'victim', kit: victimKit, position: 'M4', speed: 1, hp: 5e9 };
    const { input, id } = boardInput(
        placement,
        dealer,
        [detonator, late, ...extraAllies],
        [victim],
        opts.rounds ?? 1
    );
    const bus = createEventBus();
    const out: Measured = { detonated: 0, ticked: 0 };
    bus.on('dot-detonated', (e: Extract<CombatEvent, { type: 'dot-detonated' }>) => {
        if (e.targetId === id(victim)) out.detonated += e.damage;
    });
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.targetId === id(victim) && e.dotType === 'inferno') out.ticked += e.damage;
    });
    runCombat({ ...input, bus });
    return out;
};

const voronKit = (withPassives: boolean): ShipSkills => ({
    slots: realKit('Voron').slots.filter((s) => withPassives || s.slot !== 'passive'),
});

describe.each<Placement>(['player', 'enemy'])(
    'detonation DoT factors, dealer on %s',
    (placement) => {
        it("a detonation honours the victim's own DoT reduction (Voron's 20%)", () => {
            const plain = measure(placement, voronKit(false));
            const voron = measure(placement, voronKit(true));
            // Non-vacuous: the burst landed in both arms, and Voron's passive cuts the tick (control).
            expect(plain.detonated).toBeGreaterThan(0);
            expect(plain.ticked).toBeGreaterThan(0);
            expect(voron.ticked / plain.ticked).toBeCloseTo(0.8, 6);
            expect(voron.detonated / plain.detonated).toBeCloseTo(0.8, 6);
        });
    }
);

describe.each<Placement>(['player', 'enemy'])('Wildfire R4 on the %s side', (placement) => {
    const wildfire = (withPassive: boolean): BoardUnit => ({
        id: 'wildfire',
        kit: {
            slots: realKit('Wildfire').slots.filter((s) => withPassive || s.slot !== 'passive'),
        },
        position: 'M2',
        speed: 190,
        attack: 1000,
        critDamage: 150,
        hacking: 1e6,
        chargeCount: 1,
        startCharged: true,
    });
    const scorcher: BoardUnit = {
        id: 'scorcher',
        kit: textKit('Scorcher', { active: SCORCHING_TEXT }),
        position: 'M1',
        speed: 280,
        attack: 1000,
        hacking: 1e6,
    };

    it("Scorching Radiation's Inferno bonus raises a detonation as it raises a tick", () => {
        const base = measure(placement, NO_KIT, [wildfire(false), scorcher]);
        const boosted = measure(placement, NO_KIT, [wildfire(true), scorcher]);
        expect(base.detonated).toBeGreaterThan(0);
        // The tick is the control: the bonus is live on this board.
        expect(boosted.ticked).toBeGreaterThan(base.ticked);
        expect(boosted.detonated / base.detonated).toBeCloseTo(boosted.ticked / base.ticked, 6);
    });
});

describe.each<Placement>(['player', 'enemy'])('Inferno stack size, dealer on %s', (placement) => {
    it("a detonation sizes each stack on its APPLIER's attack, not the detonator's", () => {
        const equal = measure(placement, NO_KIT, [], { detonatorAttack: 1000 });
        const strongDetonator = measure(placement, NO_KIT, [], { detonatorAttack: 3000 });
        expect(equal.detonated).toBeGreaterThan(0);
        expect(strongDetonator.detonated).toBeCloseTo(equal.detonated, 6);
    });

    it("a stack keeps its applier's attack from when it was laid", () => {
        const BUFF_TEXT =
            'This Unit grants <unit-skill>Attack Up II</unit-skill> to all allies for 3 turns.';
        const dealer: BoardUnit = {
            id: 'dealer',
            kit: textKit('Dealer', { active: INFERNO_TEXT }),
            position: 'M4',
            speed: 300,
            attack: 1000,
            hacking: 1e6,
        };
        // Acts after the dealer each round: the dealer's attack is higher from round 2 on.
        const buffer: BoardUnit = {
            id: 'buffer',
            kit: textKit('Buffer', { active: BUFF_TEXT }),
            position: 'M2',
            speed: 100,
            attack: 1000,
            hacking: 1e6,
        };
        const victim: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M4', speed: 1, hp: 5e9 };
        const { input, id } = boardInput(placement, dealer, [buffer], [victim], 2);
        const bus = createEventBus();
        const perRound: Record<number, number> = {};
        bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
            if (e.targetId === id(victim) && e.dotType === 'inferno')
                perRound[e.round] = (perRound[e.round] ?? 0) + e.damage;
        });
        runCombat({ ...input, bus });
        // Round 1: one stack at attack 1000 (tier 45). Round 2: Attack Up II (+30%) is on the
        // dealer, so the new stack is 450 x 1.3 while the first keeps 450.
        expect(perRound[1]).toBeCloseTo(450, 6);
        expect(perRound[2]).toBeCloseTo(450 + 450 * 1.3, 6);
    });
});

describe.each<Placement>(['player', 'enemy'])(
    'Inc. DoT Damage Up on a hit-converted DoT, attacker on %s',
    (placement) => {
        const genericTicks = (withUp: boolean): number => {
            const seeder: BoardUnit = {
                id: 'seeder',
                kit: withUp
                    ? textKit('Seeder', {
                          active: 'This Unit inflicts <unit-skill>Inc. DoT Damage Up II</unit-skill> for 3 turns.',
                      })
                    : NO_KIT,
                position: 'M2',
                speed: 400,
                attack: 1000,
                hacking: 1e6,
            };
            const attacker: BoardUnit = {
                id: 'hitter',
                kit: hitKit(100),
                position: 'M4',
                speed: 300,
                attack: 1000,
            };
            const voron: BoardUnit = {
                id: 'voron',
                kit: realKit('Voron'),
                position: 'M4',
                speed: 1,
                hp: 5e9,
            };
            const { input, id } = boardInput(placement, attacker, [seeder], [voron], 1);
            const bus = createEventBus();
            let total = 0;
            bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
                if (e.targetId === id(voron) && e.dotType === 'generic') total += e.damage;
            });
            runCombat({ ...input, bus });
            return total;
        };

        it("Voron's converted hit ticks raised by the victim's live Inc. DoT Damage Up, once", () => {
            const plain = genericTicks(false);
            const raised = genericTicks(true);
            expect(plain).toBeGreaterThan(0);
            expect(raised / plain).toBeCloseTo(1.2, 6);
        });
    }
);
