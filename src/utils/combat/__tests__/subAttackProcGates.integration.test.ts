/**
 * Multi-hit full-walk attacks, PR4 — OUTGOING proc gates at sub-attack scope.
 *
 * A multi-hit skill is N consecutive full-walk attacks (locked game rule R1), and effects based on
 * OUTGOING hits resolve per attack — i.e. per sub-attack (R2). PR1 threaded a `subAttackIndex`
 * through every per-victim callback and PR2 made the engine emit one `ability-performed` per
 * sub-attack; PR4 makes the *gates* consume that identity.
 *
 * Task 1 pins a PR2 deliverable that nothing else covers. Enforcer's Defense Shred is a PASSIVE
 * `on-crit` reactive debuff, not a slot clause, so PR2's per-sub-attack emission is what gives her
 * N stacks — and Enforcer is `Pattern-Base`, so no fingerprint golden can see a regression here.
 * Measured against 7829f531: hits=1 → 1 application, hits=3 → 3.
 *
 * Fixtures are copied from `perSubAttackEvents.integration.test.ts` rather than imported: that
 * file exports nothing and PR2 deliberately kept its fixtures local.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setRateGateRng, setKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pg${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/** An N-hit damage active. `hits` is omitted at N=1 so the fixture matches a normal ship. */
const attackSkill = (hits: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            config: { type: 'damage', multiplier: 100, ...(hits > 1 ? { hits } : {}) },
        }),
    ],
});

/** Enforcer's real shred shape: passive-slot `on-crit` debuff, inflict application. */
const onCritShred = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-crit',
            config: {
                type: 'debuff',
                buffName: 'Defense Shred',
                parsedEffects: { defense: -2 },
                stacks: 1,
                isStackable: true,
                maxStacks: 20,
                duration: 3,
                application: 'inflict',
            },
        }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
/** Single-cell footprint: the anchor only. */
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** A positioned enemy that never fires back. */
const passiveEnemyAt = (id: string, position: Position) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots: [] },
    }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

/**
 * The focus player at M1 fires `slots`. `crit: 100` with a neutral-affinity roster makes every
 * (sub-attack, victim) pair crit; `hacking` is high so debuff landing rolls never resist.
 */
const focusCast = (slots: ShipSkills['slots'], pattern: ParsedPattern): CombatEngineInput => ({
    attack: 5000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    affinity: 'antimatter',
    defence: 0,
    hp: 1_000_000_000,
    hacking: 100_000,
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTarget('front'),
    pattern,
    enemyAttackers: [passiveEnemyAt('anchor', 'M4'), passiveEnemyAt('covered', 'M3')],
});

/** Everything fires: crit gates, landing gates, proc gates. */
const alwaysFire = (): void => {
    setRateGateRng(() => 0);
    setKeyedRng(() => 0);
};

const countOf = (input: CombatEngineInput, type: CombatEvent['type']): number => {
    const bus = createEventBus();
    let n = 0;
    bus.on(type, () => {
        n++;
    });
    runCombat({ ...input, bus });
    return n;
};

describe('PR4 Task 1 — the on-crit reactive debuff path is already per-sub-attack (PR2)', () => {
    afterEach(() => resetRateGateRng());

    it.each([
        [1, 1],
        [3, 3],
    ])('hits=%i inflicts the debuff %i time(s)', (hits, expected) => {
        idc = 0;
        alwaysFire();
        expect(
            countOf(focusCast([attackSkill(hits), onCritShred()], basePattern()), 'debuff-applied')
        ).toBe(expected);
    });
});
