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

/**
 * SP-4c-1: an inert SURVIVOR for rosters whose only real enemy is deliberately killed mid-fixture.
 *
 * Several cases here kill their sole enemy on purpose — a 1-HP stasis-bot that must not live to
 * re-apply its debuff. Since SP-4c-1 that kill WIPES the enemy side and ends the match, cutting the
 * run short of the rounds the case is about. This bystander keeps a living member on the board so
 * the run continues, without changing anything else: 0 attack and no skills make it
 * RNG-stream-inert (it draws nothing), and speed 1 puts it last in every turn order.
 *
 * Placed at POS_ENEMY_BACK so a `front` selection keeps resolving to the real enemy while that
 * enemy lives; once it dies the focus retargets onto this bystander, which is the same
 * death-retargeting the engine already does and is what the post-kill rounds are meant to observe.
 */
const bystanderEnemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            security: 0,
            hacking: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [] },
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
            mode: 'healing',
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
            mode: 'healing',
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
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                // SP-4c-1: an inert survivor so killing the bot below is not a WIPE (which would
                // end the match and cut this case short of the rounds it is about).
                bystanderEnemyAt('bystander', POS_ENEMY_BACK),
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
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                // SP-4c-1: an inert survivor so killing the bot below is not a WIPE (which would
                // end the match and cut this case short of the rounds it is about).
                bystanderEnemyAt('bystander', POS_ENEMY_BACK),
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
            mode: 'healing',
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
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('player-team', POS_TEAM, 150, 10000)],
            enemyAttackers: [
                // SP-4c-1: an inert survivor so killing the bot below is not a WIPE (which would
                // end the match and cut this case short of the rounds it is about).
                bystanderEnemyAt('bystander', POS_ENEMY_BACK),
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

// ── B3 — reactive suppression while stasised ─────────────────────────────────────────────

/**
 * B3 Task 1 — drain-time reactive suppression (total lockout).
 *
 * While a unit is stasised, every queued reactive intent whose ownerId matches the
 * stasised actor is dropped at drainQueue's per-intent loop.  This covers both sides
 * (player intentQueue + enemy enemyIntentQueue) and all reactive trigger types
 * (on-attacked, start-of-round, on-crit, on-ally-attacked, on-enemy-destroyed).
 *
 * Four invariants proved:
 *   (a) on-attacked buff reactive on the PLAYER (focus) is suppressed while stasised.
 *   (b) start-of-round self-buff reactive on an ENEMY is suppressed while stasised.
 *   (c) INCOMING effects (DoT ticks, damage) on the stasised actor are UNTOUCHED.
 *   (d) Without stasis the same on-attacked reactive fires normally (symmetry check).
 */

// Skill helpers for B3 tests ─────────────────────────────────────────────────────────────

/**
 * A passive `on-attacked` self-buff slot: 'Counter Shield' (+10% attack, duration 99).
 * The focus carries this; when hit while NOT stasised it fires buff-applied 'Counter Shield'.
 * While stasised the intent's ownerId === 'attacker' → dropped by the drain guard.
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

/**
 * A passive `start-of-round` self Attack Up slot (Chakara-shaped): +100% attack, duration 99.
 * Folds into the enemy's outgoing damage the same round it fires.
 * While stasised the intent's ownerId === enemy id → dropped by the drain guard.
 */
const startOfRoundAttackUpSlot = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'buff',
            target: 'self',
            trigger: 'start-of-round',
            config: {
                type: 'buff',
                buffName: 'Attack Up',
                parsedEffects: { attack: 100 },
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        }),
    ],
});

// ── (a) on-attacked counter suppressed while stasised ────────────────────────────────────

describe('B3 Task 1 — reactive suppression: (a) on-attacked self-buff suppressed while focus is stasised', () => {
    it('a stasised focus does NOT receive its on-attacked buff when the enemy strikes it', () => {
        idc = 0;
        /**
         * Setup (healing mode — required for positioned enemy roster):
         *   - Focus ('attacker') at POS_FOCUS carries onAttackedSelfBuffSlot.
         *     Speed 50 — SLOWER than the enemies so the enemy acts FIRST each round.
         *   - stasis-enemy (id='stasis-enemy', speed=200): fires stasisInflictAttack(4) at 'front'
         *     player (= focus at M4) in round 1. Stasis(4) keeps focus stasised for rounds 1–4.
         *   - attack-enemy  (id='attack-enemy', speed=100): a bare flat-card attacker that hits
         *     the focus every round (speed 100 > focus speed 50, acts before focus).
         *   - numRounds: 4.
         *
         * Round ordering each round: stasis-enemy(200) → attack-enemy(100) → focus(50)
         *
         * Round 1:
         *   stasis-enemy applies Stasis(4) to focus.
         *   attack-enemy attacks focus → focus is stasised → `attacked` event fires → listener
         *   enqueues intent(ownerId='attacker') → drain guard: isStasised('attacker')=true → DROP.
         *   No 'Counter Shield' buff-applied in round 1.
         *   focus's own turn: stasised → skip.
         *
         * Rounds 2–4: stasis-enemy is NOT dead but does not re-apply (Stasis(4) stays active
         *   since it was applied once in round 1 and decrements each round: 4→3→2→1→0).
         *   attack-enemy attacks focus every round → intent dropped → no Counter Shield.
         *
         * Assert: zero 'buff-applied' events for 'Counter Shield' on actorId='attacker' across
         *   all 4 rounds (the listener fires, the intent enqueues, but drain discards it).
         *
         * For the stasis-enemy to keep Stasis alive: duration 4, decrements once per skip of
         * the focus.  Rounds 1–4 the focus is stasised and never fires Counter Shield.
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
            mode: 'healing',
            position: POS_FOCUS, // M4 = front-most player
            target: parsedTarget('front'),
            pattern: basePattern(),
            bus,
            enemyAttackers: [
                // stasis-enemy: applies Stasis(4) to the front player (focus).
                {
                    id: 'stasis-enemy',
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
                    shipSkills: { slots: [stasisInflictAttack(4)] },
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
                        speed: 100, // acts after stasis-enemy, before focus
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
        // drain guard must have dropped every one (focus stasised rounds 1–4).
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

// ── (b) start-of-round self-buff (Chakara-shaped) suppressed while enemy stasised ────────

describe('B3 Task 1 — reactive suppression: (b) start-of-round self-buff suppressed while enemy is stasised', () => {
    it('a stasised enemy does NOT receive its start-of-round Attack Up in stasised rounds (fires round 1 pre-stasis, suppressed rounds 2-3)', () => {
        idc = 0;
        /**
         * Setup (healing mode — required for positioned enemy roster):
         *   - Focus ('attacker') at POS_FOCUS (speed=200, attack=0): fires stasisInflictAttack(3)
         *     at 'front' each round.  Focus is the FASTEST → acts before the chakara-enemy.
         *   - chakara-enemy (id='chakara-enemy', speed=50) at POS_ENEMY_FRONT:
         *     carries basicAttack + startOfRoundAttackUpSlot.
         *     The `start-of-round` buff fires at the round-head (before any turns).
         *   - numRounds: 3.
         *
         * Timeline:
         *   Round 1:
         *     round-started → chakara-enemy's start-of-round intent enqueued (NOT yet stasised).
         *     drain: isStasised('chakara-enemy') = false → buff APPLIES (Attack Up folds in).
         *     focus (speed 200) acts first: fires stasisInflictAttack(3) → Stasis(3) lands on chakara-enemy.
         *     chakara-enemy (speed 50): stasised → SKIP. (Action does not fire.)
         *
         *   Round 2:
         *     round-started → chakara-enemy's start-of-round intent enqueued. chakara-enemy IS stasised.
         *     drain: isStasised('chakara-enemy') = true → DROP intent → Attack Up does NOT fold in.
         *     focus acts: re-applies Stasis(3) (overwrites remaining 2 with fresh 3).
         *     chakara-enemy: stasised → SKIP.
         *
         *   Round 3: same as round 2.
         *
         * Control (no stasis applied): focus fires basicAttack (no stasis inflict).
         *   Round 1: round-started → buff applied. chakara-enemy hits with Attack Up active (harder).
         *   Rounds 2–3: same.
         *
         * Assert: total incoming damage in the stasised run is LESS THAN OR EQUAL to the control.
         * In rounds 2–3 the stasised enemy's Attack Up is suppressed → its per-round damage is 5000
         * (base attack, no buff).  In the control run the Attack Up stacks are active every round.
         *
         * We run the stasised case with hacking:200 + stasisInflictAttack(3); we run the control
         * case with the focus firing basicAttack (no status, attack:0 on focus → same damage output
         * for the enemy comparison: the enemy's incoming damage should be base × rounds for both,
         * but in the stasised case rounds 2–3 miss the buff while the control keeps it).
         *
         * Concretely: control round 2 incoming > stasis round 2 incoming, since only the control
         * enemy still has the Attack Up buff (from round 1, duration 99, still active).
         * (In the stasis scenario the enemy doesn't even act, so incoming damage for rounds 2–3
         * is 0; in the control the un-stasised enemy fires every round with the buff.)
         *
         * Simplest non-vacuous assertion: in the stasised run the chakara-enemy fires NO damage
         * in rounds 2–3 (it is stasised / action-skipped), while in the control run it DOES fire.
         * Both facts are already tested by B2 Task 3 (i).  What is NEW here: in the stasised
         * scenario we additionally assert that the start-of-round buff is NOT applied (no
         * buff-applied event for 'Attack Up' on chakara-enemy while it is stasised).
         */
        const bus = createEventBus();
        const buffApplied: CombatEvent[] = [];
        bus.on('buff-applied', (e) => buffApplied.push(e as CombatEvent));

        runCombat({
            attack: 0, // focus deals no damage; only stasis inflict matters
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [stasisInflictAttack(3)] },
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
            hacking: 200, // ensures stasis landing chance = 1.0
            speed: 200, // focus is FASTEST → acts before the chakara-enemy
            healTargetId: 'attacker',
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'), // targets the front enemy = chakara-enemy
            pattern: basePattern(),
            bus,
            enemyAttackers: [
                {
                    id: 'chakara-enemy',
                    stats: {
                        attack: 5000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 50, // SLOWER than focus → stasis is applied before this enemy acts
                        security: 0, // hacking:200 vs security:0 → landing chance 1.0
                        hacking: 0,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [basicAttack(), startOfRoundAttackUpSlot()] },
                } as EnemyAttacker,
            ],
        });

        // Round 1: chakara-enemy was NOT stasised yet when round-started fired → Attack Up applied.
        // Round 2+: stasised → intent dropped → Attack Up NOT applied.
        // Assert: 'Attack Up' buff-applied for 'chakara-enemy' fires ONLY in round 1 (not rounds 2–3).
        const attackUpForChakara = buffApplied.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-applied' }> =>
                e.type === 'buff-applied' &&
                e.actorId === 'chakara-enemy' &&
                e.buffName === 'Attack Up'
        );

        // NON-VACUITY ANCHOR: the start-of-round Attack Up MUST fire in round 1 (stasis is
        // applied mid-round, AFTER round-started fires that round), proving the reactive is
        // actually registered and reachable — so the rounds 2–3 absence is genuine suppression,
        // not a never-firing reactive.
        expect(attackUpForChakara.some((e) => e.round === 1)).toBe(true);
        // Any application is ONLY round 1 (pre-stasis).
        const applyRounds = attackUpForChakara.map((e) => e.round);
        for (const round of applyRounds) {
            expect(round).toBe(1);
        }
        // SUPPRESSION: rounds 2 and 3 (fully stasised) have NO Attack Up applied.
        expect(attackUpForChakara.some((e) => e.round === 2)).toBe(false);
        expect(attackUpForChakara.some((e) => e.round === 3)).toBe(false);
    });
});

// ── (c) incoming effects UNTOUCHED while stasised ────────────────────────────────────────

describe('B3 Task 1 — reactive suppression: (c) incoming DoT damage still ticks on a stasised actor', () => {
    it('a DoT applied by an enemy still ticks on the stasised focus — incoming effects are not suppressed', () => {
        idc = 0;
        /**
         * This is the B2 Task 3 (ii) invariant restated as a B3 assertion:
         * only the stasised actor's OWN outgoing intents are suppressed.
         * Incoming DoT ticks (tickDoTs at turn-start) are completely unaffected.
         *
         * Setup mirrors test (ii) above: dot-stasis-enemy applies Corrosion + Stasis(2) in round 1.
         * Rounds 1–2: focus stasised; dot-ticked events must still appear for 'attacker'.
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
            speed: 50, // focus slower → enemy acts first
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [
                {
                    id: 'dot-stasis-enemy',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 120,
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

        // Focus is stasised in rounds 1–2 (enemy acts first in round 1 and applies both DoT and
        // Stasis, then focus's turn is skipped in rounds 1–2 but DoT ticks at turn-start).
        // Incoming DoT must still fire for 'attacker' in rounds 1 AND 2.
        const dotRoundsForFocus = dotTicked
            .filter((e) => e.targetId === 'attacker')
            .map((e) => e.round);
        expect(dotRoundsForFocus).toContain(1);
        expect(dotRoundsForFocus).toContain(2);
    });
});

// ── (d) non-stasised actor — on-attacked reactive fires normally ──────────────────────────

describe('B3 Task 1 — reactive suppression: (d) non-stasised focus — on-attacked reactive fires normally', () => {
    it('without stasis the on-attacked buff IS applied each time the enemy attacks the focus', () => {
        idc = 0;
        /**
         * Control for test (a): identical setup but WITHOUT stasis.
         * The attack-enemy attacks the focus every round; the focus carries onAttackedSelfBuffSlot.
         * No stasis is ever applied → isStasised('attacker') = false → drain lets the intent through.
         * Assert: 'Counter Shield' buff-applied fires for 'attacker' in every round.
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
            speed: 50,
            healTargetId: 'attacker',
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            bus,
            enemyAttackers: [
                // A bare flat-card enemy: attacks the focus every round (no stasis, no DoT).
                {
                    id: 'attack-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 100, // faster than focus (speed 50) → acts first
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

        // Without stasis: the on-attacked intent's ownerId='attacker' → isStasised=false → executes.
        // The 'Counter Shield' buff must be applied at least once (every round the enemy attacks).
        const counterShield = buffApplied.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-applied' }> =>
                e.type === 'buff-applied' &&
                e.actorId === 'attacker' &&
                e.buffName === 'Counter Shield'
        );
        expect(counterShield.length).toBeGreaterThan(0);
    });
});

// ── B3 Task 2 — direct-damage break ──────────────────────────────────────────────────────

describe('B3 Task 2 — direct-damage break', () => {
    // (i) A direct firing hit breaks Stasis
    it('(i) direct hit reduces Stasis by one turn (not full removal): victim resumes one round later than a full break would give', () => {
        idc = 0;
        /**
         * Setup:
         *   - stasis-bot (speed=300, hp=1): fires stasisInflictAttack(3) at focus in round 1.
         *     Acts first. Killer kills it after.
         *   - killer (speed=200, attack=10000): kills stasis-bot in round 1.
         *   - focus (speed=100, attack=5000): receives Stasis(3) in round 1.
         *     In round 2 a breaker-enemy (speed=150) fires a plain direct hit at focus.
         *     This should break Stasis → focus acts in round 3 (not round 4/5).
         *   - breaker-enemy (speed=150): basicAttack targeting 'front' (the focus).
         *     Acts between killer and focus.
         *
         * A direct hit REDUCES the Stasis turn count by one instead of clearing it, so:
         *   R1: Stasis(3) applied; breaker hits → break decrement 3→2, then Post-Turn 2→1.
         *   R2: breaker hits → break decrement 1→0 (expired); focus still skipped this round.
         *   R3: focus is free → fires.
         * Compared to an untouched Stasis(3) (skips R1/R2/R3, fires R4), the every-round breaking
         * hits shave it to a round-3 resume — one round later than the OLD full-removal rule (which
         * cleared Stasis on the first hit and resumed in round 2).
         *
         * numRounds:4. Use __testTapIsStasised to confirm Stasis is gone by the end of the run.
         */
        let capturedIsStasised: ((actorId: string) => boolean) | undefined;
        const { events } = run({
            attack: 5000,
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
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                // stasis-bot applies Stasis(3) to focus, then gets killed
                {
                    id: 'stasis-bot',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1,
                        speed: 300,
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisInflictAttack(3)] },
                } as EnemyAttacker,
                // breaker-enemy: plain direct hit at the focus every round
                {
                    id: 'breaker-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 150,
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
            __testTapIsStasised: (fn) => {
                capturedIsStasised = fn;
            },
        });

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );
        const focusFiredRounds = abilityPerformed
            .filter((e) => e.actorId === 'attacker')
            .map((e) => e.round);

        // Focus was stasised round 1 (stasis-bot applied Stasis(3), acts BEFORE focus).
        expect(focusFiredRounds).not.toContain(1);

        // Turn order: stasis-bot(300) → killer(200) → breaker-enemy(150) → focus(100).
        // Reduce-by-one (see the trace above): resumes round 3. Full removal would resume round 2;
        // an untouched Stasis(3) would resume round 4. Pinned to round 3 — a loose "≤2" would pass
        // under a full-removal regression, "≥4" under a no-break regression.
        const firstFiredRound = focusFiredRounds.length > 0 ? Math.min(...focusFiredRounds) : 999;
        expect(firstFiredRound).toBe(3);

        // Post-run: Stasis should be gone (reduced to 0 by round 2, freed from round 3).
        expect(capturedIsStasised).toBeDefined();
        expect(capturedIsStasised!('attacker')).toBe(false);
    });

    // (ii) DoT does NOT break Stasis (channel discrimination)
    it('(ii) DoT does NOT break Stasis: victim stays stasised across DoT ticks', () => {
        idc = 0;
        /**
         * Stasis-bot (speed=300, hp=1) applies Stasis(3) + Corrosion DoT in round 1.
         * Killer (speed=200) kills stasis-bot round 1.
         * No direct hits on the focus after that (killer targets the enemy, not the focus).
         * Focus has speed=100. numRounds=3.
         *
         * DoT ticks every round at turn-start. If DoT could break Stasis, focus would act
         * from round 2 (since the DoT tick happens at turn-start). Assert focus does NOT
         * fire in rounds 1–3 (still stasised all 3 rounds with Stasis(3)).
         */
        const { events } = run({
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
            speed: 100,
            healTargetId: 'attacker',
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                // SP-4c-1: an inert survivor so killing the bot below is not a WIPE (which would
                // end the match and cut this case short of the rounds it is about).
                bystanderEnemyAt('bystander', POS_ENEMY_BACK),
                {
                    id: 'stasis-dot-bot',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1,
                        speed: 300,
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: {
                        slots: [
                            {
                                slot: 'active',
                                abilities: [
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
                                    ab({
                                        type: 'debuff',
                                        target: 'enemy',
                                        config: {
                                            type: 'debuff',
                                            buffName: 'Stasis',
                                            application: 'inflict',
                                            duration: 3,
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

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );
        const focusFiredRounds = abilityPerformed
            .filter((e) => e.actorId === 'attacker')
            .map((e) => e.round);

        // DoT should NOT break Stasis → focus still stasised all 3 rounds.
        expect(focusFiredRounds).not.toContain(1);
        expect(focusFiredRounds).not.toContain(2);
        expect(focusFiredRounds).not.toContain(3);

        // Verify DoT actually ticked (non-vacuous: DoT was running)
        const dotTicked = events.filter(
            (e): e is Extract<CombatEvent, { type: 'dot-ticked' }> => e.type === 'dot-ticked'
        );
        expect(dotTicked.filter((e) => e.targetId === 'attacker').length).toBeGreaterThan(0);
    });

    // (iii) breaking hit's on-attacked reaction stays suppressed
    it('(iii) on-attacked reactive stays suppressed while stasised, even on the breaking direct hit', () => {
        idc = 0;
        /**
         * Focus carries onAttackedSelfBuffSlot (counter fires when hit while NOT stasised).
         * stasis-enemy (speed=300, hp=1M, applies Stasis(2)) + breaker-enemy (speed=150, basicAttack).
         * killer not needed — stasis-enemy stays alive (hp=1M) and perpetually re-applies Stasis.
         *
         * Rounds 1-2: focus stasised. breaker-enemy's direct hit triggers on-attacked listener.
         * BUT focus is stasised → intent dropped → NO Counter Shield buff.
         *
         * The break fires AFTER apply (removal is post-apply). So for rounds 1-2, while the
         * breaking hit ALSO breaks Stasis at that moment, the on-attacked intent was already
         * dropped (the stasis check in drainQueue happens BEFORE or DURING the action, not after).
         * Actually: the on-attacked listener queues AFTER the hit lands. The stasis check in
         * drainQueue runs at drain time (after the attack). So the intent IS queued, and IS
         * dropped by the stasis check.
         *
         * Since the break removes stasis DURING the apply (inside breakStasisOnDirectHit which
         * runs AFTER applyIncomingToTarget/emitHit), the drain guard sees stasised=true at check
         * time for the on-attacked reactive on that same hit. This must hold without explicit ordering code.
         *
         * Assert: Counter Shield is NEVER applied to 'attacker' in rounds where it was stasised
         * at the time of the hit (rounds 1-2).
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
            hacking: 0,
            speed: 50,
            healTargetId: 'attacker',
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            bus,
            enemyAttackers: [
                {
                    id: 'stasis-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 300,
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisInflictAttack(4)] },
                } as EnemyAttacker,
                {
                    id: 'breaker-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 150,
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

        // The on-attacked intent was queued, but the drain guard (isStasised check)
        // must drop it while focus is stasised. Counter Shield must NOT be applied.
        const counterShield = buffApplied.filter(
            (e): e is Extract<CombatEvent, { type: 'buff-applied' }> =>
                e.type === 'buff-applied' &&
                e.actorId === 'attacker' &&
                e.buffName === 'Counter Shield'
        );
        expect(counterShield).toHaveLength(0);
    });

    // (iv) LIVING-applier gap: different attacker breaks the Stasis
    it('(iv) a different direct hit from a different attacker breaks Stasis → victim acts on next turn', () => {
        idc = 0;
        /**
         * stasis-bot (speed=300, hp=1) applies Stasis(3) to focus in round 1, killed by killer.
         * focus speed=100. breaker-enemy (speed=150) fires basicAttack at front every round.
         * numRounds=4.
         *
         * Without break: focus fires round 4 (after 3 skips).
         * With reduce-by-one (breaker hits every round): R1 3→break2→post1; R2 1→break0 expired;
         * focus fires round 3.
         */
        const { events } = run({
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
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [
                {
                    id: 'stasis-bot',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1,
                        speed: 300,
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisInflictAttack(3)] },
                } as EnemyAttacker,
                {
                    id: 'breaker-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 150,
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
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
        });

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );
        const focusFiredRounds = abilityPerformed
            .filter((e) => e.actorId === 'attacker')
            .map((e) => e.round);

        // Focus was stasised in round 1
        expect(focusFiredRounds).not.toContain(1);
        // The breaker (a DIFFERENT attacker from the original applier) reduces Stasis each round.
        // Turn order: stasis-bot(300) → killer(200) → breaker-enemy(150) → focus(100).
        // Reduce-by-one → focus fires round 3 (full removal would give round 2; no break, round 4).
        const firstFiredRound = focusFiredRounds.length > 0 ? Math.min(...focusFiredRounds) : 999;
        expect(firstFiredRound).toBe(3);
    });

    // (v) break regardless of minimal damage
    it('(v) a direct hit with minimal damage still breaks Stasis', () => {
        idc = 0;
        /**
         * tiny-attacker has attack=1. Focus has hp=1B. The hit connects as a DIRECT hit
         * but deals negligible HP loss. Tests that break fires for ANY direct hit, not
         * just heavy ones.
         */
        const { events } = run({
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
            speed: 100,
            healTargetId: 'attacker',
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                // stasis-bot applies Stasis(3), killed by killer
                {
                    id: 'stasis-bot',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1,
                        speed: 300,
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisInflictAttack(3)] },
                } as EnemyAttacker,
                // tiny-attacker: minimal damage direct hit — still breaks Stasis
                {
                    id: 'tiny-attacker',
                    stats: {
                        attack: 1,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 150,
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

        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );
        const focusFiredRounds = abilityPerformed
            .filter((e) => e.actorId === 'attacker')
            .map((e) => e.round);

        // Stasis applied in round 1 (speed 300 > 200 > 100).
        expect(focusFiredRounds).not.toContain(1);
        // Turn order: stasis-bot(300) → killer(200) → tiny-attacker(150) → focus(100).
        // The minimal-damage hit still reduces Stasis each round (reduce-by-one): R1 3→break2→post1;
        // R2 1→break0 expired; focus fires round 3. Any direct hit reduces Stasis regardless of damage.
        const firstFiredRound = focusFiredRounds.length > 0 ? Math.min(...focusFiredRounds) : 999;
        expect(firstFiredRound).toBe(3);

        // Confirm attack was minimal but still connected (non-vacuous: the attacked event fired)
        const attacked = events.filter(
            (e): e is Extract<CombatEvent, { type: 'attacked' }> =>
                e.type === 'attacked' && e.attackerId === 'tiny-attacker'
        );
        expect(attacked.length).toBeGreaterThan(0);
    });

    // (vi) player→enemy positional break: re-applied Stasis confirms wiring
    it('(vi) player positional hit breaks enemy Stasis (re-apply confirms break fired)', () => {
        idc = 0;
        /**
         * Focus fires stasisInflictAttack(5) at enemy-front every round (chargeCount:0).
         * Round 1: focus hits enemy-front (not yet stasised) → no break → Stasis(5) applied.
         * Round 2: focus hits enemy-front (stasised from round 1) → break fires →
         *          Stasis removed → Stasis(5) immediately re-applied by same attack.
         * Post-run: enemy-front is stasised (re-applied round 2). capturedIsStasised confirms.
         * Non-vacuous: enemy-front has speed=1, never acts before focus (speed=100+hacking).
         */
        let capturedIsStasised: ((actorId: string) => boolean) | undefined;

        runCombat({
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [stasisInflictAttack(5)] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 2,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            hacking: 200,
            healTargetId: 'attacker',
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [
                offensiveEnemyAt('enemy-front', POS_ENEMY_FRONT, 'front', basicAttack()),
            ],
            __testTapIsStasised: (fn) => {
                capturedIsStasised = fn;
            },
        });

        // Non-vacuous check: capturedIsStasised exists (engine ran correctly)
        expect(capturedIsStasised).toBeDefined();

        // Post-round-2: enemy-front was hit (breaking round-1 Stasis) then re-stasised by
        // the same attack's debuff ability. Still stasised at end.
        expect(capturedIsStasised!('enemy-front')).toBe(true);
    });

    // (viii) full-absorb (Barrier) direct hit still breaks Stasis — spec §3/§4.5 coverage
    it('(viii) direct hit fully absorbed by Barrier (0 HP loss) still breaks Stasis: victim acts in round 2, not round 4', () => {
        idc = 0;
        /**
         * Spec §3: "ANY landed direct attack breaks Stasis, regardless of shield/Barrier absorb
         * (about the attack connecting, not HP loss)." This test proves the strongest form:
         * when a Barrier grants FULL damage immunity, a direct hit deals ZERO HP loss yet
         * Stasis STILL breaks.
         *
         * Setup (healing mode — `healTargetId:'attacker'` — so round-level HP snapshots are
         * available to confirm the Barrier fully absorbed):
         *   - focus ('attacker', speed=100, hp=10000, attack=0):
         *     selfBuffs: [barrierBuff()] → carries a persistent Barrier (full damage immunity).
         *   - stasis-bot (speed=300, hp=1): fires stasisInflictAttack(3) at focus in round 1.
         *   - killer (speed=200, attack=10000): kills stasis-bot in round 1.
         *   - breaker-enemy (speed=150, attack=3000): fires basicAttack at focus every round.
         *     Its hits are fully absorbed by Barrier (0 HP loss) but still "connect" as direct attacks.
         *   - numRounds:4.
         *
         * Turn order each round: stasis-bot(300) → killer(200) → breaker-enemy(150) → focus(100).
         *
         * Round 1:
         *   stasis-bot fires Stasis(3) on focus.
         *   killer kills stasis-bot (hp=1, attack=10000).
         *   breaker-enemy fires basicAttack on stasised focus.
         *     → Barrier fully absorbs 3000 → 0 HP loss (barrierAbsorbed=3000, HP unchanged).
         *     → Direct hit "connected" → break mark set on focus.
         *   focus stasised → skip. Break mark consumed → Stasis removed.
         *   Post-turn: Stasis would have decremented, but it was removed by the break.
         *
         * Round 2: stasis-bot dead. focus NOT stasised → fires in EXACTLY round 2.
         *
         * No-break baseline (without the breaker-enemy): Stasis(3) keeps focus stasised in
         * rounds 1, 2, 3 → focus fires in round 4. Contrast: with the break, it fires in round 2.
         *
         * Two assertions prove both halves of spec §3:
         *   (A) 0 HP loss: result.healing!.rounds[1].targetHpPctStart ≈ 100% (round-2 start
         *       is a POST-hit snapshot of round 1; unchanged HP proves full absorption).
         *       Also: rounds[0].barrierAbsorbed === 3000 (absorbed exactly the attack).
         *   (B) Stasis STILL breaks: focus fires in EXACTLY round 2 (not 3 or 4).
         *       Pinned — a loose "≤3" would pass under a one-round-late regression.
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
            selfBuffs: [
                {
                    id: 'barrier',
                    buffName: 'Barrier',
                    stacks: 1,
                    isStackable: false,
                    parsedEffects: {},
                },
            ],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 10_000, // intentionally small so Barrier absorption is clearly visible
            hacking: 0,
            speed: 100,
            healTargetId: 'attacker',
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                // stasis-bot: applies Stasis(3) to focus in round 1, then killed by killer.
                // attack:0 so its damage ability deals 0 HP to the focus — isolates barrierAbsorbed
                // to the breaker-enemy hit only (3000), making the absorption assertion exact.
                {
                    id: 'stasis-bot',
                    stats: {
                        attack: 0, // zero attack → damage ability in stasisInflictAttack deals 0 HP
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1, // killed by killer (attack=10000) in round 1
                        speed: 300, // fastest → applies Stasis before any player acts
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisInflictAttack(3)] },
                } as EnemyAttacker,
                // breaker-enemy: fires a direct 3000-damage hit at the stasised focus each round.
                // Barrier fully absorbs the hit (0 HP loss), but the direct attack still "connects"
                // and must break Stasis (spec §3).
                {
                    id: 'breaker-enemy',
                    stats: {
                        attack: 3000, // without Barrier this would drain 30% of focus hp=10000 → proves full absorb
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 150, // acts after stasis-bot(300) and killer(200), before focus(100)
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

        // ── (A) Barrier fully absorbed: 0 HP loss ──────────────────────────────────────────
        const rounds = result.healing!.rounds;

        // Round 1's breaker-enemy 3000 attack was FULLY absorbed by Barrier (0 HP drain).
        expect(rounds[0].barrierAbsorbed).toBe(3000);

        // POST-hit signal: round 2 starts at 100% HP (3000 attack drained NOTHING from focus's HP).
        // If Barrier had NOT been active, focus hp=10000 - 3000 = 7000 → round 2 start = 70%.
        // 100% confirms full absorption (distinguishes from partial or no absorption).
        expect(rounds[1].targetHpPctStart).toBeCloseTo(100, 6);

        // ── (B) Stasis STILL breaks despite 0 HP loss ─────────────────────────────────────
        const abilityPerformed = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed'
        );
        const focusFiredRounds = abilityPerformed
            .filter((e) => e.actorId === 'attacker')
            .map((e) => e.round);

        // Focus was stasised in round 1 (stasis-bot applied Stasis before focus acted).
        expect(focusFiredRounds).not.toContain(1);

        // The Barrier-absorbed hits (breaker-enemy speed=150 > focus speed=100) still reduce Stasis
        // each round (reduce-by-one): R1 3→break2→post1; R2 1→break0 expired; focus fires round 3.
        const firstFiredRound = focusFiredRounds.length > 0 ? Math.min(...focusFiredRounds) : 999;
        expect(firstFiredRound).toBe(3);

        // NON-VACUITY: without a breaking hit, Stasis(3) would keep focus locked in rounds 1–3
        // and fire only in round 4. The focus fires in round 3 here — one round earlier than the
        // no-break baseline. This early fire is only possible if the Barrier-absorbed direct hit
        // still reduced Stasis despite delivering 0 HP loss (spec §3 case).
    });

    // (vii) REGRESSION: same attacker applies Stasis(5) then fires pure-damage hits → breaks
    it('(vii) REGRESSION: the attacker that applied Stasis breaks it with a later pure-damage hit', () => {
        idc = 0;
        /**
         * Proves the casterId-identity bug is FIXED.
         *
         * Setup (healing mode):
         *   - focus ('attacker', speed=50, attack=0): stands as a victim; carries basicAttack.
         *   - std-enemy ('std-enemy', speed=300, hp=12000, chargeCount=1, startCharged=false):
         *     active skill = stasisInflictAttack(3); charged skill = basicAttack (pure damage).
         *     Round 1: NOT charged → fires active (stasisInflictAttack(3)) → Stasis(3) on focus.
         *     Round 2: charges >= chargeCount → fires charged (basicAttack) → pure damage, NO Stasis.
         *     casterId of the Stasis entry = 'std-enemy'.
         *     In the old code (casterId-identity bug): breakingAttackerId = 'std-enemy',
         *       currentStasis.casterId = 'std-enemy' → MATCH → break INVALIDATED (never fires).
         *     In the new code: inflictedEnemyDebuffs for the charged turn = [] → break FIRES.
         *   - killer ('killer', speed=200, attack=10000): hits std-enemy for ~10000 each round
         *     (std-enemy defence=0). hp=12000 → survives R1 hit (2000 HP left), dies from R2 hit.
         *     Killing std-enemy after round 2 prevents it from re-applying Stasis in round 3+.
         *   - numRounds: 3.
         *
         * Turn order each round: std-enemy(300) → killer(200) → focus(50).
         *
         * Round 1:
         *   std-enemy fires active → Stasis(5) on focus.
         *   killer fires → std-enemy takes 10000 damage (survives at 2000 HP).
         *   focus: STASISED → skip (no action).
         * Round 2:
         *   std-enemy fires charged (basicAttack) → pure hit on stasised focus → break marked.
         *   killer fires → std-enemy takes 10000 damage → killed (2000 − 10000 < 0).
         *   focus: STASISED → skip → consumes break → Stasis reduced (2→1 here, then Post-Turn 1→0
         *     → expired).
         * Round 3:
         *   std-enemy dead. killer fires. focus NOT stasised → acts.
         *
         * Assert: focus fires in round 3 (no earlier, because rounds 1-2 stasised/skip).
         * No-break baseline: without the round-2 break, Stasis(3) keeps focus stasised through
         * round 3 (3 skips) and fires only in round 4 — so a round-3 fire proves the break fired.
         */
        const { events } = run({
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
            speed: 50, // SLOWER than all enemies → enemies act first
            healTargetId: 'attacker',
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('back'), // focus targets back (no real enemy there) — placeholder
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                // SP-4c-1: an inert survivor so killing the bot below is not a WIPE (which would
                // end the match and cut this case short of the rounds it is about).
                bystanderEnemyAt('bystander', POS_ENEMY_BACK),
                {
                    id: 'std-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 12000, // survives killer R1 hit (~10000 dmg, 2000 HP left); dies from killer R2 hit
                        speed: 300, // FASTEST → applies Stasis before any player acts
                        security: 0,
                        hacking: 200, // ensures Stasis landing chance = 1.0
                    },
                    chargeCount: 1, // active round 1 (stasisInflict); charged round 2 (basicAttack)
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'), // targets the front player (focus at M4)
                    pattern: basePattern(),
                    shipSkills: {
                        slots: [
                            // Active slot: stasisInflictAttack(3) — fires in round 1
                            {
                                slot: 'active',
                                abilities: [
                                    ab({
                                        type: 'damage',
                                        target: 'enemy',
                                        config: { type: 'damage', multiplier: 100 },
                                    }),
                                    ab({
                                        type: 'debuff',
                                        target: 'enemy',
                                        config: {
                                            type: 'debuff',
                                            buffName: 'Stasis',
                                            application: 'inflict',
                                            duration: 3,
                                            stacks: 1,
                                            isStackable: false,
                                            parsedEffects: {},
                                        },
                                    }),
                                ],
                            },
                            // Charged slot: pure damage (no Stasis) — fires in round 2
                            {
                                slot: 'charged',
                                abilities: [
                                    ab({
                                        type: 'damage',
                                        target: 'enemy',
                                        config: { type: 'damage', multiplier: 100 },
                                    }),
                                ],
                            },
                        ],
                    },
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

        // Round 1: std-enemy fires active (stasisInflictAttack(5)) → focus stasised. Focus skips.
        // Round 2: std-enemy fires charged (basicAttack) → pure hit on stasised focus.
        //          Old casterId bug: break INVALIDATED (casterId = 'std-enemy' = breakingAttackerId).
        //          Fix: inflictedEnemyDebuffs = [] → break FIRES → focus skip consumes break.
        // Round 3: focus NOT stasised → fires.
        expect(focusFiredRounds).not.toContain(1); // stasised round 1
        expect(focusFiredRounds).not.toContain(2); // skip still runs in round 2 (break consumed there)
        expect(focusFiredRounds).toContain(3); // freed by break → acts in round 3

        // Non-vacuous: confirm std-enemy fired the charged (basicAttack) skill in round 2
        // (proves the pure-damage hit actually ran — break was not vacuously absent).
        const stdEnemyFired = abilityPerformed.filter((e) => e.actorId === 'std-enemy');
        expect(stdEnemyFired.some((e) => e.round === 1)).toBe(true);
        expect(stdEnemyFired.some((e) => e.round === 2)).toBe(true);
    });
});

// ── B3 Task 3 — Akula don't-break ────────────────────────────────────────────────────────

/**
 * B3 Task 3 — §4.5 Akula exception: an attacker with doesntBreakStasis:true does NOT
 * break Stasis with its direct hits.
 *
 * Two tests: activation (doesntBreakStasis:true → no break) + control (flag absent → break fires).
 * Both use identical fixtures; the ONLY difference is whether doesntBreakStasis is set.
 */
describe("B3 Task 3 — Akula don't-break", () => {
    it('(activation) attacker with doesntBreakStasis:true hits stasised victim → Stasis NOT broken (victim stays stasised full duration)', () => {
        idc = 0;
        /**
         * Setup:
         *   - stasis-bot (speed=300, hp=1): fires stasisInflictAttack(3) at focus in round 1.
         *     Killer kills stasis-bot in round 1.
         *   - killer (speed=200, attack=10000): kills stasis-bot round 1.
         *   - akula-enemy (speed=150, doesntBreakStasis:true): fires basicAttack at front
         *     every round. Its hits land on the stasised focus but must NOT break Stasis.
         *   - focus (speed=100, basicAttack): receives Stasis(3) in round 1.
         *   - numRounds:4.
         *
         * Without break-exclusion: Stasis would be broken in round 1's skip and focus would
         * fire in round 2 (same as test (i)/(iv)). With doesntBreakStasis=true: no break-mark
         * fires, so focus remains stasised for all 3 rounds (skips rounds 1, 2, 3; fires round 4).
         *
         * Assert: focus does NOT fire in rounds 1–3 and DOES fire in round 4.
         */
        const { events } = run({
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
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                // stasis-bot: applies Stasis(3) to focus in round 1, then killed
                {
                    id: 'stasis-bot',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1,
                        speed: 300,
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisInflictAttack(3)] },
                } as EnemyAttacker,
                // akula-enemy: has doesntBreakStasis — its direct hits must NOT break Stasis
                {
                    id: 'akula-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 150, // acts after stasis-bot(300) and killer(200), before focus(100)
                        security: 0,
                        hacking: 0,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_BACK,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [basicAttack()] },
                    doesntBreakStasis: true,
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

        // With doesntBreakStasis the akula-enemy's hits do NOT break Stasis.
        // Focus must stay stasised all 3 rounds (Stasis(3) → 3 skips) and fire only in round 4.
        expect(focusFiredRounds).not.toContain(1);
        expect(focusFiredRounds).not.toContain(2);
        expect(focusFiredRounds).not.toContain(3);
        expect(focusFiredRounds).toContain(4);

        // Non-vacuous: akula-enemy DID fire each round (its turns ran — no break-hook called)
        for (let r = 1; r <= 4; r++) {
            expect(abilityPerformed.some((e) => e.actorId === 'akula-enemy' && e.round === r)).toBe(
                true
            );
        }
    });

    it('(control) same fixture WITHOUT doesntBreakStasis → Stasis IS reduced, focus fires round 3', () => {
        idc = 0;
        /**
         * Identical to the activation test above EXCEPT doesntBreakStasis is NOT set on
         * akula-enemy. Without the flag the breaker behaves like any other attacker and reduces
         * Stasis each round (reduce-by-one): R1 3→break2→post1; R2 1→break0 expired; focus fires
         * round 3 (vs round 4 when the flag suppresses every break).
         */
        const { events } = run({
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
            mode: 'healing',
            position: POS_FOCUS,
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [teamAttackerAt('killer', POS_TEAM, 200, 10000)],
            enemyAttackers: [
                {
                    id: 'stasis-bot',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1,
                        speed: 300,
                        security: 0,
                        hacking: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_FRONT,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [stasisInflictAttack(3)] },
                } as EnemyAttacker,
                // Same stats as akula-enemy but NO doesntBreakStasis flag → breaks Stasis normally.
                {
                    id: 'normal-enemy',
                    stats: {
                        attack: 100,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 150,
                        security: 0,
                        hacking: 0,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: POS_ENEMY_BACK,
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [basicAttack()] },
                    // doesntBreakStasis: NOT set — the ONLY difference from the activation test
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

        // Without the flag: normal-enemy reduces Stasis each round → focus fires in round 3 (not 4).
        expect(focusFiredRounds).not.toContain(1); // still stasised round 1 (break pending)
        const firstFiredRound = focusFiredRounds.length > 0 ? Math.min(...focusFiredRounds) : 999;
        expect(firstFiredRound).toBe(3); // reduce-by-one frees focus → fires round 3
    });
});
