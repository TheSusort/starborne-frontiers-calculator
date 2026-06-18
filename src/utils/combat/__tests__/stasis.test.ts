/**
 * B2 Task 3 — Stasis turn-skip integration tests.
 *
 * These tests prove the three invariants of the action-only Stasis gate in engine.ts:
 *   (i)   A stasised actor skips its action (no damage / no ability-performed).
 *   (ii)  DoTs on a stasised actor still tick on the skipped turn.
 *   (iii) Stasis(N) decrements on the skipped turn → expires after exactly N skips.
 *   (iv)  Other timed statuses still decrement during the skip (decrementEnemy/Player runs).
 *   (v)   A non-stasised actor is completely unaffected (control/symmetry check).
 *   (vi)  Player stasised by an enemy — round still assembles, focus gets a synthesized turn.
 *
 * Harness mirrors isStasised.test.ts + twoTeamBattle.test.ts (ab / basicAttack /
 * stasisInflictAttack / parsedTarget / basePattern / teamAttackerAt / offensiveEnemyAt).
 * DoT pattern follows barrier.test.ts (healing mode, enemy-applied DoT, dot-ticked events).
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
    id: `st${++idc}`,
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
 * A combined damage + Stasis-inflict active skill.
 * hacking:200 + security:0 on victims → landing chance 1.0 (always lands).
 */
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

/**
 * An active skill that applies a corrosion DoT (tier 5, 3 stacks, duration 5).
 * Used to land a DoT on the heal target so we can verify it still ticks on a stasised turn.
 */
const _corrosionDoTSkill = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'dot',
            target: 'enemy',
            config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 3, duration: 5 },
        }),
    ],
});

/**
 * An active skill that inflicts a timed Defense Down debuff (duration: turns).
 * Used for test (iv) — a second timed debuff that must expire on schedule even
 * while the actor is stasised.
 */
const _defenseDownInflict = (turns: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Defense Down',
                application: 'inflict',
                duration: turns,
                stacks: 1,
                isStackable: false,
                parsedEffects: { defense: -10 },
            },
        }),
    ],
});

/**
 * A combined damage + Stasis + Defense Down active skill.
 * Used in test (iv) to apply two timed statuses simultaneously to the same target.
 */
const stasisAndDefenseDownAttack = (
    stasisTurns: number,
    ddTurns: number
): ShipSkills['slots'][number] => ({
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
                duration: stasisTurns,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Defense Down',
                application: 'inflict',
                duration: ddTurns,
                stacks: 1,
                isStackable: false,
                parsedEffects: { defense: -10 },
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
 * security:0 → player Stasis inflict always lands on this enemy.
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

// ── (i) ENEMY stasised by player: skips action ───────────────────────────────────────────

describe('B2 Task 3 — Stasis turn-skip: (i) stasised enemy skips its action', () => {
    it('a stasised enemy deals NO damage and emits NO ability-performed on the skipped turns', () => {
        idc = 0;
        /**
         * Setup:
         *   - Focus at POS_FOCUS fires `front` with stasisInflictAttack(2) EVERY round.
         *     player speed 100 > enemy speed 1 → focus always acts before enemy-front.
         *   - Because familyApplicationWins allows overwrite when new duration > remaining,
         *     the focus re-applies Stasis each round, perpetually keeping enemy-front stasised.
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
            shipSkills: { slots: [stasisInflictAttack(2)] },
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
            // enemy-front at M4: the focus's `front` target → receives Stasis every round.
            // enemy-back at M1 acts normally throughout (control).
            enemyAttackers: [
                offensiveEnemyAt('enemy-front', POS_ENEMY_FRONT, 'front', basicAttack()),
                offensiveEnemyAt('enemy-back', POS_ENEMY_BACK, 'back', basicAttack()),
            ],
        });

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );

        // The focus re-applies Stasis every round (acts first at speed 100 > enemy speed 1).
        // enemy-front is perpetually stasised and NEVER fires in any of the 4 rounds.
        const frontActedInRound = (r: number) =>
            abilityPerformed.some((e) => e.actorId === 'enemy-front' && e.round === r);

        for (let r = 1; r <= 4; r++) {
            expect(frontActedInRound(r)).toBe(false); // perpetually stasised
        }

        // No 'attacked' events from enemy-front at all (it never deals damage).
        const attackedByFront = events.filter(
            (e): e is Extract<CombatEvent, { type: 'attacked' }> =>
                e.type === 'attacked' && e.attackerId === 'enemy-front'
        );
        expect(attackedByFront).toHaveLength(0);

        // The non-stasised enemy-back always fires (control: no effect on it).
        for (let r = 1; r <= 4; r++) {
            expect(abilityPerformed.some((e) => e.actorId === 'enemy-back' && e.round === r)).toBe(
                true
            );
        }

        // The round is fully assembled each round (no throws, result has 4 rounds).
        expect(result.rounds).toHaveLength(4);
    });
});

// ── (ii) DoTs still tick on a stasised actor ──────────────────────────────────────────────

describe('B2 Task 3 — Stasis turn-skip: (ii) DoTs still tick on a stasised actor', () => {
    it('corrosion DoT ticks on a stasised heal target on the skipped turn', () => {
        idc = 0;
        /**
         * Setup (healing mode, mirroring barrier.test.ts):
         *   - Focus is the heal target (speed 50 — slower than the enemies).
         *   - Enemy "dot-applier" (speed 120) applies Corrosion + Stasis in round 1.
         *     (Both in round 1 since it acts BEFORE the focus at speed 120 > 50.)
         *   - After Stasis is applied, the focus is stasised; on its own skipped turns
         *     the DoT-tick prologue (tickDoTs at turn-start) MUST still run.
         *   - We assert dot-ticked events fire for the focus actor on its stasised turn.
         *
         * Turn order: dot-applier (speed 120) > focus (speed 50).
         *   Round 1: dot-applier applies corrosion + Stasis → focus is stasised.
         *            focus's turn: stasised → skipped; but DoT should tick at turn-start.
         *   Round 2: focus is stasised for 1 more turn (duration 2); DoT ticks again.
         *   Round 3: Stasis expired → focus acts normally.
         *
         * The corrosion DoT is in the heal target's containers (enemy applied it to the tank).
         * tickDoTs runs at the START of healTarget's turn (turn-start block in the engine).
         */
        const { events } = run({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [] }, // focus does nothing
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
            speed: 50, // focus is SLOWER so enemy always acts first
            healTargetId: 'attacker',
            enemyAttackers: [
                {
                    id: 'dot-stasis-enemy',
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
                    // No position — non-positional, single target: the heal target.
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
                                    // Apply Stasis to the heal target
                                    ab({
                                        type: 'debuff',
                                        target: 'enemy',
                                        config: {
                                            type: 'debuff',
                                            buffName: 'Stasis',
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

        // Rounds where the heal target is stasised: rounds 1 and 2 (the enemy acts first and
        // applies Stasis in round 1 before the focus's own turn).
        // The DoT tick fires at the START of the healTarget's turn — it should fire even when
        // the focus is stasised. Both rounds 1 and 2 must have a dot-ticked for 'attacker'.
        const dotRounds = dotTicked.filter((e) => e.targetId === 'attacker').map((e) => e.round);

        // DoT was applied in round 1 by the enemy; it should tick at the focus's turn-start
        // in rounds 1, 2, 3, 4 (DoT duration 10 >> numRounds 4).
        // With Stasis in rounds 1 and 2, the DoT tick must still fire.
        expect(dotRounds).toContain(1);
        expect(dotRounds).toContain(2);
        expect(dotRounds).toContain(3); // not stasised — acts, DoT still ticks
        // Non-vacuous: there ARE dot-ticked events on the stasised turns (1 + 2).
        expect(dotTicked.filter((e) => e.targetId === 'attacker' && e.round <= 2)).toHaveLength(2);
    });
});

// ── (iii) Stasis(2) decrements on skipped turns → exactly N skips ────────────────────────

describe('B2 Task 3 — Stasis turn-skip: (iii) Stasis(2) decrements on skipped turn → exactly 2 skips', () => {
    it('isStasised is true in skip-rounds and false thereafter; the actor fires on the round after expiry', () => {
        idc = 0;
        let capturedIsStasised: ((actorId: string) => boolean) | undefined;

        /**
         * Setup (stasis-enemy dies after round 1 so it cannot re-apply Stasis):
         *   - focus at POS_FOCUS (speed=100, basicAttack): stasised for rounds 1-2, fires in round 3.
         *   - killer at POS_TEAM (id='killer', speed=200, attack=10000): acts before focus,
         *     kills the stasis-bot (hp=1) in round 1. Target: front (stasis-bot at POS_ENEMY_FRONT).
         *   - stasis-bot at POS_ENEMY_FRONT (id='stasis-bot', speed=300, hp=1, hacking=200):
         *     acts first in round 1, fires stasisInflictAttack(2) targeting 'front' player (=focus).
         *     Then killer kills it. Dead → cannot re-apply Stasis in round 2+.
         *   - numRounds:3.
         *
         * Round 1 order: stasis-bot(300) → killer(200) → focus(100)
         *   1. stasis-bot fires Stasis(2) on focus.
         *   2. killer kills stasis-bot (attack 10000 >> hp 1).
         *   3. focus stasised → skip. Post-Turn: Stasis 2→1.
         * Round 2: stasis-bot dead. killer fires. focus stasised(1) → skip. Post-Turn: Stasis 1→0 → EXPIRED.
         * Round 3: focus NOT stasised → fires.
         *
         * The __testTapIsStasised tap is used to verify isStasised('attacker') is false post-run.
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
                    id: 'stasis-bot',
                    stats: {
                        attack: 2000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1, // killed by killer in round 1 → cannot re-apply Stasis
                        speed: 300, // acts before killer(200) and focus(100)
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisInflictAttack(2)] },
                } as EnemyAttacker,
            ],
            __testTapIsStasised: (fn) => {
                capturedIsStasised = fn;
            },
        });

        // Tap closure reads LIVE status engine state post-run.
        // After 3 rounds, Stasis(2) was decremented twice (rounds 1 and 2 skips) → fully expired.
        expect(capturedIsStasised).toBeDefined();
        expect(capturedIsStasised!('attacker')).toBe(false);

        // The ability-performed proxy: focus must NOT fire in rounds 1-2 (stasised), DOES fire in round 3.
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

        // Rounds assembled correctly (no throw).
        expect(result.rounds).toHaveLength(3);
    });
});

// ── (iv) Other timed statuses still decrement during a skip ─────────────────────────────

describe('B2 Task 3 — Stasis turn-skip: (iv) other timed statuses still decrement during skip', () => {
    it('a Defense Down debuff inflicted alongside Stasis expires on the correct round even though the victim is stasised', () => {
        idc = 0;
        /**
         * Setup (stasis-enemy dies after round 1 so it cannot re-apply debuffs):
         *   - focus at POS_FOCUS (speed=100, basicAttack): the victim of Stasis + DefenseDown.
         *   - killer at POS_TEAM (id='killer', speed=200, attack=10000): kills stasis-dd-enemy in round 1.
         *   - stasis-dd-enemy at POS_ENEMY_FRONT (id='stasis-dd-enemy', speed=300, hp=1, hacking=200):
         *     fires stasisAndDefenseDownAttack(3, 2) in round 1, applying Stasis(3) + DefenseDown(2) to focus.
         *     Killer kills it after. Dead → cannot re-apply debuffs.
         *   - numRounds:4.
         *
         * Round 1: stasis-dd-enemy fires Stasis(3)+DefenseDown(2) on focus. Killer kills stasis-dd-enemy.
         *          Focus stasised → skip. Post-Turn: Stasis 3→2, DefenseDown 2→1.
         * Round 2: stasis-dd-enemy dead. Killer fires. Focus stasised(2) → skip.
         *          Post-Turn: Stasis 2→1, DefenseDown 1→0 → EXPIRED → buff-expired('Defense Down', round=2).
         * Round 3: stasis-dd-enemy dead. Focus stasised(1) → skip. Post-Turn: Stasis 1→0 → EXPIRED.
         * Round 4: Focus NOT stasised → fires.
         *
         * hacking:200 on stasis-dd-enemy, security:0 on focus → landing chance 1.0. All debuffs land.
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
            healTargetId: 'attacker',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                {
                    id: 'stasis-dd-enemy',
                    stats: {
                        attack: 2000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1, // killed by killer in round 1 → cannot re-apply debuffs
                        speed: 300, // acts before killer(200) and focus(100)
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisAndDefenseDownAttack(3, 2)] },
                } as EnemyAttacker,
            ],
        });

        const buffExpired = events.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-expired' }> => e.type === 'buff-expired'
        );

        // Defense Down(2) was applied to the focus (actorId='attacker') in round 1.
        // Post-turn decrement runs each round even while stasised.
        // Round 1 post-turn: 2→1; Round 2 post-turn: 1→0 → expired (event fires on round 2).
        const defenseDownExpired = buffExpired.filter(
            (e) => e.actorId === 'attacker' && e.buffName === 'Defense Down'
        );
        expect(defenseDownExpired).toHaveLength(1);
        expect(defenseDownExpired[0].round).toBe(2);

        // Focus is stasised in rounds 1-3 (Stasis(3)) → no ability-performed in those rounds.
        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );
        const focusFiredRounds = abilityPerformed
            .filter((e) => e.actorId === 'attacker')
            .map((e) => e.round);
        expect(focusFiredRounds).not.toContain(1);
        expect(focusFiredRounds).not.toContain(2);
        expect(focusFiredRounds).not.toContain(3);
        expect(focusFiredRounds).toContain(4); // fires after Stasis expired

        // Rounds assembled correctly.
        expect(result.rounds).toHaveLength(4);
    });
});

// ── (v) Non-stasised actor unaffected ────────────────────────────────────────────────────

describe('B2 Task 3 — Stasis turn-skip: (v) non-stasised actor fires normally every round', () => {
    it('enemy-back (never stasised) fires ability-performed in every round', () => {
        idc = 0;
        /**
         * Focus fires `front` with Stasis → only enemy-front is stasised.
         * enemy-back fires `back` (a team actor at M3) — never stasised.
         * Assert: enemy-back emits ability-performed in every round.
         */
        const { events, result } = run({
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [stasisInflictAttack(2)] },
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
            target: parsedTarget('front'), // focus Stasis-inflicts enemy-front
            pattern: basePattern(),
            teamActors: [teamAttackerAt('player-team', POS_TEAM)],
            enemyAttackers: [
                offensiveEnemyAt('enemy-front', POS_ENEMY_FRONT, 'front', basicAttack()),
                offensiveEnemyAt('enemy-back', POS_ENEMY_BACK, 'back', basicAttack()),
            ],
        });

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );

        // enemy-back must fire in all 4 rounds.
        for (let r = 1; r <= 4; r++) {
            expect(abilityPerformed.some((e) => e.actorId === 'enemy-back' && e.round === r)).toBe(
                true
            );
        }

        // Confirm the focus fires in all 4 rounds too (player-side control).
        for (let r = 1; r <= 4; r++) {
            expect(abilityPerformed.some((e) => e.actorId === 'attacker' && e.round === r)).toBe(
                true
            );
        }

        expect(result.rounds).toHaveLength(4);
    });
});

// ── (vi) Player stasised by enemy: round assembles, focus gets synthesized turn ──────────

describe('B2 Task 3 — Stasis turn-skip: (vi) player stasised by enemy — round still assembles', () => {
    it('the focus (stasised by an enemy) fires no ability-performed but the round assembles and the team actor still fires', () => {
        idc = 0;
        /**
         * Setup (stasis-enemy dies after round 1 so Stasis expires naturally on the focus):
         *   - focus at POS_FOCUS (speed=100, attack=0, basicAttack): stasised rounds 1-2, fires round 3.
         *   - player-team at POS_TEAM (id='player-team', speed=150, attack=10000):
         *     acts between stasis-enemy and focus; kills stasis-enemy (hp=1) in round 1.
         *   - stasis-enemy at POS_ENEMY_FRONT (id='stasis-enemy', speed=200, hp=1, hacking=200):
         *     acts first in round 1, fires stasisInflictAttack(2) on focus (front player at M4).
         *     player-team kills it. Dead → cannot re-apply Stasis in rounds 2+.
         *   - numRounds:3.
         *
         * Round 1 order: stasis-enemy(200) → player-team(150) → focus(100)
         *   1. stasis-enemy fires Stasis(2) on focus.
         *   2. player-team fires at front enemy (stasis-enemy at POS_ENEMY_FRONT), kills it.
         *   3. focus stasised → skip (synthesized focus turn pushed). Post-Turn: Stasis 2→1.
         * Round 2: stasis-enemy dead. player-team fires. focus stasised(1) → skip. Post-Turn: Stasis 1→0 → EXPIRED.
         * Round 3: player-team fires. focus NOT stasised → fires!
         *
         * hacking:200 on stasis-enemy, security:0 on focus → landing chance 1.0.
         */
        const { events, result } = run({
            attack: 0, // focus does no damage; we only care about the enemy stasising it
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
            healTargetId: 'attacker',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('player-team', POS_TEAM, 150, 10000)],
            enemyAttackers: [
                // Fast enemy at POS_ENEMY_FRONT fires `front` (hits the focus at M4).
                // hacking:200, security:0 on focus → landing chance 1.0. hp:1 → killed by player-team.
                {
                    id: 'stasis-enemy',
                    stats: {
                        attack: 2000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1, // killed by player-team in round 1
                        speed: 200, // acts before player-team (speed 150) and focus (speed 100)
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisInflictAttack(2)] },
                } as EnemyAttacker,
            ],
        });

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );

        // The stasis-enemy fires `front` and applies Stasis(2) to the focus in round 1
        // (speed 200 > player-team speed 150 > focus speed 100 → acts first).
        // player-team kills stasis-enemy after. Stasis expires naturally (no re-application).
        const focusFiredRounds = abilityPerformed
            .filter((e) => e.actorId === 'attacker')
            .map((e) => e.round);

        // Focus skipped rounds 1 and 2 (stasised); fires in round 3.
        expect(focusFiredRounds).not.toContain(1);
        expect(focusFiredRounds).not.toContain(2);
        expect(focusFiredRounds).toContain(3);

        // The team actor (player-team, speed 150) is NOT stasised → fires in all rounds.
        for (let r = 1; r <= 3; r++) {
            expect(abilityPerformed.some((e) => e.actorId === 'player-team' && e.round === r)).toBe(
                true
            );
        }

        // The round assembles correctly in all 3 rounds (the synthesized focus turn prevents
        // the "no focus actor turn" throw). 3 rounds present.
        expect(result.rounds).toHaveLength(3);

        // Stasis-enemy fires in round 1 only (dead after round 1 → cannot fire in rounds 2-3).
        expect(abilityPerformed.some((e) => e.actorId === 'stasis-enemy' && e.round === 1)).toBe(
            true
        );
        expect(abilityPerformed.some((e) => e.actorId === 'stasis-enemy' && e.round === 2)).toBe(
            false
        );
        expect(abilityPerformed.some((e) => e.actorId === 'stasis-enemy' && e.round === 3)).toBe(
            false
        );
    });
});
