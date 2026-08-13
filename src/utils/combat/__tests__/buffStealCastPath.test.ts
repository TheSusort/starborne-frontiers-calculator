import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

// ---------------------------------------------------------------------------
// PR10: cast-path BUFF STEAL moves the target's newest buff onto the caster,
// remaining duration intact — statusEngine.steal wired into the on-cast loop in
// playerTurn.ts (mirrors the purge on-cast loop it's modeled after).
//
// Harness mirrors purgeCastPath.test.ts (positional two-team battle-sim:
// healTargetId set unlocks the enemy roster; the focus needs position + parsed
// target so selectTurnTarget resolves the REAL enemy id as `targetId`).
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `bs${++idc}`,
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

describe('PR10: cast-path buff steal (player steals from enemy)', () => {
    // The enemy front attacker: self-buffs "Attack Up" then hits, every round. Speed 200 so it
    // acts BEFORE the focus (default speed 100) each round.
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

    // Player focus: either a buff-steal active (+ a basic hit so it fires positionally) or a
    // plain hit-only active (control).
    const focusSkills = (steal: boolean): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: steal
                    ? [
                          ab({
                              type: 'buff-steal',
                              target: 'enemy',
                              config: { type: 'buff-steal', count: 1 },
                          }),
                          hit(),
                      ]
                    : [hit()],
            },
        ],
    });

    const BASE = (steal: boolean): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills(steal),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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

    const run = (steal: boolean): { focus: string[]; enemy: string[] } => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(steal),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        return {
            focus: engine!.timedAbilityStatuses('self', 'attacker').map((b) => b.active.buffName),
            enemy: engine!
                .timedAbilityStatuses('self', 'enemy-front')
                .map((b) => b.active.buffName),
        };
    };

    it('CONTROL (no steal ability): the enemy keeps its self-buff; the focus gains nothing', () => {
        const { focus, enemy } = run(false);
        expect(enemy).toEqual(['Attack Up']);
        expect(focus).toEqual([]);
    });

    it('an active-skill buff-steal moves the enemy self-buff onto the focus', () => {
        const { focus, enemy } = run(true);
        expect(enemy).toEqual([]);
        expect(focus).toEqual(['Attack Up']);
    });
});

// ---------------------------------------------------------------------------
// Side symmetry: an ENEMY caster steals a PLAYER's buff. buff-steal is keyed off
// `targetId` (the opposing victim) with no player-centric gate, exactly like the
// purge loop it's modeled after (playerTurn.ts: "side-symmetric").
// ---------------------------------------------------------------------------
describe('PR10: cast-path buff steal is side-symmetric (enemy steals from player)', () => {
    // Enemy front: either a buff-steal active (+ hit, so it fires positionally and resolves the
    // player focus as targetId) or a plain hit-only active (control). Speed 50 < the focus's
    // default 100, so the focus acts FIRST each round (applies its self-buff) and the enemy
    // steals AFTER.
    const enemyFront = (steal: boolean) => ({
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
                    abilities: steal
                        ? [
                              ab({
                                  type: 'buff-steal',
                                  target: 'enemy',
                                  config: { type: 'buff-steal', count: 1 },
                              }),
                              hit(),
                          ]
                        : [hit()],
                },
            ],
        },
    });

    const focusSkills = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [attackUp(), hit()] }],
    });

    const BASE = (steal: boolean): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        enemyAttackers: [enemyFront(steal)],
    });

    const run = (steal: boolean): { focus: string[]; enemy: string[] } => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(steal),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        return {
            focus: engine!.timedAbilityStatuses('self', 'attacker').map((b) => b.active.buffName),
            enemy: engine!
                .timedAbilityStatuses('self', 'enemy-front')
                .map((b) => b.active.buffName),
        };
    };

    it('CONTROL (no enemy stealer): the player focus keeps its self-buff', () => {
        const { focus, enemy } = run(false);
        expect(focus).toEqual(['Attack Up']);
        expect(enemy).toEqual([]);
    });

    it('an ENEMY active-skill buff-steal moves the PLAYER focus self-buff onto the enemy', () => {
        const { focus, enemy } = run(true);
        expect(focus).toEqual([]);
        expect(enemy).toEqual(['Attack Up']);
    });
});

// ---------------------------------------------------------------------------
// grantAdjacentAllies (Tithonus): the stolen buff also lands on every living
// adjacent ally of the caster — the SAME buff, not a fan-out split. Player team
// actor at M3 (adjacent to focus M4; non-positional-fallback would also work
// since only one side is positioned per adjacentAllyIds, but this pins the
// positional path too).
// ---------------------------------------------------------------------------
describe('PR10: cast-path buff steal — grantAdjacentAllies grants the SAME stolen buff to the caster and its adjacent ally', () => {
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

    const focusSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'buff-steal',
                        target: 'enemy',
                        config: { type: 'buff-steal', count: 1, grantAdjacentAllies: true },
                    }),
                    hit(),
                ],
            },
        ],
    });

    // Passive ally: never acts against the enemy (no charged/active damage needed) — just needs
    // to exist as a living, positioned same-side actor for adjacentAllyIds to resolve it.
    const teamAlly = (): TeamActorEngineInput => ({
        id: 'player-team',
        speed: 10,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M3' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
            stats: {
                attack: 500,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 200,
                defence: 0,
                hp: 1_000_000_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });

    const BASE = (): CombatEngineInput => ({
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: focusSkills(),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
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
        teamActors: [teamAlly()],
        enemyAttackers: [buffingEnemy()],
    });

    it('the caster AND its adjacent ally both hold the stolen buff; the enemy is left with none', () => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        expect(
            engine!.timedAbilityStatuses('self', 'attacker').map((b) => b.active.buffName)
        ).toEqual(['Attack Up']);
        expect(
            engine!.timedAbilityStatuses('self', 'player-team').map((b) => b.active.buffName)
        ).toEqual(['Attack Up']);
        expect(
            engine!.timedAbilityStatuses('self', 'enemy-front').map((b) => b.active.buffName)
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Finding 1 (order): steal MUST resolve BEFORE purge within the SAME cast. The
// corpus order (Tithonus) is always "steals 1 buff ... THEN purges 2 buffs", so
// the caster must receive the NEWEST buff the target had at cast time — not a
// buff left over after the purge already stripped the two newest.
//
// Target holds THREE distinct buffs in a distinct applied order (Attack Up
// oldest → Defence Up → Speed Up newest). One focus skill carries BOTH
// buff-steal(1) and purge(2). Correct (steal-first): steal takes Speed Up
// (newest); purge then removes the two REMAINING (Attack Up + Defence Up) → the
// enemy is emptied and the caster holds exactly Speed Up. Buggy (purge-first):
// purge strips Speed Up + Defence Up, leaving Attack Up, and the steal then
// takes Attack Up → caster holds the WRONG (oldest) buff.
// ---------------------------------------------------------------------------
describe('Finding 1: buff steal resolves BEFORE purge in the same cast (Tithonus order)', () => {
    const namedSelfBuff = (name: string): Ability =>
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

    // Enemy front (speed 200 → acts first): applies three distinct self-buffs in a fixed order,
    // then hits. Applied order = ability order → Attack Up (oldest) < Defence Up < Speed Up
    // (newest) by appliedSeq.
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
                        namedSelfBuff('Attack Up'),
                        namedSelfBuff('Defence Up'),
                        namedSelfBuff('Speed Up'),
                        hit(),
                    ],
                },
            ],
        },
    });

    // Focus (speed 100 → acts after the enemy in the same round): ONE skill carrying both a
    // buff-steal(1) and a purge(2), plus a basic hit so it fires positionally.
    const focusSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'buff-steal',
                        target: 'enemy',
                        config: { type: 'buff-steal', count: 1 },
                    }),
                    ab({ type: 'purge', target: 'enemy', config: { type: 'purge', count: 2 } }),
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
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [buffingEnemy()],
    });

    it('the caster receives the NEWEST buff (Speed Up); purge then strips the two remaining, emptying the enemy', () => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(),
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        // Caster holds exactly the newest buff — proving steal ran on the FULL (pre-purge) set.
        expect(
            engine!.timedAbilityStatuses('self', 'attacker').map((b) => b.active.buffName)
        ).toEqual(['Speed Up']);
        // Enemy: steal removed 1 (Speed Up) + purge removed the 2 remaining → none left.
        expect(
            engine!.timedAbilityStatuses('self', 'enemy-front').map((b) => b.active.buffName)
        ).toEqual([]);
    });
});
