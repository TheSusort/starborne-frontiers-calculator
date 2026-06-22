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
         *   - Because familyApplicationWins allows overwrite when new duration > remaining,
         *     the focus re-applies Disable each round, perpetually keeping enemy-front disabled.
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

// ── B3 — reactive suppression while disabled ─────────────────────────────────────────────

/**
 * D-PR13 Task 3 — drain-time reactive suppression for Disable.
 *
 * While a unit is disabled, every queued reactive intent whose ownerId matches the
 * disabled actor is dropped at drainQueue's per-intent loop — IDENTICAL to Stasis.
 * This is achieved by routing the drain guard through `isTurnBlocked` (isStasised OR
 * isDisabled) rather than only isStasised.
 *
 * Two invariants proved (mirroring B3 Task 1 (a) and (c) for Stasis):
 *   (iv) on-attacked self-buff reactive on the PLAYER (focus) is suppressed while disabled.
 *   (v)  INCOMING effects (DoT ticks) on the disabled actor are UNTOUCHED.
 *
 * Non-vacuity: the stasis B3 tests (a) and (d) prove the reactive fires absent the
 * control; the symmetric structure here (same skill builder, same harness) guarantees
 * the reactive WOULD fire if Disable were not present — suppression is real.
 */

// Skill helpers for Disable B3 tests ─────────────────────────────────────────────────────

/**
 * A passive `on-attacked` self-buff slot: 'Counter Shield' (+10% attack, duration 99).
 * The focus carries this; when hit while NOT disabled it fires buff-applied 'Counter Shield'.
 * While disabled the intent's ownerId === 'attacker' → dropped by the drain guard.
 * (Copied from stasis.test.ts B3 — same helper, same semantics.)
 */
const onAttackedSelfBuffSlot = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'buff',
            target: 'self',
            trigger: 'on-attacked',
            config: {
                type: 'buff',
                buffName: 'Counter Shield',
                stacks: 1,
                parsedEffects: { attack: 10 },
                isStackable: false,
                duration: 99,
            },
        }),
    ],
});

// ── (iv) on-attacked counter suppressed while disabled ────────────────────────────────────

describe('D-PR13 Task 3 — reactive suppression: (iv) on-attacked self-buff suppressed while focus is disabled', () => {
    it('a disabled focus does NOT receive its on-attacked buff when the enemy strikes it', () => {
        idc = 0;
        /**
         * Setup (mirrors stasis B3 (a) but with Disable):
         *   - Focus ('attacker') at POS_FOCUS carries onAttackedSelfBuffSlot.
         *     Speed 50 — SLOWER than the enemies so the enemy acts FIRST each round.
         *   - disable-enemy (id='disable-enemy', speed=200): fires disableInflictAttack(4)
         *     at 'front' player (= focus at M4) in round 1. Disable(4) keeps the focus
         *     disabled for rounds 1–4.
         *   - attack-enemy (id='attack-enemy', speed=100): a bare flat-card attacker that
         *     hits the focus every round (speed 100 > focus speed 50, acts before focus).
         *   - numRounds: 4.
         *
         * Round ordering each round: disable-enemy(200) → attack-enemy(100) → focus(50)
         *
         * Round 1:
         *   disable-enemy applies Disable(4) to focus.
         *   attack-enemy attacks focus → focus is disabled → `attacked` event fires → listener
         *   enqueues intent(ownerId='attacker') → drain guard: isTurnBlocked('attacker')=true → DROP.
         *   No 'Counter Shield' buff-applied in round 1.
         *   focus's own turn: disabled → skip.
         *
         * Rounds 2–4: attack-enemy attacks focus every round → intent dropped → no Counter Shield.
         *
         * Assert: zero 'buff-applied' events for 'Counter Shield' on actorId='attacker' across
         *   all 4 rounds (the listener fires, the intent enqueues, but drain discards it).
         */
        const bus = createEventBus();
        const buffApplied: CombatEvent[] = [];
        bus.on('buff-applied', (e) => buffApplied.push(e as CombatEvent));

        runCombat({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [onAttackedSelfBuffSlot()] },
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
            hacking: 0, // focus cannot inflict anything
            speed: 50, // SLOWER than all enemies → enemies always act before focus
            healTargetId: 'attacker',
            position: POS_FOCUS, // M4 = front-most player
            target: parsedTarget('front'),
            pattern: basePattern(),
            bus,
            enemyAttackers: [
                // disable-enemy: applies Disable(4) to the front player (focus).
                {
                    id: 'disable-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 200, // fastest — acts first
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [disableInflictAttack(4)] },
                } as EnemyAttacker,
                // attack-enemy: bare attacker that triggers the on-attacked listener each round.
                {
                    id: 'attack-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 100, // acts after disable-enemy, before focus
                        security: 0,
                        hacking: 0,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_BACK,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [basicAttack()] },
                } as EnemyAttacker,
            ],
        });

        // The on-attacked intent was enqueued each round (the enemy hit the focus), but the
        // drain guard must have dropped every one (focus disabled rounds 1–4).
        // → Zero 'Counter Shield' buff-applied events for the focus.
        const counterShield = buffApplied.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-applied' }> =>
                e.type === 'buff-applied' &&
                e.actorId === 'attacker' &&
                e.buffName === 'Counter Shield'
        );
        expect(counterShield).toHaveLength(0);
    });
});

// ── (v) incoming DoT still ticks on a disabled actor ─────────────────────────────────────

describe('D-PR13 Task 3 — reactive suppression: (v) incoming DoT still ticks on a disabled actor', () => {
    it('a DoT applied by an enemy still ticks on the disabled focus — incoming effects are not suppressed', () => {
        idc = 0;
        /**
         * Mirrors stasis B3 (c): only the disabled actor's OWN outgoing intents are suppressed.
         * Incoming DoT ticks (tickDoTs at turn-start) are completely unaffected.
         *
         * Setup: dot-disable-enemy applies Corrosion + Disable(2) in round 1.
         *   dot-disable-enemy (speed=120) acts BEFORE focus (speed=50) in every round.
         *   Round 1: applies Corrosion(tier=5, stacks=3, dur=10) + Disable(2) to focus.
         *   Rounds 1–2: focus disabled; dot-ticked events must still appear for 'attacker'.
         *
         * Assert: dot-ticked events for targetId='attacker' fire in both round 1 AND round 2
         *   (incoming effects are untouched regardless of Disable).
         */
        const { events } = run({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [] },
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
            speed: 50, // focus slower → enemy always acts first
            healTargetId: 'attacker',
            enemyAttackers: [
                {
                    id: 'dot-disable-enemy',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 120, // fast — always acts before the focus
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    shipSkills: {
                        slots: [
                            {
                                slot: 'active',
                                abilities: [
                                    // Apply corrosion DoT
                                    ab({
                                        type: 'dot',
                                        target: 'enemy',
                                        config: {
                                            type: 'dot',
                                            dotType: 'corrosion',
                                            tier: 5,
                                            stacks: 3,
                                            duration: 10,
                                        },
                                    }),
                                    // Apply Disable to the heal target
                                    ab({
                                        type: 'debuff',
                                        target: 'enemy',
                                        config: {
                                            type: 'debuff',
                                            buffName: 'Disable',
                                            application: 'inflict',
                                            duration: 2,
                                            stacks: 1,
                                            isStackable: false,
                                            parsedEffects: {},
                                        },
                                    }),
                                ],
                            },
                        ],
                    },
                } as EnemyAttacker,
            ],
        });

        const dotTicked = events.filter(
            (e): e is Extract<CombatEvent, { type: 'dot-ticked' }> => e.type === 'dot-ticked'
        );

        // Focus is disabled in rounds 1–2 (enemy acts first in round 1 and applies both DoT
        // and Disable, then focus's turn is skipped in rounds 1–2 but DoT ticks at turn-start).
        // Incoming DoT must still fire for 'attacker' in rounds 1 AND 2.
        const dotRoundsForFocus = dotTicked
            .filter((e) => e.targetId === 'attacker')
            .map((e) => e.round);
        expect(dotRoundsForFocus).toContain(1);
        expect(dotRoundsForFocus).toContain(2);
    });
});

// ── D-PR13 Task 4 — cleanse-resume: a cleansed Disable restores the walk ──────────────────

/**
 * Disable is a REMOVABLE debuff (NOT in UNREMOVABLE_STATUSES), and the turn-action gate
 * reads `ownerDebuffNames(id)` LIVE at each turn. So a `cleanse` that removes the Disable
 * debuff from the focus's per-actor debuff store lets the focus resume acting on its very
 * next scheduled turn — with NO extra production code. This test locks that.
 *
 * `cleanse` config shape (copied from cleanseCastPath.test.ts): { type: 'cleanse', count: 'all' }.
 * Targeting 'all-allies' so the player-side cleanser reaches every player ally's debuff store,
 * including the focus (the heal target).
 */
const cleanseAllAlliesSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'cleanse',
            target: 'all-allies',
            config: { type: 'cleanse', count: 'all' },
        }),
    ],
});

/** A walked team actor carrying a cleanse-all-allies active (mirrors teamAttackerAt's walk shape). */
const teamCleanserAt = (id: string, position: Position, speedOverride: number): TeamActor => ({
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
        shipSkills: { slots: [cleanseAllAlliesSlot()] },
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

describe('D-PR13 Task 4 — cleanse-resume: a cleansed Disable restores the focus walk', () => {
    it('a same-side cleanser removes Disable(5) so the focus resumes acting immediately, NOT after the natural Disable expiry', () => {
        idc = 0;
        /**
         * Setup (mirrors the disable-bot + killer pattern from tests (ii)/(iii)):
         *   - disable-bot at POS_ENEMY_FRONT (speed=400, hp=1, hacking=200):
         *     acts first in round 1, fires disableInflictAttack(5) at 'front' (= focus).
         *     Then it is killed → Disable is NOT re-applied in later rounds.
         *   - killer (team actor, speed=300, attack=10000): acts after the bot, kills it in round 1.
         *   - cleanser (team actor, speed=200, attack=0): acts AFTER the killer but BEFORE the
         *     focus; its walk carries cleanseAllAlliesSlot → it cleanses every player ally,
         *     removing the freshly-applied Disable from the focus's debuff store.
         *   - focus ('attacker', speed=100, basicAttack): acts LAST. By its turn the cleanser
         *     has already removed Disable → the live gate sees no Disable → the focus FIRES.
         *   - numRounds:3.
         *
         * Round 1 turn order: disable-bot(400) → killer(300) → cleanser(200) → focus(100)
         *   1. disable-bot applies Disable(5) to focus.
         *   2. killer kills disable-bot (no re-apply possible later).
         *   3. cleanser cleanses all allies → focus's Disable is REMOVED.
         *   4. focus's turn: live gate reads ownerDebuffNames('attacker') → no Disable → FIRES.
         *
         * KEY PROOF: WITHOUT the cleanse, Disable(5) keeps the focus disabled rounds 1–5 (it
         * would only act in round 6). WITH the per-round cleanse the focus acts in round 1 —
         * far earlier than the natural expiry. No production change is required: the gate read
         * is live, so removing the debuff frees the unit on its next scheduled turn.
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
            speed: 100, // focus is the slowest → acts LAST every round
            healTargetId: 'attacker', // focus is the disabled unit → player-side cleanse reaches it
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [
                teamAttackerAt('killer', POS_TEAM, 300, 10000),
                teamCleanserAt('cleanser', POS_TEAM, 200),
            ],
            enemyAttackers: [
                {
                    id: 'disable-bot',
                    stats: {
                        attack: 2000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1, // killed by killer in round 1 → cannot re-apply Disable
                        speed: 400, // acts before killer(300), cleanser(200), focus(100)
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [disableInflictAttack(5)] },
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

        // The cleanser removes Disable before the focus's round-1 turn → focus FIRES round 1.
        // This is only reachable if Disable was removed: Disable(5) would otherwise block
        // rounds 1–5 (natural expiry at round 6, beyond this 3-round battle).
        expect(focusFiredRounds).toContain(1);
        // Non-vacuity: the focus fires in a round strictly < 5 — impossible under an
        // unremoved Disable(5). Proves the cleanse genuinely freed the walk.
        expect(focusFiredRounds.some((r) => r < 5)).toBe(true);

        expect(result.rounds).toHaveLength(3);
    });
});
