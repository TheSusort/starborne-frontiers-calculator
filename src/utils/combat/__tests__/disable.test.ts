/**
 * D-PR13 Task 2 — Disable turn-skip integration tests.
 *
 * Disable mirrors Stasis on the turn-action gate (a disabled unit skips its scheduled
 * action), but DIVERGES on two axes:
 *   - Disable is NOT broken by a direct hit (Stasis is).
 *   - Disable grants NO damage immunity (hits land normally).
 *
 * Three invariants:
 *   (i)   A disabled enemy skips its action.
 *   (ii)  Disable(2) decrements on skipped turns → exactly 2 skips.
 *   (iii) Disable does NOT break on a direct hit, and damage still lands.
 *
 * Harness mirrors stasis.test.ts (ab / basicAttack / disableInflictAttack / parsedTarget /
 * basePattern / teamAttackerAt / offensiveEnemyAt). The run helper additionally collects
 * 'hp-changed' to prove incoming damage (the `attacked` event carries no damage field).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

// ── ID counter (reset per test block via `idc = 0`) ─────────────────────────────────────
let idc = 0;

const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `dis${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// ── Skill builders ───────────────────────────────────────────────────────────────────────

/** A single-hit 100% damage active skill (no status). */
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

/**
 * A combined damage + Disable-inflict active skill.
 * hacking:200 + security:0 on victims → landing chance 1.0 (always lands).
 */
const disableInflictAttack = (turns: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Disable',
                application: 'inflict',
                duration: turns,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
    ],
});

// ── ParsedTarget / Pattern helpers ──────────────────────────────────────────────────────

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// ── Actor builders ───────────────────────────────────────────────────────────────────────

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

/**
 * A positioned enemy attacker with a configurable skill.
 * security:0 → player Disable inflict always lands on this enemy.
 */
const offensiveEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    skills: ShipSkills['slots'][number],
    speedOverride = 1
): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 2000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: speedOverride,
            security: 0,
            hacking: 200,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: { slots: [skills] },
    }) as EnemyAttacker;

/** A walked team actor. attackOverride defaults to 0 (no offense). */
const teamAttackerAt = (
    id: string,
    position: Position,
    speedOverride = 100,
    attackOverride = 0
): TeamActor => ({
    id,
    speed: speedOverride,
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
            attack: attackOverride,
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

// ── Position constants ────────────────────────────────────────────────────────────────────
const POS_FOCUS: Position = 'M4'; // front-most player
const POS_TEAM: Position = 'M3';
const POS_ENEMY_FRONT: Position = 'M4';
const POS_ENEMY_BACK: Position = 'M1';

// ── Run helper (collects all relevant events) ─────────────────────────────────────────────

const INTERESTING_TYPES: CombatEvent['type'][] = [
    'ability-performed',
    'attacked',
    'dot-ticked',
    'buff-applied',
    'buff-expired',
    'debuff-applied',
    'ship-destroyed',
    'hp-changed',
];

const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const t of INTERESTING_TYPES) {
        bus.on(t, (e) => events.push(e as CombatEvent));
    }
    const result = runCombat({ ...input, bus });
    return { events, result };
};

// ── (i) ENEMY disabled by player: skips action ───────────────────────────────────────────

describe('D-PR13 Task 2 — Disable turn-skip: (i) disabled enemy skips its action', () => {
    it('a disabled enemy deals NO damage and emits NO ability-performed on the skipped turns', () => {
        idc = 0;
        /**
         * Setup (mirrors stasis (i) but with Disable):
         *   - Focus at POS_FOCUS fires `front` with disableInflictAttack(2) EVERY round.
         *     player speed 100 > enemy speed 1 → focus always acts before enemy-front.
         *   - The focus re-applies Disable each round, perpetually keeping enemy-front disabled.
         *   - enemy-front is therefore NEVER able to act across all 4 rounds.
         *   - enemy-back at M1 is not targeted (focus targets 'front' = M4) → acts normally
         *     every round (control).
         *   - numRounds:4.
         */
        const { events, result } = run({
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [disableInflictAttack(2)] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
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
            hp: 1_000_000_000,
            hacking: 200,
            healTargetId: 'attacker',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [
                offensiveEnemyAt('enemy-front', POS_ENEMY_FRONT, 'front', basicAttack()),
                offensiveEnemyAt('enemy-back', POS_ENEMY_BACK, 'back', basicAttack()),
            ],
        });

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );

        // enemy-front is perpetually disabled and NEVER fires in any of the 4 rounds.
        const frontActedInRound = (r: number) =>
            abilityPerformed.some((e) => e.actorId === 'enemy-front' && e.round === r);
        for (let r = 1; r <= 4; r++) {
            expect(frontActedInRound(r)).toBe(false);
        }

        // No 'attacked' events from enemy-front at all (it never deals damage).
        const attackedByFront = events.filter(
            (e): e is Extract<CombatEvent, { type: 'attacked' }> =>
                e.type === 'attacked' && e.attackerId === 'enemy-front'
        );
        expect(attackedByFront).toHaveLength(0);

        // The non-disabled enemy-back always fires (control: no effect on it).
        for (let r = 1; r <= 4; r++) {
            expect(abilityPerformed.some((e) => e.actorId === 'enemy-back' && e.round === r)).toBe(
                true
            );
        }

        expect(result.rounds).toHaveLength(4);
    });
});

// ── (ii) Disable(2) decrements on skipped turns → exactly 2 skips ────────────────────────

describe('D-PR13 Task 2 — Disable turn-skip: (ii) Disable(2) decrements on skipped turn → exactly 2 skips', () => {
    it('the disabled actor skips rounds 1-2 and fires on round 3 (the round after expiry)', () => {
        idc = 0;
        /**
         * Setup (disable-bot dies after round 1 so it cannot re-apply Disable):
         *   - focus at POS_FOCUS (speed=100, basicAttack): disabled for rounds 1-2, fires round 3.
         *   - killer at POS_TEAM (speed=200, attack=10000): acts before focus, kills disable-bot.
         *   - disable-bot at POS_ENEMY_FRONT (speed=300, hp=1, hacking=200):
         *     acts first in round 1, fires disableInflictAttack(2) targeting 'front' (=focus).
         *     Then killer kills it. Dead → cannot re-apply Disable in round 2+.
         *   - numRounds:3.
         *
         * Round 1 order: disable-bot(300) → killer(200) → focus(100)
         *   1. disable-bot fires Disable(2) on focus.
         *   2. killer kills disable-bot.
         *   3. focus disabled → skip. Post-Turn: Disable 2→1.
         * Round 2: disable-bot dead. killer fires. focus disabled(1) → skip. Post-Turn: 1→0 EXPIRED.
         * Round 3: focus NOT disabled → fires.
         */
        const { events, result } = run({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [basicAttack()] },
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
            hacking: 0,
            healTargetId: 'attacker',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                {
                    id: 'disable-bot',
                    stats: {
                        attack: 2000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1, // killed by killer in round 1 → cannot re-apply Disable
                        speed: 300, // acts before killer(200) and focus(100)
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [disableInflictAttack(2)] },
                } as EnemyAttacker,
            ],
        });

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );
        const focusFiredRounds = abilityPerformed
            .filter((e) => e.actorId === 'attacker')
            .map((e) => e.round);

        expect(focusFiredRounds).not.toContain(1); // skip 1
        expect(focusFiredRounds).not.toContain(2); // skip 2
        expect(focusFiredRounds).toContain(3); // expired → acts

        expect(result.rounds).toHaveLength(3);
    });
});

// ── (iii) Disable does NOT break on a direct hit, and damage still lands ──────────────────

describe('D-PR13 Task 2 — Disable turn-skip: (iii) Disable does NOT break on a direct hit', () => {
    it('a disabled focus stays disabled across direct hits (no break) and still takes damage (no immunity)', () => {
        idc = 0;
        /**
         * KEY DIVERGENCE from Stasis: a direct hit does NOT break Disable.
         *
         * Setup:
         *   - disable-bot (speed=300, hp=1, hacking=200) at POS_ENEMY_FRONT fires
         *     disableInflictAttack(3) at 'front' (=focus) in round 1. Acts first.
         *   - killer (speed=200, attack=10000) kills disable-bot in round 1.
         *   - breaker (offensiveEnemyAt at POS_ENEMY_BACK, speed=150) hits the focus with a
         *     plain direct attack every round.
         *   - focus (speed=100, attack 0, hp 1e9): disabled for rounds 1-3, fires round 4.
         *     A Stasis would break on the breaker's hits; Disable must NOT.
         *   - numRounds:4.
         */
        const { events, result } = run({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [basicAttack()] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
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
            hp: 1_000_000_000,
            hacking: 0,
            speed: 100,
            healTargetId: 'attacker',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                {
                    id: 'disable-bot',
                    stats: {
                        attack: 2000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1, // killed by killer in round 1 → cannot re-apply Disable
                        speed: 300, // acts before killer(200), breaker(150), focus(100)
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [disableInflictAttack(3)] },
                } as EnemyAttacker,
                // breaker: plain direct hit at the focus every round (would break Stasis).
                offensiveEnemyAt('breaker', POS_ENEMY_BACK, 'front', basicAttack(), 150),
            ],
        });

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );
        const focusRounds = abilityPerformed
            .filter((e) => e.actorId === 'attacker')
            .map((e) => e.round);

        expect(focusRounds).not.toContain(1);
        expect(focusRounds).not.toContain(2);
        expect(focusRounds).not.toContain(3); // NOT broken by the breaker's hits (Stasis WOULD break)
        expect(focusRounds).toContain(4);

        // No immunity: focus HP declined while disabled (attacked has no damage field — use hp-changed).
        const focusHp = events.filter(
            (e): e is Extract<CombatEvent, { type: 'hp-changed' }> =>
                e.type === 'hp-changed' && e.targetId === 'attacker'
        );
        expect(focusHp.length).toBeGreaterThan(0);
        expect(focusHp.some((e) => e.newPct < e.oldPct)).toBe(true);

        expect(result.rounds).toHaveLength(4);
    });
});
