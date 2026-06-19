/**
 * B2 Task 2 — `isStasised(actorId)` per-actor Stasis reader (engine-internal tap).
 *
 * Design: the engine-local `isStasised` closure delegates to `ownerDebuffNames(actorId)`
 * (the same reader that drives condition gates) filtered by `isStasis` from stasisBuffs.ts.
 * It is exposed via `__testTapIsStasised` — mirrors the `__testTapVictimEnemyModifiers`
 * pattern from B1 Task 3.
 *
 * TEST CONTRACT:
 *
 *   Case (a) — enemy stasised by player:
 *     Focus 'attacker' at M4 fires `front` with a combined damage + Stasis inflict skill.
 *     Two positioned enemies on the roster (front and back). After a 2-round run the
 *     Stasis debuff has been applied to the FRONT enemy (the actual target). Assert:
 *       isStasised('enemy-front') === true
 *       isStasised('enemy-back') === false
 *
 *   Case (b) — player stasised by enemy:
 *     A positioned enemy fires `front` (the focus 'attacker') with a Stasis inflict skill.
 *     Two player actors (focus + one team attacker). After a 2-round run the Stasis debuff
 *     has been applied to the FOCUS player (the actual target). Assert:
 *       isStasised('attacker') === true
 *       isStasised('player-team') === false
 *
 * NOTE: duration 2 + numRounds 2 ensures Stasis is still active at assert time (status
 * is read POST-run from the captured live closure, which reads the statusEngine).
 * enemyDefense:0 / security:0 / hacking:200 ensures the inflict landing gate fires at
 * 100% (clamp((200 - 0) / 100, 0, 1) = 1.0) — mirrors how twoTeamBattle lands debuffs.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

// ── Harness helpers (mirrored from twoTeamBattle.test.ts / victimEnemyModifiers.test.ts) ──

let idc = 0;

const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `is${++idc}`,
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

// A damage+Stasis inflict active skill. `turns` controls how long Stasis lasts.
// security:0 on victims + hacking:200 on attacker → landing chance 1.0 (always lands).
const stasisInflictAttack = (turns: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Stasis',
                application: 'inflict',
                duration: turns,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
    ],
});

// A plain single-hit damage active skill (no debuff).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

// A positioned enemy attacker for the enemy roster.
const offensiveEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    skills: ShipSkills['slots'][number]
): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            // security:0 → the player's Stasis inflict always lands on this enemy.
            security: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: { slots: [skills] },
    }) as EnemyAttacker;

// A walked team actor with no offense (attack:0) and huge HP.
const passiveTeamActorAt = (id: string, position: Position): TeamActor => ({
    id,
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: { slots: [basicAttack()] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
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

// ── Tests ────────────────────────────────────────────────────────────────────────────────

describe('B2 Task 2 — isStasised: engine-local per-actor Stasis reader (tap only, unwired)', () => {
    it('(a) enemy stasised by player: front enemy is stasised, back enemy is not', () => {
        idc = 0;
        let capturedIsStasised: ((actorId: string) => boolean) | undefined;

        // Focus 'attacker' at M4 fires `front` with damage + Stasis inflict.
        // hacking:200 on focus, security:0 on enemies → landing chance 1.0 (lands round 1).
        // duration:2, numRounds:2 → Stasis is active at assert time (decrements rounds 1→0).
        runCombat({
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [stasisInflictAttack(2)] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 2,
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
            // hacking:200 → inflict landing chance = clamp((200 - 0) / 100) = 1.0.
            hacking: 200,
            // Positioned battle: focus at M4 fires front enemy.
            healTargetId: 'attacker',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            // Two enemies: front at M4 (the Stasis target), back at M1 (not targeted).
            enemyAttackers: [
                offensiveEnemyAt('enemy-front', 'M4', 'front', basicAttack()),
                offensiveEnemyAt('enemy-back', 'M1', 'back', basicAttack()),
            ],
            __testTapIsStasised: (fn) => {
                capturedIsStasised = fn;
            },
        });

        expect(capturedIsStasised).toBeDefined();
        // Only the front enemy (the actual Stasis target) carries the debuff.
        expect(capturedIsStasised!('enemy-front')).toBe(true);
        // The back enemy was never targeted → no Stasis.
        expect(capturedIsStasised!('enemy-back')).toBe(false);
    });

    it('(b) player stasised by enemy: focus attacker is stasised, team actor is not', () => {
        idc = 0;
        let capturedIsStasised: ((actorId: string) => boolean) | undefined;

        // Enemy fires `front` (anchors the focus 'attacker') with damage + Stasis inflict.
        // Enemy hacking:200, player actors security defaults to 100 in the formula →
        // landing chance = clamp((200 - 100) / 100) = 1.0 (always lands).
        // duration:2, numRounds:2 → Stasis is active at assert time.
        runCombat({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            // Focus has no offense (we only care about the enemy applying Stasis to it).
            shipSkills: { slots: [basicAttack()] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 2,
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
            // Positioned battle: focus at M4 (front-most player = Stasis target).
            healTargetId: 'attacker',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            // A second player actor at M3 (not targeted by the enemy).
            teamActors: [passiveTeamActorAt('player-team', 'M3')],
            // One enemy: fires `front` (focus) with Stasis inflict.
            // hacking:200 on the enemy, players have security:0 → landing chance 1.0.
            enemyAttackers: [
                {
                    id: 'stasis-enemy',
                    stats: {
                        attack: 5000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 200, // fast — acts before the focus so Stasis lands in round 1
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4' as Position,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisInflictAttack(2)] },
                } as EnemyAttacker,
            ],
            __testTapIsStasised: (fn) => {
                capturedIsStasised = fn;
            },
        });

        expect(capturedIsStasised).toBeDefined();
        // The focus ('attacker') was targeted by the enemy Stasis → carries the debuff.
        expect(capturedIsStasised!('attacker')).toBe(true);
        // The team actor at M3 was not targeted → no Stasis.
        expect(capturedIsStasised!('player-team')).toBe(false);
    });
});
