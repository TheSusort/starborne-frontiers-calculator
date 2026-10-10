/**
 * The DPS calculator runs the focus at `hp: 0` (the `simulateDPS` default) on purpose: a player
 * ship with no max HP is not a targetable roster member, so no enemy can resolve a victim and
 * enemies attack no one. The focus's own damage must be exactly what it is against an enemy that
 * cannot hurt anybody — a hard-hitting enemy changes nothing.
 *
 * Do NOT floor the player's max HP to make it targetable: that would let enemies hit the focus and
 * move DPS output (#657).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability } from '../../../types/abilities';
import type { CombatActor } from '../state';

const hit = (id: string, multiplier: number): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

const run = (enemyAttack: number) => {
    const bus = createEventBus();
    const attacked: Extract<CombatEvent, { type: 'attacked' }>[] = [];
    bus.on('attacked', (e) => attacked.push(e));
    const input: CombatEngineInput = {
        numRounds: 4,
        bus,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: false,
        startCharged: false,
        defensePenetration: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        chargeCount: 0,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 0,
        speed: 100,
        position: 'M4',
        hacking: 100_000,
        shipSkills: { slots: [{ slot: 'active', abilities: [hit('focus-hit', 150)] }] },
        teamActors: [],
        enemyAttackers: [
            {
                id: 'brute',
                stats: {
                    attack: enemyAttack,
                    crit: 0,
                    critDamage: 0,
                    defence: 1_000,
                    hp: 10_000_000,
                    speed: 900,
                    hacking: 100_000,
                    security: 0,
                },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                shipSkills: { slots: [{ slot: 'active', abilities: [hit('brute-hit', 300)] }] },
            },
        ],
    };
    let actors: CombatActor[] = [];
    const result = runCombat({
        ...input,
        __testTapActors: (a) => {
            actors = a;
        },
    });
    const bruteHp = actors.find((a) => a.id.includes('brute'))!.currentHp;
    return { result, attacked, bruteHp };
};

describe('#657 DPS mode: a 0-HP focus is hit by nobody', () => {
    it("enemies deal 0 and the focus's damage is unchanged", () => {
        const harmless = run(0);
        const brute = run(50_000);

        // Nobody on the player side is ever struck.
        const enemyHits = brute.attacked.filter((e) => e.attackerId.includes('brute'));
        expect(enemyHits).toEqual([]);

        // The focus did real damage, and exactly as much as beside a harmless enemy.
        expect(brute.bruteHp).toBeLessThan(10_000_000);
        expect(brute.bruteHp).toBe(harmless.bruteHp);
        expect(brute.result.rawTotals).toEqual(harmless.result.rawTotals);
        expect(brute.result.rounds).toEqual(harmless.result.rounds);
    });
});
