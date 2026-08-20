/**
 * Characterization tests for the engine's victim-intake closure (`applyIncomingToTarget`
 * in `engine.ts`, the engine's sole `currentHp`-decrement path). These PIN the CURRENT
 * behavior of every intake branch so the Task-2 extraction (which lifts the closure body
 * into a reusable `applyVictimDamage` function) is provably behavior-preserving. They are
 * the safety net for that refactor — they must pass against current `main` and change no
 * production code.
 *
 * Five intake branches, one focused test each:
 *   1. plain HP damage (shield 0) — currentHp drops by exactly the damage;
 *   2. shield absorbs first, overflow hits HP;
 *   3. Barrier carrier — full block, HP unchanged, barrierAbsorbed accrues, hp-changed still
 *      emitted once;
 *   4. lethal hit on a Cheat-Death carrier — survives at 1 HP, cheat-death-activated emitted,
 *      removable statuses (DoTs) cleared so no further ticks land;
 *   5. lethal hit, no Cheat Death — currentHp 0, ship-destroyed emitted once.
 *
 * Harness mirrors barrier.test.ts / hpCrossing.test.ts: healing-mode `runCombat` where the
 * focus attacker IS the heal target (does no damage), manual flat / ship-backed enemy
 * attackers, no-payload always-active self-buffs for Barrier and Cheat Death, and events
 * captured off the bus. Round-overview fields (incomingDamage / shieldAbsorbed /
 * barrierAbsorbed / targetHpPctStart / targetShieldStart / destroyedRound) are the observable
 * post-intake signals; defence 0 so intake equals the raw enemy attack.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `cv${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A manual flat enemy: one synthesized basic attack, no skills. */
const manualEnemy = (
    id: string,
    attack: number,
    speed = 50,
    extra: Partial<EnemyAttacker> = {}
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed },
    chargeCount: 0,
    startCharged: false,
    ...extra,
});

/** A no-payload, always-active Barrier self-buff (recurring; active the whole scenario). */
const barrierBuff = () => ({
    id: 'barrier',
    buffName: 'Barrier',
    stacks: 1,
    isStackable: false,
    parsedEffects: {},
});

/** A no-payload, always-active Cheat Death self-buff (recurring; active the whole scenario). */
const cheatDeathBuff = () => ({
    id: 'cheat-death',
    buffName: 'Cheat Death',
    stacks: 1,
    isStackable: false,
    parsedEffects: {},
});

/**
 * Base healing-mode input: the focus attacker IS the heal target. It does nothing damaging
 * (empty skills), so the only HP-intake is the enemy attack / DoT tick. defence 0 → intake
 * equals the raw enemy attack.
 */
const healBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    hp: 10_000,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

/** Run a healing-mode scenario, collecting the three intake-relevant events off the bus. */
const run = (input: CombatEngineInput) => {
    idCounter = 0;
    const bus = createEventBus();
    const hpChanged: Extract<CombatEvent, { type: 'hp-changed' }>[] = [];
    const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
    const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
    bus.on('hp-changed', (e) => hpChanged.push(e));
    bus.on('cheat-death-activated', (e) => cheated.push(e));
    bus.on('ship-destroyed', (e) => destroyed.push(e));
    const result = runCombat({ ...input, bus });
    return { hpChanged, cheated, destroyed, result };
};

describe('victim-intake characterization (applyIncomingToTarget — pre-extraction lock)', () => {
    // ── Branch 1: plain HP damage (shield 0) → currentHp drops by exactly the damage ──
    // No shield ability, no Barrier. A single 3000 manual hit against 10000 max HP, defence 0.
    // POST-hit signal: round-2 start HP = (10000 - 3000) / 10000 = 70%. shield/barrier untouched.
    it('plain HP damage (no shield): decrements HP by exactly the damage', () => {
        const { hpChanged, result } = run(
            healBase({
                numRounds: 2,
                hp: 10_000,
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        const rounds = result.healing!.rounds;
        // The 3000 hit arrives as incoming damage, none absorbed by shield/barrier.
        expect(rounds[0].incomingDamage).toBe(3000);
        expect(rounds[0].shieldAbsorbed).toBe(0);
        expect(rounds[0].barrierAbsorbed).toBe(0);
        // POST-hit: round-2 start HP = 70% (HP dropped by exactly 3000 of 10000).
        expect(rounds[1].targetHpPctStart).toBeCloseTo(70, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();

        // The intake emitted exactly one hp-changed for the attack: 100 → 70.
        const e = hpChanged.filter((h) => h.targetId === 'attacker')[0];
        expect(e.oldPct).toBeCloseTo(100, 6);
        expect(e.newPct).toBeCloseTo(70, 6);
    });

    // ── Branch 2: shield absorbs first, overflow hits HP ──
    // The tank (focus, faster) casts a 25%-of-hp self shield (2500 pool) on its turn BEFORE the
    // enemy's 4000 hit. Shield absorbs 2500, the remaining 1500 spills to HP.
    // POST-hit signal: round-2 start HP = (10000 - 1500) / 10000 = 85%, shield pool drained to 0.
    it('shield absorbs first, overflow spills to HP', () => {
        const shieldSelf = () =>
            ab({
                type: 'shield',
                target: 'self',
                config: { type: 'shield', pct: 25, basis: 'hp' }, // 25% of 10000 = 2500 pool
            });

        const { result } = run(
            healBase({
                numRounds: 2,
                hp: 10_000,
                speed: 100, // tank acts before the enemy (speed 50) so the shield is up first
                shipSkills: { slots: [{ slot: 'active', abilities: [shieldSelf()] }] },
                enemyAttackers: [manualEnemy('atk1', 4000)],
            })
        );

        const rounds = result.healing!.rounds;
        // 4000 incoming, 2500 absorbed by the shield, 1500 spilled to HP.
        expect(rounds[0].incomingDamage).toBe(4000);
        expect(rounds[0].shieldAbsorbed).toBe(2500);
        expect(rounds[0].barrierAbsorbed).toBe(0);
        // POST-hit: round-2 start HP = 85% (only the 1500 overflow drained HP), shield pool 0.
        expect(rounds[1].targetHpPctStart).toBeCloseTo(85, 6);
        expect(rounds[1].targetShieldStart).toBeCloseTo(0, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();
    });

    // ── Branch 3: Barrier carrier → full block, HP unchanged, barrierAbsorbed accrues, ──
    //              hp-changed still emitted once.
    // A Barrier self-buff is active the whole scenario; a 3000 hit is fully blocked each round.
    // The damage still "arrives" (incomingDamage 3000) but is tracked as barrierAbsorbed, never
    // shieldAbsorbed, and HP never moves (round-2 start still 100%).
    it('Barrier carrier: full block — HP unchanged, barrierAbsorbed accrues, hp-changed still fires', () => {
        const { hpChanged, result } = run(
            healBase({
                numRounds: 2,
                hp: 10_000,
                selfBuffs: [barrierBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        const rounds = result.healing!.rounds;
        // The hit arrives but is fully blocked by Barrier (tracked separately, shield untouched).
        expect(rounds[0].incomingDamage).toBe(3000);
        expect(rounds[0].barrierAbsorbed).toBe(3000);
        expect(rounds[0].shieldAbsorbed).toBe(0);
        // POST-hit: Barrier active both rounds → round-2 start HP still 100% (HP never moved).
        expect(rounds[1].targetHpPctStart).toBeCloseTo(100, 6);
        expect(result.healing!.destroyedRound).toBeUndefined();

        // The blocked intake STILL emits one hp-changed per round, and EVERY captured crossing is a
        // no-op (old === new, HP pinned at 100%) — not just the first round's.
        const tankHpChanged = hpChanged.filter((e) => e.targetId === 'attacker');
        expect(tankHpChanged.length).toBeGreaterThanOrEqual(1);
        for (const crossing of tankHpChanged) {
            expect(crossing.oldPct).toBeCloseTo(100, 6);
            expect(crossing.newPct).toBeCloseTo(crossing.oldPct, 6);
        }
    });

    // ── Branch 4: lethal hit on a Cheat-Death carrier → survives at 1 HP, ──
    //              cheat-death-activated emitted, removable statuses (DoTs) cleared.
    // A flat enemy deals a lethal basic hit (3000 vs hp 2000). The tank carries a recurring Cheat
    // Death. On the lethal moment the engine floors HP to 1, marks cheat-death consumed, emits
    // cheat-death-activated, and wipes the tank's REMOVABLE timed statuses. This single-round case
    // pins the floor + the event; branch 4b below pins the removable-DoT clear as a multi-round
    // survival signal.
    it('lethal hit + Cheat Death: survives at 1 HP, cheat-death-activated emitted', () => {
        const { hpChanged, cheated, destroyed, result } = run(
            healBase({
                numRounds: 1, // single round: isolate the lethal save
                hp: 2000, // enemy hits for 3000 → lethal in one hit → intercepted at 1 HP
                selfBuffs: [cheatDeathBuff()],
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        // Cheat Death fired exactly once and intercepted the lethal hit: the tank survives at
        // 1 HP (floored), so it is NOT destroyed and ship-destroyed never fires for it.
        expect(cheated).toHaveLength(1);
        expect(cheated[0]).toMatchObject({ actorId: 'attacker', round: 1 });
        expect(destroyed.filter((d) => d.actorId === 'attacker')).toHaveLength(0);
        expect(result.healing!.destroyedRound).toBeUndefined();

        // Pin the floor on the DIRECT-hit path: the lethal-direct intake crossing lands the
        // survivor at exactly 1 HP of 2000 max = 0.05% — strictly positive, NOT 0 (floor + clear
        // ran, not destroy) and NOT 2 HP. (Branch 4b pins the same floor on the DoT-tick path.)
        const saveCrossing = hpChanged.find(
            (e) => e.targetId === 'attacker' && e.round === 1 && e.newPct > 0 && e.newPct < 1
        );
        expect(saveCrossing).toBeDefined();
        expect(saveCrossing!.newPct).toBeCloseTo((100 * 1) / 2000, 6); // 0.05% — floored at 1 HP
    });

    // ── Branch 4b: the Cheat-Death save fires off a lethal DoT-TICK intake (the second intake ──
    //              site that routes through the closure), and clears the survivor's removable DoTs.
    // A single DoT-only enemy (no direct basic when its active skill is a pure DoT) seeds a
    // corrosion DoT. Across rounds the tick accumulates and eventually delivers the lethal HP
    // intake at the tank's turn-start — that DoT-tick (not a direct attack) is what triggers the
    // Cheat-Death intercept. On the save the engine floors HP to 1 AND wipes the survivor's
    // REMOVABLE corrosion entries; the observable proof of the clear is that the save lands the
    // survivor at exactly 1 HP (a small strictly-positive newPct) on the DoT-tick crossing rather
    // than at 0. The applier re-seeds a fresh DoT afterward, so this characterizes the per-save
    // clear at the save moment (the current behavior), not a permanent immunity.
    it('Cheat Death save triggered by a lethal DoT-tick: floors at 1 HP and clears removable DoTs', () => {
        const corrosionDot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'corrosion', tier: 7, stacks: 10, duration: 5 },
            });
        // DoT-only applier: the corrosion tick (not a direct basic) is the lethal intake.
        const dotEnemy = manualEnemy('dotEnemy', 1000, 40, {
            shipSkills: { slots: [{ slot: 'active', abilities: [corrosionDot()] }] },
        });

        const { hpChanged, cheated, result } = run(
            healBase({
                numRounds: 5,
                hp: 500, // small → the accumulated corrosion tick becomes lethal
                speed: 100, // tank ticks its DoTs at its own (fast) turn-start each round
                selfBuffs: [cheatDeathBuff()],
                enemyAttackers: [dotEnemy],
            })
        );

        // The save fired exactly once, triggered by a DoT-tick intake (not a direct hit).
        expect(cheated).toHaveLength(1);
        const saveRound = cheated[0].round;

        // The DoT-tick crossing that triggered the save emitted an hp-changed landing the survivor
        // at exactly 1 HP of 500 max = 0.2% — strictly positive, NOT 0 (the floor + removable-clear
        // path ran rather than the destroy path).
        const saveCrossing = hpChanged.find(
            (e) =>
                e.targetId === 'attacker' && e.round === saveRound && e.newPct > 0 && e.newPct < 1
        );
        expect(saveCrossing).toBeDefined();
        expect(saveCrossing!.newPct).toBeCloseTo((100 * 1) / 500, 6); // 0.2% — floored at 1 HP

        // Sanity: the save round itself recorded no destroy (the intercept ran instead).
        expect(result.healing!.destroyedRound).not.toBe(saveRound);
    });

    // ── Branch 5: lethal hit, no Cheat Death → currentHp 0, ship-destroyed emitted once ──
    // A single lethal 3000 hit vs hp 2000, no Cheat Death → the tank reaches 0 HP and is
    // destroyed. ship-destroyed fires exactly once; destroyedRound is recorded.
    it('lethal hit, no Cheat Death: HP reaches 0, ship-destroyed emitted once', () => {
        const { cheated, destroyed, result } = run(
            healBase({
                numRounds: 2,
                hp: 2000,
                selfBuffs: [], // no Cheat Death
                enemyAttackers: [manualEnemy('atk1', 3000)],
            })
        );

        // No save; the tank is destroyed on round 1.
        expect(cheated).toHaveLength(0);
        const tankDestroyed = destroyed.filter((d) => d.actorId === 'attacker');
        expect(tankDestroyed).toHaveLength(1);
        expect(tankDestroyed[0].round).toBe(1);
        expect(result.healing!.destroyedRound).toBe(1);
    });
});
