/**
 * SP-U U5 — characterization of the REAL, destructible DPS enemy.
 *
 * BEFORE U5 the DPS opponent was an indestructible damage-wall: its modeled HP could decline
 * past 0 (scalar sink) yet it kept taking damage forever, never emitted ship-destroyed, and the
 * run always ran the full `numRounds`. U5 makes it a real actor: this round's dealt damage lands
 * through the shared per-victim `applyVictimDamage` funnel (surfacing in `perActorIncoming`), its
 * HP declines naturally, and the moment it crosses 0 it is `recordDestroyed` (ship-destroyed) and
 * the run TERMINATES — no rounds past the kill. This file locks that new surface.
 *
 * DPS mode: NO `healTargetId` and NO enemy attackers — the dummy `enemy` IS the real target
 * (dpsEnemyTarget), driven purely by the focus attacker's damage.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `idd${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** Plain 100% active damage skill — base turn damage == effective attack (defense 0). */
const activeDamageSkills = (): ShipSkills => {
    idCounter = 0;
    return {
        slots: [
            {
                slot: 'active',
                abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
            },
        ],
    };
};

/** 100% active damage + an inferno DoT applied to the enemy on the active turn. */
const damagePlusInfernoSkills = (): ShipSkills => {
    idCounter = 0;
    return {
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                    ab({
                        type: 'dot',
                        target: 'enemy',
                        config: {
                            type: 'dot',
                            dotType: 'inferno',
                            tier: 100,
                            stacks: 1,
                            duration: 99,
                        },
                    }),
                ],
            },
        ],
    };
};

const dpsBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: activeDamageSkills(),
    enemyDefense: 0,
    enemyHp: 25_000,
    numRounds: 6,
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
    hp: 30_000,
    // NO healTargetId — DPS mode.
    ...overrides,
});

const run = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    return runCombat({ ...input, bus });
};

describe('SP-U U5 — the DPS enemy is real, destructible, and terminates the run on death', () => {
    // attack 10000 × 100% → 10000 dmg/round vs a 25000 pool → cumulative crosses 25000 in R3, so
    // the enemy dies in round 3 and the run stops there (rounds 4-6 never run).
    it('rawTotals + rounds reflect ONLY the rounds up to the kill', () => {
        const result = run(dpsBase({ attack: 10000, enemyHp: 25000, numRounds: 6 }));
        expect(result.rounds).toHaveLength(3);
        expect(result.rawTotals).toEqual({
            direct: 30000,
            corrosion: 0,
            inferno: 0,
            detonation: 0,
            cumulative: 30000,
            totalSecondary: 0,
            totalConditional: 0,
            teamTotal: 0,
            generic: 0,
        });
    });

    it('reports the enemy outcome (rounds-to-kill / not survived / 0% HP)', () => {
        const result = run(dpsBase({ attack: 10000, enemyHp: 25000, numRounds: 6 }));
        expect(result.enemyOutcome).toEqual({
            survived: false,
            roundsToKill: 3,
            finalHpPct: 0,
        });
    });

    it('surfaces the enemy per-round intake in perActorIncoming (per-victim basis)', () => {
        const result = run(dpsBase({ attack: 10000, enemyHp: 25000, numRounds: 6 }));
        // Every round that dealt damage records the enemy's incoming through the shared sink.
        for (const rd of result.rounds) {
            expect(rd.perActorIncoming?.enemy?.incoming).toBe(10000);
            expect(rd.perActorIncoming?.enemy?.shieldAbsorbed).toBe(0);
            expect(rd.perActorIncoming?.enemy?.barrierAbsorbed).toBe(0);
        }
    });

    it('emits exactly one ship-destroyed for the enemy id "enemy" on the kill round', () => {
        idCounter = 0;
        const bus = createEventBus();
        const shipDestroyed: { actorId: string; round: number }[] = [];
        bus.on('ship-destroyed', (e) => {
            shipDestroyed.push({ actorId: e.actorId, round: e.round });
        });
        runCombat({ ...dpsBase({ attack: 10000, enemyHp: 25000, numRounds: 6 }), bus });
        const enemyDeaths = shipDestroyed.filter((e) => e.actorId === 'enemy');
        expect(enemyDeaths).toHaveLength(1);
        expect(enemyDeaths[0].round).toBe(3);
    });

    it('DoT damage also drives the kill; DoT ticks are counted up to the kill round', () => {
        // direct 10000 + inferno (tier 100 → 100% of attack = 10000)/round: the enemy dies fast.
        const result = run(
            dpsBase({
                attack: 10000,
                enemyHp: 25000,
                numRounds: 6,
                shipSkills: damagePlusInfernoSkills(),
            })
        );
        expect(result.enemyOutcome.survived).toBe(false);
        expect(result.rounds.length).toBeLessThan(6);
        expect(result.rawTotals.inferno).toBeGreaterThan(0);
    });

    it('an enemy that OUTLASTS the window is never destroyed (survived, HP% remaining)', () => {
        // Huge pool: 10000/round × 6 never crosses it → the enemy survives all 6 rounds.
        const bus = createEventBus();
        const shipDestroyed: string[] = [];
        bus.on('ship-destroyed', (e) => shipDestroyed.push(e.actorId));
        const result = runCombat({
            ...dpsBase({ attack: 10000, enemyHp: 10_000_000, numRounds: 6 }),
            bus,
        });
        expect(result.rounds).toHaveLength(6);
        expect(result.enemyOutcome.survived).toBe(true);
        expect(result.enemyOutcome.roundsToKill).toBeUndefined();
        expect(result.enemyOutcome.finalHpPct).toBeGreaterThan(0);
        expect(shipDestroyed).not.toContain('enemy');
    });
});
