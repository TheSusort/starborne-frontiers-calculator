/**
 * Tests for the engine's player→enemy victim-intake wrapper (`applyOutgoingToEnemy` in
 * `engine.ts`). This is the second thin wrapper over the shared `applyVictimDamage` core
 * (Task 2), carrying an ENEMY-SIDE sink whose accounting hooks are no-ops for PR 1 (the
 * tank-incoming round accumulators must NOT move when a player attacks an enemy) and which
 * omits `onHealTargetDestroyed`. The wrapper still runs the FULL HP/shield/Barrier/
 * Cheat-Death/recordDestroyed path on the enemy victim, so enemies actually take damage and
 * can die.
 *
 * REACHABILITY: there is NO production call site for `applyOutgoingToEnemy` yet — Task 8 wires
 * it into the player→enemy damage sites. So it cannot be exercised through normal `runCombat`
 * flow today. To test the REAL closure (not a mock), `runCombat` accepts a narrow test-only tap
 * `__testTapApplyOutgoingToEnemy` that hands the genuine closure out once on the first round it
 * is built. Each test runs a healing-mode `runCombat` (the cheapest way to spin up the engine's
 * statusEngine/bus/recordDestroyed/recipientMaxHp context the closure captures), captures the
 * real wrapper through the tap, then invokes it against a hand-built enemy `CombatActor` victim
 * and observes the genuine mutations/emissions. The enemy-side accounting is verified to be a
 * no-op by checking the tank-incoming round accumulators (incomingDamage/shieldAbsorbed/
 * barrierAbsorbed) are untouched by the wrapper's calls.
 *
 * Behaviors verified against a hand-built enemy victim:
 *   1. plain HP damage (shield 0) — currentHp drops by exactly the damage;
 *   2. shield absorbs first, overflow hits HP;
 *   3. enemy carrying Barrier → full block, HP unchanged, barriered:true;
 *   4. lethal damage, no Cheat Death → currentHp 0 + ship-destroyed emitted once;
 *   5. lethal damage on an enemy Cheat-Death carrier → survives at 1 HP;
 *   6. enemy-side sink is a no-op: tank-incoming round accumulators stay at 0.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createActor, CombatActor } from '../state';
import { createEventBus, CombatEvent } from '../events';
import { ShipSkills } from '../../../types/abilities';

type ApplyOutgoing = (
    damage: number,
    enemyVictim: CombatActor
) => { shieldBefore: number; hpDamage: number; barriered: boolean };

/** A hand-built enemy victim CombatActor with a given id and HP. */
const enemyVictim = (id: string, hp: number): CombatActor =>
    createActor({
        id,
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp,
            speed: 50,
        },
    });

/** A no-payload always-active self-buff (recurring) the enemy attacker carries on its own id. */
const selfBuffSkills = (buffName: string): ShipSkills => ({
    slots: [
        {
            slot: 'passive',
            abilities: [
                {
                    id: `${buffName}-self`,
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName,
                        stacks: 1,
                        isStackable: false,
                        duration: 'recurring',
                        parsedEffects: {},
                    },
                },
            ],
        },
    ],
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A minimal enemy attacker; optional shipSkills lets it carry a self-buff under its own id. */
const enemyAttacker = (id: string, shipSkills?: ShipSkills): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    ...(shipSkills ? { shipSkills } : {}),
});

const healBase = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1,
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
    ...overrides,
});

/**
 * Spin up the engine in healing mode and capture the REAL `applyOutgoingToEnemy` closure via the
 * test tap. Returns the captured wrapper, the bus events, and the round accounting so the no-op
 * sink can be asserted. `enemyAttackers` are passed so any self-buff carrier exists as a real
 * enemy actor whose id matches the hand-built victim's id (so selfBuffNamesForOwners sees it).
 */
const captureWrapper = (overrides: Partial<CombatEngineInput> = {}) => {
    const bus = createEventBus();
    const destroyed: Extract<CombatEvent, { type: 'ship-destroyed' }>[] = [];
    const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
    bus.on('ship-destroyed', (e) => destroyed.push(e));
    bus.on('cheat-death-activated', (e) => cheated.push(e));
    let wrapper: ApplyOutgoing | undefined;
    const result = runCombat({
        ...healBase(overrides),
        bus,
        __testTapApplyOutgoingToEnemy: (fn) => {
            if (!wrapper) wrapper = fn;
        },
    } as CombatEngineInput);
    if (!wrapper) throw new Error('test tap was never invoked — applyOutgoingToEnemy not built');
    return { wrapper, destroyed, cheated, result };
};

describe('applyOutgoingToEnemy (player→enemy per-victim damage apply wrapper)', () => {
    it('plain HP damage (no shield): decrements the enemy victim HP by exactly the damage', () => {
        const { wrapper } = captureWrapper();
        const victim = enemyVictim('e1', 10_000);
        const out = wrapper(3000, victim);
        expect(victim.currentHp).toBe(7000);
        expect(victim.shieldPool).toBe(0);
        expect(out).toMatchObject({ hpDamage: 3000, barriered: false });
        expect(victim.destroyedRound).toBeUndefined();
    });

    it('shield absorbs first, overflow spills to enemy HP', () => {
        const { wrapper } = captureWrapper();
        const victim = enemyVictim('e1', 10_000);
        victim.shieldPool = 2500;
        const out = wrapper(4000, victim);
        expect(victim.shieldPool).toBe(0);
        expect(victim.currentHp).toBe(8500); // only the 1500 overflow drained HP
        expect(out).toMatchObject({ shieldBefore: 2500, hpDamage: 1500, barriered: false });
    });

    it('enemy carrying Barrier: full block — HP unchanged, barriered true', () => {
        // The Barrier carrier exists as a real enemy attacker so its self-buff is registered under
        // its own id; the hand-built victim reuses that same id so selfBuffNamesForOwners sees it.
        const { wrapper } = captureWrapper({
            enemyAttackers: [enemyAttacker('barrierEnemy', selfBuffSkills('Barrier'))],
        });
        const victim = enemyVictim('barrierEnemy', 10_000);
        const out = wrapper(5000, victim);
        expect(victim.currentHp).toBe(10_000); // fully blocked
        expect(victim.shieldPool).toBe(0); // Barrier never touches the shield
        expect(out).toMatchObject({ hpDamage: 0, barriered: true });
    });

    it('lethal damage, no Cheat Death: enemy HP reaches 0, ship-destroyed emitted once', () => {
        const { wrapper, destroyed } = captureWrapper();
        const victim = enemyVictim('e1', 2000);
        const out = wrapper(3000, victim);
        expect(victim.currentHp).toBe(0);
        expect(out.barriered).toBe(false);
        const forVictim = destroyed.filter((d) => d.actorId === 'e1');
        expect(forVictim).toHaveLength(1);
        expect(victim.destroyedRound).toBe(1);
    });

    it('lethal damage on an enemy Cheat-Death carrier: survives at 1 HP, no destroy', () => {
        const { wrapper, cheated, destroyed } = captureWrapper({
            enemyAttackers: [enemyAttacker('cdEnemy', selfBuffSkills('Cheat Death'))],
        });
        const victim = enemyVictim('cdEnemy', 2000);
        wrapper(3000, victim);
        expect(victim.currentHp).toBe(1); // floored, not destroyed
        expect(victim.destroyedRound).toBeUndefined();
        expect(cheated.filter((c) => c.actorId === 'cdEnemy')).toHaveLength(1);
        expect(destroyed.filter((d) => d.actorId === 'cdEnemy')).toHaveLength(0);
    });

    it('enemy-side sink is a no-op: tank-incoming round accumulators stay untouched', () => {
        const { wrapper, result } = captureWrapper();
        // Drive several enemy-victim intakes through the wrapper — none should touch the
        // tank-incoming buckets (those belong to the enemy→player direction only).
        wrapper(3000, enemyVictim('e1', 10_000));
        wrapper(4000, enemyVictim('e2', 10_000));
        const rounds = result.healing!.rounds;
        // No enemy attacked the tank in this scenario, so all incoming accumulators are 0 and
        // must STAY 0 despite the wrapper's calls (the enemy-side sink writes nothing here).
        expect(rounds[0].incomingDamage).toBe(0);
        expect(rounds[0].shieldAbsorbed).toBe(0);
        expect(rounds[0].barrierAbsorbed).toBe(0);
    });
});
