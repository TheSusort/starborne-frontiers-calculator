import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

// ---------------------------------------------------------------------------
// C2a Task 3: cast-path PURGE removes an enemy's self-buffs (enemy side).
//
// Positional two-team battle-sim harness (mirrors twoTeamBattle.test.ts —
// healTargetId MUST be set, which unlocks the enemy roster; the focus needs a
// position + parsed target so selectTurnTarget resolves the REAL enemy id as
// `targetId`, not the dummy `enemy` sink). The enemy attacker carries an active
// skill that applies a removable self-buff ("Attack Up", duration 99) to
// ITSELF every round; the player focus's ACTIVE skill purges enemy buffs while
// also firing a basic hit at the enemy (positional, so targetId resolves to the
// real enemy).
//
// Observed directly off the enemy's self-buff store via
// statusEngine.timedAbilityStatuses('self', enemyId) (= selfMaps.get(enemyId)),
// read after the run settles through the __testTapStatusEngine tap. With no
// purger the enemy keeps Attack Up; with a purger it is removed.
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pp${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

describe('C2a Task 3: cast-path purge removes enemy self-buffs', () => {
    // The enemy's removable self-buff applied on its active each round.
    const attackUp = (): Ability =>
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: 'Attack Up',
                parsedEffects: { attack: 30 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });

    const hit = (): Ability =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // The enemy attacker (positioned 'front', fires the focus): buffs itself then hits.
    const buffingEnemy = () => ({
        id: 'enemy-front',
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active' as const, abilities: [attackUp(), hit()] }] },
    });

    // Player focus skill: either a purge active (with a basic hit so it fires positionally) or
    // a plain hit-only active (the control).
    const focusSkills = (purge: boolean): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: purge
                    ? [
                          ab({
                              type: 'purge',
                              target: 'enemy',
                              config: { type: 'purge', count: 5 },
                          }),
                          hit(),
                      ]
                    : [hit()],
            },
        ],
    });

    const BASE = (purge: boolean): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills(purge),
        numRounds: 3,
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
        hp: 1_000_000_000, // focus immortal so the battle runs all rounds
        // Healing mode + position + target unlock the enemy roster and positional targeting.
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [buffingEnemy()],
    });

    const finalEnemySelfBuffs = (purge: boolean): string[] => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(purge),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        // selfMaps.get('enemy-front') — the enemy's own buff store (the purge target).
        return engine!.timedAbilityStatuses('self', 'enemy-front').map((b) => b.active.buffName);
    };

    it('CONTROL (no purger): the enemy keeps its self-buff after the run', () => {
        expect(finalEnemySelfBuffs(false)).toEqual(['Attack Up']);
    });

    it('an active-skill purge removes the enemy self-buff (gone from the enemy store)', () => {
        expect(finalEnemySelfBuffs(true)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// C2a follow-up Task 1: SIDE-SYMMETRY — an ENEMY caster purges a PLAYER's buff.
//
// The existing suite above proves a PLAYER purges an ENEMY's buff. On-cast purge
// is keyed off `targetId` (the opposing victim) with NO player-centric gate
// (playerTurn.ts: "side-symmetric (works for player AND enemy casters)"), so the
// enemy direction is reachable through the SAME harness — we just swap which
// side carries the self-buff and which side carries the purge ability.
//
// Mirror layout: the player FOCUS (id 'attacker', M4) applies a removable
// "Attack Up" self-buff to ITSELF each round via its active, then hits. The
// ENEMY front attacker fires `front` (anchors the front-most player = the focus
// at M4, so `targetId` resolves to 'attacker') and carries either a purge active
// (+ a basic hit so it fires positionally) or a plain hit-only active (control).
//
// Observed off the PLAYER focus's self-buff store via
// statusEngine.timedAbilityStatuses('self', 'attacker') (= selfMaps.get('attacker')).
// With no enemy purger the focus keeps Attack Up; with one it is removed —
// proving the targetId-keyed side-symmetry that was previously only reasoned.
// ---------------------------------------------------------------------------
describe('C2a follow-up: cast-path purge is side-symmetric (enemy purges player)', () => {
    const attackUp = (): Ability =>
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: 'Attack Up',
                parsedEffects: { attack: 30 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });

    const hit = (): Ability =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // The enemy front attacker: either a purge active (+ a basic hit so it fires positionally
    // and resolves the player focus as targetId) or a plain hit-only active (the control).
    // Speed 50 < the focus's default 100, so the focus ACTS FIRST each round (applies its
    // self-buff) and the enemy purges AFTER — otherwise the enemy would purge an empty store
    // and the focus would re-apply the buff afterwards (turn-order, not a plumbing gap).
    const enemyFront = (purge: boolean) => ({
        id: 'enemy-front',
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: purge
                        ? [
                              ab({
                                  type: 'purge',
                                  target: 'enemy',
                                  config: { type: 'purge', count: 5 },
                              }),
                              hit(),
                          ]
                        : [hit()],
                },
            ],
        },
    });

    // Player focus: buffs itself (target 'self') then hits, every round.
    const focusSkills = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [attackUp(), hit()] }],
    });

    const BASE = (purge: boolean): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills(),
        numRounds: 3,
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
        hp: 1_000_000_000, // focus immortal so the battle runs all rounds
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [enemyFront(purge)],
    });

    const finalFocusSelfBuffs = (purge: boolean): string[] => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(purge),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        // selfMaps.get('attacker') — the PLAYER focus's own buff store (the enemy purge target).
        return engine!.timedAbilityStatuses('self', 'attacker').map((b) => b.active.buffName);
    };

    it('CONTROL (no enemy purger): the player focus keeps its self-buff after the run', () => {
        expect(finalFocusSelfBuffs(false)).toEqual(['Attack Up']);
    });

    it('an ENEMY active-skill purge removes the PLAYER focus self-buff', () => {
        expect(finalFocusSelfBuffs(true)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// C2a follow-up Task 2: count:'all' purge + unremovable-survival.
//
// A player active purge with count:'all' against an enemy carrying MULTIPLE
// removable self-buffs PLUS an unremovable one ("Protection", in
// UNREMOVABLE_STATUSES) must strip every removable buff while leaving the
// unremovable one in place — statusEngine.purge respects isUnremovable
// (turnsRemaining === 'permanent' || UNREMOVABLE_STATUSES.has(buffName)).
//
// Same positional harness as the suite above (enemy at M4 buffs itself each
// round; player focus purges via its positional active). Observed off the
// enemy's self store via timedAbilityStatuses('self', 'enemy-front').
// ---------------------------------------------------------------------------
describe("C2a follow-up: count:'all' purge strips removables but spares unremovables", () => {
    const selfBuff = (name: string): Ability =>
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: name,
                parsedEffects: { attack: 10 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });

    const hit = (): Ability =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // Enemy front: applies two removable self-buffs + one unremovable ("Protection") each round,
    // then hits.
    const buffingEnemy = () => ({
        id: 'enemy-front',
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        selfBuff('Attack Up'),
                        selfBuff('Defence Up'),
                        selfBuff('Protection'), // unremovable — must survive an 'all' purge
                        hit(),
                    ],
                },
            ],
        },
    });

    // Player focus: an 'all'-count purge active (+ basic hit so it fires positionally).
    const focusSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({ type: 'purge', target: 'enemy', config: { type: 'purge', count: 'all' } }),
                    hit(),
                ],
            },
        ],
    });

    const BASE = (): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills(),
        numRounds: 3,
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
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [buffingEnemy()],
    });

    const finalEnemySelfBuffs = (): string[] => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        return engine!
            .timedAbilityStatuses('self', 'enemy-front')
            .map((b) => b.active.buffName)
            .sort();
    };

    it("'all' purge removes every removable buff but leaves the unremovable Protection", () => {
        expect(finalEnemySelfBuffs()).toEqual(['Protection']);
    });
});
