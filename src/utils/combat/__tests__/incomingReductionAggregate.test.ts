/**
 * D-PR3 Task 9 — end-to-end engine integration for victim-side incoming %-reduction on the
 * AGGREGATE (non-positional / legacy single-apply) damage path. This is the Iridium-as-tank
 * scenario: the tank is the bound healTarget and a NON-positional enemy attacker single-applies
 * its whole hit against it (no position/target/pattern → enemyPositional false → legacy path,
 * NOT the per-sub-hit positional fold covered by incomingReductionEngine.test.ts).
 *
 * Isolation approach: rather than instantiate real Iridium (which also carries start-of-combat
 * Taunt + an on-damaged purge rider that would muddy a damage-delta assertion), the tank carries
 * a SYNTHETIC passive holding ONLY the incoming-crit-family reduction ability (condition
 * 'incoming-crit', critFamily true, scope 'direct') — the exact ability shape Iridium's parser
 * emits. This pins the aggregate fold in isolation.
 *
 * Damage math (enemy attack 5000 × 100% × 1 hit, defence 0):
 *   non-crit  = 5000.
 *   crit (critDamage 100) = 5000 × (1 + 100/100) = 10000.
 *   crit with -35% crit-family reduction = 10000 × 0.65 = 6500 (only the crit portion is cut).
 * Observed with the death-bracket idiom: size the tank's HP at/above the expected landed damage
 * and assert it dies (took >= hp) or survives (took < hp).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { ShipSkills, Ability } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Synthetic passive: -35% incoming damage from CRITICAL hits (crit-family). Iridium's shape.
const critReductionPassive = (pct: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'synthetic-iridium-crit-reduction',
            type: 'incoming-reduction',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-reduction',
                scope: 'direct',
                condition: 'incoming-crit',
                pct,
                critFamily: true,
            },
        } as Ability,
    ],
});

const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'tank-noop',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

/** A NON-positional enemy attacker (no position/target/pattern) → legacy single-apply. */
const nonPositionalEnemy = (
    id: string,
    opts: { crit: number; critDamage: number }
): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 5000,
            crit: opts.crit,
            critDamage: opts.critDamage,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: `${id}-hit`,
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

/** Build a one-round healing-mode run: focus actor 'attacker' IS the bound tank/healTarget. */
const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive] },
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
    defence: 0,
    hp: 1_000_000_000,
    healTargetId: 'attacker', // the focus actor is the bound tank
    mode: 'healing',
    ...overrides,
});

const destroyedIds = (input: CombatEngineInput): Set<string> => {
    const bus = createEventBus();
    const ids = new Set<string>();
    bus.on('ship-destroyed', (e) => ids.add(e.actorId));
    runCombat({ ...input, bus });
    return ids;
};

const diesAt = (build: (hp: number) => CombatEngineInput, hp: number): boolean =>
    destroyedIds(build(hp)).has('attacker');

describe('D-PR3 Task 9 — aggregate-path crit-family incoming reduction (Iridium-as-tank)', () => {
    // Tank carries the synthetic -35% crit-family reduction passive; enemy single-applies.
    const run = (hp: number, opts: { reduction: boolean; crit: number }): CombatEngineInput =>
        BASE({
            hp,
            shipSkills: {
                slots: [noopActive, ...(opts.reduction ? [critReductionPassive(35)] : [])],
            },
            enemyAttackers: [nonPositionalEnemy('enemy-1', { crit: opts.crit, critDamage: 100 })],
        });

    it('CRIT with -35% crit-family reduction: tank takes 6500 (< unreduced 10000)', () => {
        const build = (hp: number) => run(hp, { reduction: true, crit: 100 });
        // Reduced crit pinned to (6499, 6501): dies at 6500, survives at 6501.
        expect(diesAt(build, 6500)).toBe(true);
        expect(diesAt(build, 6501)).toBe(false);
        // Does NOT take the full crit (10000): survives at 7000.
        expect(diesAt(build, 7000)).toBe(false);
    });

    it('control: CRIT WITHOUT the reduction passive → full crit 10000 lands', () => {
        const build = (hp: number) => run(hp, { reduction: false, crit: 100 });
        expect(diesAt(build, 10000)).toBe(true);
        expect(diesAt(build, 10001)).toBe(false);
        // Took the FULL 10000 (not 6500): dies at 7000 too.
        expect(diesAt(build, 7000)).toBe(true);
    });

    it('NON-crit with the reduction passive → full 5000 (crit-family reduction inert)', () => {
        const build = (hp: number) => run(hp, { reduction: true, crit: 0 });
        expect(diesAt(build, 5000)).toBe(true);
        expect(diesAt(build, 5001)).toBe(false);
    });
});
