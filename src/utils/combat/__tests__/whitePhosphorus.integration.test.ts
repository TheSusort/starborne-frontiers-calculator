/**
 * White Phosphorus is an Inferno entry that cannot be cleansed: it ticks as an Inferno (a share of
 * the applier's attack, ignoring defence), a cleanse leaves it standing while removing a plain
 * Inferno beside it, and a detonate-Inferno effect detonates it. Each case runs on both sides.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { boardInput, NO_KIT, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';
import type { Ability } from '../../../types/abilities';

beforeEach(() => setupKeyedRng(1));

const WHITE_PHOSPHORUS_TEXT =
    'This Unit inflicts <unit-skill>White Phosphorus III</unit-skill> for 6 turns.';
const INFERNO_TEXT = 'This Unit inflicts <unit-skill>Inferno I</unit-skill> for 6 turns.';
const CLEANSE_TEXT =
    'This Unit deals <unit-damage>100% damage</unit-damage> and <unit-skill>cleanses all debuffs</unit-skill>.';
const DETONATE_TEXT =
    'This Unit deals <unit-damage>225% damage</unit-damage> and <unit-skill>detonates</unit-skill> <unit-skill>Inferno</unit-skill> effects with <unit-damage>180%</unit-damage> of their power.';

type Ticked = Extract<CombatEvent, { type: 'dot-ticked' }>;
type Detonated = Extract<CombatEvent, { type: 'dot-detonated' }>;

const unit = (id: string, over: Partial<BoardUnit>): BoardUnit => ({
    id,
    kit: NO_KIT,
    position: 'M3',
    speed: 100,
    attack: 1000,
    hacking: 1e6,
    ...over,
});

const run = (
    placement: Placement,
    appliers: BoardUnit[],
    victim: BoardUnit,
    rounds: number
): { ticks: Ticked[]; detonations: Detonated[]; victimId: string } => {
    const [carrier, ...allies] = appliers;
    const { input, id } = boardInput(placement, carrier, allies, [victim], rounds);
    const bus = createEventBus();
    const ticks: Ticked[] = [];
    const detonations: Detonated[] = [];
    bus.on('dot-ticked', (e: Ticked) => ticks.push(e));
    bus.on('dot-detonated', (e: Detonated) => detonations.push(e));
    runCombat({ ...input, bus });
    return { ticks, detonations, victimId: id(victim) };
};

const whitePhosphorusApplier = unit('wp', {
    kit: textKit('Phosphor', { active: WHITE_PHOSPHORUS_TEXT }),
    speed: 300,
});

const whitePhosphorusOneShot = unit('wp', {
    kit: textKit('Phosphor', { charged: WHITE_PHOSPHORUS_TEXT, chargeCount: 9 }),
    speed: 300,
    chargeCount: 9,
    startCharged: true,
});

describe('White Phosphorus kit parsing', () => {
    it('carries its family and unremovable flag on the ability config', () => {
        const kit = textKit('Phosphor', { active: WHITE_PHOSPHORUS_TEXT });
        const dots = kit.slots
            .flatMap((s) => s.abilities)
            .filter((a): a is Ability => a.type === 'dot');
        expect(dots).toHaveLength(1);
        expect(dots[0].config).toMatchObject({
            type: 'dot',
            dotType: 'inferno',
            tier: 45,
            family: 'White Phosphorus',
            unremovable: true,
        });
    });
});

describe.each<Placement>(['player', 'enemy'])('White Phosphorus on the %s side', (placement) => {
    it('ticks as an Inferno at 45% of the applied attack, ignoring defence', () => {
        const victim = unit('victim', { speed: 1, defence: 50000, hp: 5e9 });
        const { ticks, victimId } = run(placement, [whitePhosphorusApplier], victim, 2);
        const onVictim = ticks.filter((t) => t.targetId === victimId);
        expect(onVictim.length).toBeGreaterThan(0);
        for (const t of onVictim) {
            expect(t.dotType).toBe('inferno');
            expect(t.tier).toBe(45);
            expect(t.damage).toBeCloseTo(450 * t.stacks, 6);
        }
    });

    it('a cleanse removes a plain Inferno but leaves White Phosphorus standing', () => {
        // One-shot appliers (a charged skill fired in round 1, then a long recharge) so the
        // round-3 ticks belong to round-1 stacks that the victim's cleanse has already met.
        const burner = unit('burner', {
            kit: textKit('Burner', { charged: INFERNO_TEXT, chargeCount: 9 }),
            speed: 290,
            chargeCount: 9,
            startCharged: true,
        });
        const victim = unit('victim', {
            kit: textKit('Cleanser', { active: CLEANSE_TEXT }),
            speed: 1,
            hp: 5e9,
        });
        const { ticks, victimId } = run(placement, [whitePhosphorusOneShot, burner], victim, 3);
        const lastRound = (tier: number) =>
            ticks.filter((t) => t.targetId === victimId && t.tier === tier && t.round === 3);
        const early = (tier: number) =>
            ticks.filter((t) => t.targetId === victimId && t.tier === tier && t.round === 1);
        // Both stacks were live before the cleanse, so the round-3 contrast is not vacuous.
        expect(early(15).length + early(45).length).toBeGreaterThan(0);
        expect(lastRound(15)).toHaveLength(0);
        expect(lastRound(45).length).toBeGreaterThan(0);
    });

    it('a detonate-Inferno effect detonates it', () => {
        const detonator = unit('detonator', {
            kit: textKit('Incinerator', { active: DETONATE_TEXT }),
            speed: 200,
        });
        const victim = unit('victim', { speed: 1, hp: 5e9 });
        const { detonations, victimId } = run(
            placement,
            [whitePhosphorusApplier, detonator],
            victim,
            1
        );
        const onVictim = detonations.filter((d) => d.targetId === victimId);
        expect(onVictim.length).toBeGreaterThan(0);
        expect(onVictim[0].damage).toBeGreaterThan(0);
    });
});
