/**
 * PR7 Task 8 — LOCK: incoming/outgoing DAMAGE MODIFIERS apply to DIRECT damage ONLY.
 *
 * GAME RULE (confirmed by the maintainer): the "Inc. Damage Down/Up" victim self-buff and
 * the "Out. Damage Up" enemy debuff — both surfaced in the engine via
 * `incomingDamageModifierPct` inside `defenseProfileOf` (engine.ts ~3446) and consumed by the
 * DIRECT per-hit calc in `applyPositionalDamage` — must NOT scale bomb-detonation damage.
 * Bombs apply through a SEPARATE path (`processBombs` / `applyVictimDamage(..., { bombPortion })`
 * / `detonationDamageModifier`) that never reads `incomingDamageModifierPct`. DoT ticks likewise
 * honour only `incomingDotReductionPct` (Vortex Veil). This is BY DESIGN, not a deferral.
 *
 * This suite is a REGRESSION LOCK: bombs already bypass the modifier on current code, so every
 * assertion below should PASS as-is. If any FAILS, a modifier has leaked into the bomb path —
 * that is a real bug and the minimal exclusion fix must restore the raw bomb value.
 *
 * Crit is forced off everywhere → every credited value is an exact integer.
 *
 * Two cases, mirroring the two bomb paths:
 *   (1) POSITIONAL per-victim detonation — a positioned team victim self-buffs Inc. Damage
 *       Down II (-30%) on its OWN turn, then a pre-seeded timed bomb bursts on that same turn
 *       against its OWN HP. The burst is recorded in perTargetDamage[victim]; we assert it
 *       equals the RAW seeded burst (NOT burst × (1 − 0.30)). Mirrors
 *       selfIncomingBuffFold.integration.test.ts (self-buff up at hit time) +
 *       perVictimTimedDetonation.integration.test.ts (timed burst on the victim's own turn).
 *   (2) NON-positional focus-dummy `processBombs` — the focus dummy enemy carries an
 *       "Out. Damage Up" enemy debuff (incomingDamage +50, which WOULD scale a direct hit)
 *       AND a pre-seeded timed bomb. We assert the bomb surfaces via `detonationDamage` at its
 *       RAW seeded value (NOT burst × 1.50), proving the enemy-debuff modifier never reaches
 *       the legacy focus-dummy bomb path either.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import type { SelectedGameBuff } from '../../../types/calculator';
import { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb } from '../state';
import type { CombatEvent } from '../events';

type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

// ── Targeting helpers ───────────────────────────────────────────────────────────
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// ── Self-buff ability: Inc. Damage Down II (-30% incoming DIRECT damage) on own turn ───────
// duration 2 so it survives the post-turn decrement and is still active later in the round.
const incDamageDownSelfBuff = (id: string): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Inc. Damage Down II',
        parsedEffects: { incomingDamage: -30 },
        stacks: 1,
        isStackable: false,
        duration: 2,
    },
});

// A pre-seeded TIMED bomb. burst = stacks × damagePerStack × affinityMult × (1 + detMod/100).
// With neutral mults (affinityMult 1, detMod 0): burst = stacks × damagePerStack.
const timedBomb = (
    damagePerStack: number,
    stacks: number,
    countdown: number,
    sourceId = 'attacker'
): PendingBomb => ({
    countdown,
    damagePerStack,
    stacks,
    tier: 100,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

// ────────────────────────────────────────────────────────────────────────────────
// Case 1 — POSITIONAL per-victim detonation bypasses the victim's Inc. Damage modifier
// ────────────────────────────────────────────────────────────────────────────────

/**
 * A positioned TEAM victim that self-casts Inc. Damage Down II on its own turn and carries a
 * pre-seeded timed bomb. speed 1 → it takes one turn each round; on its own turn the self-buff
 * applies FIRST (active slot), then the per-positioned-enemy/team timed burst fires against its
 * own HP. The bomb burst lands per-victim via applyVictimDamage (NOT defenseProfileOf), so the
 * Inc. Damage Down -30% must NOT touch it.
 *
 * attack 0 → contributes no direct damage (keeps the per-target accounting clean).
 */
const selfBuffingVictim = (id: string, position: Position, hp: number): TeamActor => ({
    id,
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: {
            slots: [{ slot: 'active', abilities: [incDamageDownSelfBuff(`${id}-inc-dmg-down`)] }],
        },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const POSITIONAL_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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
    healModifier: 0,
    healTargetId: 'attacker', // healing mode → positioned roster is built
    position: 'M4',
    ...overrides,
});

describe('PR7 Task 8 — bombs bypass incoming/outgoing damage modifiers (DIRECT-only scope)', () => {
    it('Case 1 (positional): a positioned victim carrying Inc. Damage Down II (-30%) takes the RAW bomb burst, unscaled', () => {
        const bus = createEventBus();
        const bombEvents: CombatEvent[] = [];
        bus.on('bomb-detonated', (e) => bombEvents.push(e as CombatEvent));

        // Victim carries a 2 × 1000 timed bomb (countdown 2). On its OWN turn the countdown
        // decrements: round 1 → 1 (no burst), round 2 → 0 (BURST). Raw burst = 2 × 1000 = 2000.
        // The victim ALSO holds Inc. Damage Down II (-30%) — IF the modifier leaked into the
        // bomb path the burst would be 2000 × (1 − 0.30) = 1400. The lock pins 2000 (raw).
        const result = runCombat(
            POSITIONAL_BASE({
                bus,
                teamActors: [selfBuffingVictim('victim', 'M4', 1_000_000_000)],
                // A single positioned enemy so the roster is positional; it never attacks (no
                // damage abilities) so it cannot perturb the victim's HP accounting.
                enemyAttackers: [
                    {
                        id: 'enemy-1',
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: 1_000_000_000,
                            speed: 1,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        position: 'M1',
                        target: parsedTarget('front'),
                        pattern: basePattern(),
                        shipSkills: { slots: [] } as ShipSkills,
                    } as NonNullable<CombatEngineInput['enemyAttackers']>[number],
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'victim')
                        ?.pendingBombs.push(timedBomb(1000, 2, 2, 'attacker'));
                },
            })
        );

        // Round 1: bomb only decremented (2 → 1), no burst → no per-target damage on the victim.
        expect(result.rounds[0].perTargetDamage?.['victim']).toBeUndefined();

        // Round 2: countdown → 0 → RAW burst 2000 lands on the victim's own HP via applyVictimDamage.
        // NOT 1400 (which is what a leaked Inc. Damage Down -30% would produce).
        expect(result.rounds[1].perTargetDamage?.['victim']).toBe(2000);
        expect(result.rounds[1].perTargetDamage?.['victim']).not.toBe(1400);
        // Credited to the bomb applier ('attacker'), at the RAW value.
        expect(result.rounds[1].perActorDetonation?.['attacker']).toBe(2000);

        // Exactly one bomb-detonated, raw damage 2000.
        const dets = bombEvents.filter((e) => e.type === 'bomb-detonated');
        expect(dets.length).toBe(1);
        expect(dets[0]).toMatchObject({ actorId: 'attacker', round: 2, damage: 2000, stacks: 2 });
    });

    // ────────────────────────────────────────────────────────────────────────────
    // Case 2 — NON-positional focus-dummy processBombs bypasses the enemy-debuff modifier
    // ────────────────────────────────────────────────────────────────────────────
    it('Case 2 (non-positional): a focus dummy under Out. Damage Up (+50%) bursts its bomb at the RAW value', () => {
        const bus = createEventBus();
        const bombEvents: CombatEvent[] = [];
        bus.on('bomb-detonated', (e) => bombEvents.push(e as CombatEvent));

        // "Out. Damage Up" debuff on the enemy dummy: incomingDamage +50. This WOULD scale a
        // DIRECT hit by ×1.50 — but it must NOT touch the bomb burst. Timed/active so it lives
        // on the dummy as a scheduled enemy debuff and is read by victimIncomingModifiers for
        // the direct channel only.
        const outDamageUp: SelectedGameBuff = {
            id: 'bme-out-up',
            buffName: 'Out. Damage Up',
            stacks: 1,
            parsedEffects: { incomingDamage: 50 },
            isStackable: false,
            skillSource: 'active',
            skillDuration: 3,
        };

        // Focus dummy ('enemy') carries a 3 × 1000 timed bomb (countdown 2). On its OWN turn the
        // countdown decrements: round 1 → 1 (no burst), round 2 → 0 (BURST). Raw burst = 3000.
        // IF the +50% incoming modifier leaked into processBombs the burst would be 4500. Lock 3000.
        const result = runCombat({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 2,
            selfBuffs: [],
            enemyDebuffs: [outDamageUp],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            bus,
            __testTapActors: (actors: CombatActor[]) => {
                actors
                    .find((a) => a.id === 'enemy')
                    ?.pendingBombs.push(timedBomb(1000, 3, 2, 'attacker'));
            },
        });

        // Round 1: bomb decremented only → detonationDamage 0.
        expect(result.rounds[0].detonationDamage).toBe(0);
        // Round 2: RAW burst 3000 via the focus-dummy detonation channel — NOT 4500 (the +50%
        // Out. Damage Up never reaches processBombs).
        expect(result.rounds[1].detonationDamage).toBe(3000);
        expect(result.rounds[1].detonationDamage).not.toBe(4500);

        // Exactly one bomb-detonated, raw damage 3000.
        const dets = bombEvents.filter((e) => e.type === 'bomb-detonated');
        expect(dets.length).toBe(1);
        expect(dets[0]).toMatchObject({ actorId: 'attacker', round: 2, damage: 3000, stacks: 3 });
    });
});
