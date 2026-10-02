/**
 * #599: a REACTIVE DoT that fails to land surfaces as a `debuff-resisted`, so the combat log shows
 * it ("Inferno II resisted") instead of nothing.
 *
 * In-fight example: a ship wearing 4-piece Burner is at an affinity disadvantage against the enemy
 * that hits it. Burner's applied Inferno fails the affinity check; the log now says so.
 *
 * The #413 rule still holds: only a failed hacking ROLL procs an on-resist reaction (Prophet,
 * Vindicator, Lockdown). An 'apply' DoT fails on affinity alone and draws no roll, so its resist
 * carries no `viaLandingRoll`; an inflicted DoT that drew and failed its roll does.
 *
 * Every arm sits at a saturated landing chance (security 0 vs ≥ hacking, or a fixed affinity
 * matchup), so no assertion depends on the seed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { damageKit } from '../__testutils__/bareRosterFixture';
import { dotResistLabel } from '../debuffImmunity';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { AffinityName } from '../../../types/ship';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type Resisted = Extract<CombatEvent, { type: 'debuff-resisted' }>;
type DotApplied = Extract<CombatEvent, { type: 'dot-applied' }>;

const SOFT_ENEMY_ID = 'e-soft';
const HARD_ENEMY_ID = 'e-hard';
const FOCUS_HACKING = 100;
const INFERNO_TIER = 30;
const INFERNO_LABEL = dotResistLabel('inferno', INFERNO_TIER);

/** "When this unit is attacked, it <verb>s Inferno II on its attacker" — the Burner shape. */
const retaliatoryDot = (application: 'inflict' | 'apply'): Ability =>
    ({
        id: 'retaliate-dot',
        type: 'dot',
        target: 'enemy',
        trigger: 'on-attacked',
        conditions: [],
        config: {
            type: 'dot',
            dotType: 'inferno',
            stacks: 1,
            tier: INFERNO_TIER,
            duration: 2,
            application,
        },
    }) as unknown as Ability;

const focusKit = (application: 'inflict' | 'apply'): ShipSkills => ({
    slots: [...damageKit().slots, { slot: 'passive', abilities: [retaliatoryDot(application)] }],
});

const enemy = (id: string, security: number, affinity?: AffinityName): EnemyAttacker => ({
    id,
    chargeCount: 0,
    startCharged: false,
    shipSkills: damageKit(),
    ...(affinity ? { affinity } : {}),
    stats: {
        attack: 1_000,
        crit: 0,
        critDamage: 0,
        speed: 10,
        defence: 0,
        hp: 10_000_000,
        security,
    },
});

type Knobs = Pick<CombatEngineInput, 'enemyAttackers'> &
    Partial<Pick<CombatEngineInput, 'affinity' | 'shipSkills'>>;

const input = (over: Knobs): CombatEngineInput => ({
    attack: 1_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: focusKit('inflict'),
    numRounds: 4,
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
    hp: 10_000_000,
    hacking: FOCUS_HACKING,
    ...over,
});

const run = (over: Knobs) => {
    const bus = createEventBus();
    const resisted: Resisted[] = [];
    const applied: DotApplied[] = [];
    bus.on('debuff-resisted', (e) => {
        if (e.sourceId === 'attacker' && e.buffName === INFERNO_LABEL) resisted.push(e);
    });
    bus.on('dot-applied', (e) => {
        if (e.sourceId === 'attacker' && e.dotType === 'inferno') applied.push(e);
    });
    runCombat({ ...input(over), bus });
    return { resisted, applied };
};

describe('#599: a reactive DoT that fails to land is logged as resisted', () => {
    beforeEach(() => setupKeyedRng(599));

    it('an inflicted DoT that fails its hacking roll emits a resist that procs on-resist reactions', () => {
        const { resisted, applied } = run({
            enemyAttackers: [enemy(SOFT_ENEMY_ID, 0), enemy(HARD_ENEMY_ID, FOCUS_HACKING)],
        });
        const hardResists = resisted.filter((e) => e.targetId === HARD_ENEMY_ID);
        expect(hardResists.length).toBeGreaterThan(0);
        expect(hardResists.every((e) => e.viaLandingRoll === true)).toBe(true);
        expect(applied.some((e) => e.targetId === HARD_ENEMY_ID)).toBe(false);
        // The zero-security attacker always takes the DoT and never resists — so the hard arm's
        // resists come from the roll, not from a reaction that never landed anywhere.
        expect(applied.some((e) => e.targetId === SOFT_ENEMY_ID)).toBe(true);
        expect(resisted.some((e) => e.targetId === SOFT_ENEMY_ID)).toBe(false);
    });

    it('an applied DoT at an affinity disadvantage emits a resist WITHOUT viaLandingRoll', () => {
        // thermal beats chemical → the chemical focus is at a disadvantage vs the thermal enemy.
        const { resisted, applied } = run({
            affinity: 'chemical',
            shipSkills: focusKit('apply'),
            enemyAttackers: [enemy(HARD_ENEMY_ID, 0, 'thermal')],
        });
        expect(resisted.length).toBeGreaterThan(0);
        expect(resisted.every((e) => e.targetId === HARD_ENEMY_ID)).toBe(true);
        expect(resisted.some((e) => e.viaLandingRoll)).toBe(false);
        expect(applied).toHaveLength(0);
    });

    it('the same applied DoT without the disadvantage lands and emits no resist', () => {
        const { resisted, applied } = run({
            affinity: 'chemical',
            shipSkills: focusKit('apply'),
            enemyAttackers: [enemy(HARD_ENEMY_ID, 0, 'electric')],
        });
        expect(applied.length).toBeGreaterThan(0);
        expect(resisted).toHaveLength(0);
    });
});
