import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

// ---------------------------------------------------------------------------
// E3: an on-cast purge with ability target 'all-enemies' removes buffs from
// EVERY footprint victim, not just the single resolved anchor.
//
// Harness mirrors purgeCastPath.test.ts (positional two-team battle-sim:
// healTargetId set unlocks the enemy roster; the focus needs position + parsed
// target so selectTurnTarget resolves a REAL enemy as the anchor `targetId`).
// TWO enemies (M4 front + M3) each self-buff "Attack Up" every round. The focus
// fires an 'all'-shape pattern (footprint = all living enemies), so the footprint
// covers BOTH. The control uses a single-'enemy' purge (anchor only).
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `e3p${++idc}`,
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

const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

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

const buffingEnemy = (id: string, position: Position) => ({
    id,
    stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: allPattern(),
    shipSkills: { slots: [{ slot: 'active' as const, abilities: [attackUp(), hit()] }] },
});

const focusSkills = (aoe: boolean): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'purge',
                    target: aoe ? 'all-enemies' : 'enemy',
                    config: { type: 'purge', count: 5 },
                }),
                hit(),
            ],
        },
    ],
});

const BASE = (aoe: boolean): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: focusSkills(aoe),
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
    position: 'M4',
    target: parsedTarget('front'),
    pattern: allPattern(),
    enemyAttackers: [buffingEnemy('enemy-front', 'M4'), buffingEnemy('enemy-back', 'M3')],
});

const finalSelfBuffs = (aoe: boolean, enemyId: string): string[] => {
    idc = 0;
    let engine: StatusEngine | undefined;
    runCombat({
        ...BASE(aoe),
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return engine!.timedAbilityStatuses('self', enemyId).map((b) => b.active.buffName);
};

describe('E3: on-cast all-enemies purge removes buffs from every footprint victim', () => {
    it('an all-enemies purge strips the self-buff from BOTH enemies', () => {
        expect(finalSelfBuffs(true, 'enemy-front')).toEqual([]);
        expect(finalSelfBuffs(true, 'enemy-back')).toEqual([]);
    });

    it('CONTROL: a single-enemy purge strips only the anchor (front-most), not the back enemy', () => {
        expect(finalSelfBuffs(false, 'enemy-front')).toEqual([]); // anchor purged
        expect(finalSelfBuffs(false, 'enemy-back')).toEqual(['Attack Up']); // untouched
    });
});

// ---------------------------------------------------------------------------
// E3 Test A — per-victim count is NOT pooled across the footprint.
//
// Each enemy carries TWO removable self-buffs: "Attack Up" (applied first) and
// "Defence Up" (applied second, higher appliedSeq). The focus fires an
// 'all-enemies' purge with count: 1. The engine calls purge(victimId, 1) for
// EACH victim independently — removing the NEWEST buff (Defence Up) and leaving
// the oldest (Attack Up). If the count were pooled as a shared budget of 1, only
// ONE of the two enemies would lose a buff; both losing exactly one proves
// per-victim application.
// ---------------------------------------------------------------------------
describe('E3: per-victim purge count is independent — count:1 removes one buff per victim, not one total', () => {
    const defenceUp = (): Ability =>
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: 'Defence Up',
                parsedEffects: { defense: 20 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        });

    // A two-buff enemy: applies "Attack Up" THEN "Defence Up" every round, then hits.
    // appliedSeq for "Defence Up" > appliedSeq for "Attack Up" → "Defence Up" is newest-first,
    // so a count:1 purge removes "Defence Up" and leaves "Attack Up".
    const twoBuffEnemy = (id: string, position: Position) => ({
        id,
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: allPattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [attackUp(), defenceUp(), hit()],
                },
            ],
        },
    });

    // Focus: count:1 all-enemies purge + a basic hit so the positional harness fires.
    const countOnePurgeSkills = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'purge',
                        target: 'all-enemies',
                        config: { type: 'purge', count: 1 },
                    }),
                    hit(),
                ],
            },
        ],
    });

    const run = (): { front: string[]; back: string[] } => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...BASE(false /* aoe flag unused; we override shipSkills below */),
            shipSkills: countOnePurgeSkills(),
            enemyAttackers: [twoBuffEnemy('enemy-front', 'M4'), twoBuffEnemy('enemy-back', 'M3')],
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        return {
            front: engine!
                .timedAbilityStatuses('self', 'enemy-front')
                .map((b) => b.active.buffName),
            back: engine!.timedAbilityStatuses('self', 'enemy-back').map((b) => b.active.buffName),
        };
    };

    it('count:1 all-enemies purge removes exactly one buff from EACH enemy (newest Defence Up removed, Attack Up survives)', () => {
        const { front, back } = run();
        // Each enemy had two buffs; count:1 removes the newest-applied one ("Defence Up"),
        // leaving exactly one buff on each. The budget is per-victim — if pooled, one enemy
        // would keep both buffs.
        expect(front).toHaveLength(1);
        expect(front).toContain('Attack Up');
        expect(back).toHaveLength(1);
        expect(back).toContain('Attack Up');
    });
});

// ---------------------------------------------------------------------------
// E3 Test B — side-symmetry: an ENEMY all-enemies purge strips BOTH player buffs.
//
// Mirror of the player→enemy direction: two POSITIONED player actors both
// self-buff "Attack Up" each round. A single enemy fires an 'all'-pattern
// 'all-enemies' purge (count 5). Enemy speed is 50 < player speed 100, so the
// players act FIRST each round (self-buff), then the enemy purges — otherwise
// the enemy purges an empty store and players re-buff after (turn-order, not a
// plumbing gap — see purgeCastPath.test.ts side-symmetry comment).
//
// The focus ('attacker') carries its own active self-buff + hit. A walked team
// actor at M3 ('player-team') does the same via its walk bundle. Both players'
// self-buff stores are read via timedAbilityStatuses('self', id) after the run.
// ---------------------------------------------------------------------------
describe('E3: enemy all-enemies purge is side-symmetric — strips BOTH player self-buffs', () => {
    // Player focus self-buffs then hits — same active as the existing buffingEnemy helper.
    const selfBuffThenHitSkills = (): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [attackUp(), hit()] }],
    });

    // The single enemy: fires 'all-enemies' purge (count 5) + basic hit when purge=true,
    // or a plain hit-only active when purge=false (the control). Pattern 'all' so the
    // footprint covers EVERY positioned player. Speed 50 < player speed 100 so the
    // players self-buff first each round before the enemy acts.
    const purgeEnemy = (purge: boolean) => ({
        id: 'enemy-front',
        stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: allPattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: purge
                        ? [
                              ab({
                                  type: 'purge',
                                  target: 'all-enemies',
                                  config: { type: 'purge', count: 5 },
                              }),
                              hit(),
                          ]
                        : [hit()],
                },
            ],
        },
    });

    // Walked team actor at M3 — same harness shape as twoTeamBattle.test.ts teamAttackerAt,
    // but the walk shipSkills self-buff + hit. Speed 100 (default), so acts BEFORE the enemy.
    const playerTeamActor = (): TeamActorEngineInput => ({
        id: 'player-team',
        speed: 100,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M3',
        target: parsedTarget('front'),
        pattern: allPattern(),
        walk: {
            shipSkills: selfBuffThenHitSkills(),
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

    const run = (purge: boolean): { focus: string[]; team: string[] } => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            // Focus actor — self-buffs then hits, speed 100 (acts before the speed-50 enemy).
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: selfBuffThenHitSkills(),
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
            position: 'M4',
            target: parsedTarget('front'),
            pattern: allPattern(),
            teamActors: [playerTeamActor()],
            enemyAttackers: [purgeEnemy(purge)],
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        return {
            focus: engine!.timedAbilityStatuses('self', 'attacker').map((b) => b.active.buffName),
            team: engine!.timedAbilityStatuses('self', 'player-team').map((b) => b.active.buffName),
        };
    };

    it('CONTROL (enemy does not purge): both players KEEP their self-buff', () => {
        const { focus, team } = run(false);
        expect(focus).toEqual(['Attack Up']);
        expect(team).toEqual(['Attack Up']);
    });

    it('an ENEMY all-enemies purge empties the self-buff store of BOTH positioned players', () => {
        const { focus, team } = run(true);
        expect(focus).toEqual([]);
        expect(team).toEqual([]);
    });
});
