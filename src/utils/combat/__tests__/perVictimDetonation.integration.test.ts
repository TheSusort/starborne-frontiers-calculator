/**
 * Per-victim skill-triggered detonation on the POSITIONAL apply path (player → enemy).
 *
 * Prior tasks shipped the pure math (`detonateContainers`) and made `runPlayerTurn` SKIP the
 * anchor detonation when `positional` is set (returning a `positionalDetonation` recipe instead,
 * with `detonationDamage === 0`). THIS suite pins the engine wiring: when the focus attacker fires
 * a positional AoE detonate skill, EACH footprint victim HIT by the firing damage (and still alive)
 * detonates its OWN stored containers — bombs (full shield drain, no pen) and inferno+corrosion
 * (BYPASS shield, DoT semantics) — landing on that victim's own HP via `applyVictimDamage`, emitting
 * per-victim `bomb-detonated` / `dot-detonated`, and surfacing on a per-round `perActorDetonation`
 * tally (the focus `detonationDamage` row sources from it in positional mode).
 *
 * SEEDING: containers cannot be applied per-footprint-victim via abilities (DoT-apply hits only the
 * anchor), so we pre-seed each enemy victim's `pendingBombs` / `corrosionEntries` / `infernoEntries`
 * directly through the `__testTapActors` construction hook (the same approach
 * bombSplashOnDeath.integration.test.ts uses for pre-seeded bombs). The focus then fires a
 * Line-Range-1 AoE detonate skill at `front`, anchored at the front enemy (M4) covering M3.
 *
 * Crit 0 keeps every credited value an exact integer.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb, ActiveDoTStack } from '../state';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvd${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A small single-hit basic attack (multiplier 100%, 1 hit). attack is kept tiny so the FIRING hit
// touches every footprint victim (marking them "hit") WITHOUT killing the high-HP ones.
const basicAttack = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

const detonate = (dotType: 'bomb' | 'inferno' | 'corrosion', powerPct = 100): Ability =>
    ab({
        type: 'detonate-dot',
        target: 'enemy',
        config: { type: 'detonate-dot', dotType, powerPct },
    });

// An active slot: a basic attack (so the firing hit lands per-victim) plus the requested detonate
// abilities (which the engine turns into the per-victim detonation recipe in positional mode).
const detonateSlot = (...dets: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [basicAttack(), ...dets],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1). Anchored at
// the FRONT enemy (M4) it covers M3 — both are HIT by the firing damage.
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// A positioned, zero-offense, finite-HP enemy victim (a stationary, damageable target).
const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

// A pre-seeded bomb with all multipliers neutral (bomb payout = stacks × damagePerStack × powerPct).
const bomb = (damagePerStack: number, stacks: number, sourceId = 'attacker'): PendingBomb => ({
    countdown: 5, // never decremented to 0 before detonation
    damagePerStack,
    stacks,
    tier: 100,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

// A pre-seeded corrosion entry. Detonation corrosion payout (powerPct 100, neutral mults) =
// stacks × (tier/100) × min(victimHp, 500_000) × remainingRounds.
const corrosion = (tier: number, stacks: number, remainingRounds: number): ActiveDoTStack => ({
    stacks,
    tier,
    remainingRounds,
    sourceId: 'attacker',
});

const FOCUS_ATTACK = 100; // tiny firing hit — marks victims hit without killing high-HP ones.

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: FOCUS_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [detonateSlot(detonate('bomb'))] },
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
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: lineRange1Pattern(),
    enemyAttackers: [
        enemyAt('enemy-front', 'M4', 1_000_000_000),
        enemyAt('enemy-mid', 'M3', 1_000_000_000),
    ],
    ...overrides,
});

// Tap an ordered event log (mirrors engine.events.test.ts).
const collect = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = ['bomb-detonated', 'dot-detonated', 'ship-destroyed'];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

describe('per-victim skill-triggered detonation (positional player → enemy)', () => {
    it('BOTH the origin and the covered victim detonate their OWN bombs (covered no longer ignored)', () => {
        idc = 0;
        // Each victim carries a 2 × 1000 bomb → detonates for 2000 (powerPct 100, neutral mults).
        const { events, result } = collect(
            BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'enemy-front')?.pendingBombs.push(bomb(1000, 2));
                    actors.find((a) => a.id === 'enemy-mid')?.pendingBombs.push(bomb(1000, 2));
                },
            })
        );
        const round = result.rounds[0];
        // Per-target damage = firing hit (origin full 100 / covered half 50) + detonation 2000 each.
        expect(round.perTargetDamage?.['enemy-front']).toBe(100 + 2000);
        expect(round.perTargetDamage?.['enemy-mid']).toBe(50 + 2000);
        // The per-round detonation tally credits the focus attacker the SUM across both victims.
        expect(round.perActorDetonation?.['attacker']).toBe(4000);
        // bomb-detonated emitted per victim (one per bomb-carrying victim hit).
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(2);
        for (const e of bombDet) {
            expect(e.actorId).toBe('attacker');
            expect(e.damage).toBe(2000);
        }
    });

    it("corrosion detonation uses the VICTIM's own HP for min(hp, 500k)", () => {
        idc = 0;
        // Only the covered victim (enemy-mid, HP 300_000) carries corrosion: tier 100, 1 stack,
        // remainingRounds 1 → payout = 1 × (100/100) × min(300_000, 500_000) × 1 = 300_000.
        const { result } = collect(
            BASE({
                shipSkills: { slots: [detonateSlot(detonate('corrosion'))] },
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 300_000),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-mid')
                        ?.corrosionEntries.push(corrosion(100, 1, 1));
                },
            })
        );
        const round = result.rounds[0];
        // covered victim: firing hit 50 (half of 100) + corrosion detonation 300_000 (bypass).
        expect(round.perTargetDamage?.['enemy-mid']).toBe(50 + 300_000);
        expect(round.perActorDetonation?.['attacker']).toBe(300_000);
    });

    it('a victim whose detonation exceeds its HP DIES; a leftover bomb then splashes its ally', () => {
        idc = 0;
        // Covered victim enemy-mid (HP 1000) carries BOTH a corrosion entry (detonated this cast —
        // tier 100, 1 stack, 1 round, hp-capped 1000 → 1000 damage, lethal) AND a leftover bomb the
        // CORROSION-typed detonate does NOT consume. The detonate skill detonates ONLY corrosion, so
        // the bomb survives → enemy-mid dies from the corrosion detonation while still carrying the
        // bomb → bomb-splash-on-death fires to its adjacent ally (enemy-back at M2, a hex-neighbour
        // of M3 but OUTSIDE the M4-anchored Line-Range-1 footprint → it took no firing/detonation
        // damage, isolating the splash). enemy-front (origin, huge HP) just detonates nothing extra.
        const leftover = bomb(800, 1, 'enemy-mid'); // splash = 1 × 800 × (100/4)/100 = 200
        const { events, result } = collect(
            BASE({
                shipSkills: { slots: [detonateSlot(detonate('corrosion'))] },
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 1000),
                    enemyAt('enemy-back', 'M2', 1_000_000_000), // adjacent to M3, outside footprint, survives splash
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    const mid = actors.find((a) => a.id === 'enemy-mid');
                    mid?.corrosionEntries.push(corrosion(100, 1, 1)); // 1000 → lethal
                    mid?.pendingBombs.push(leftover); // NOT consumed by the corrosion detonate
                },
            })
        );
        const round = result.rounds[0];
        // enemy-mid died this round.
        const destroyed = events.filter((e) => e.type === 'ship-destroyed');
        expect(destroyed.some((e) => e.actorId === 'enemy-mid')).toBe(true);
        // Its leftover bomb splashed the adjacent ally (bomb-splash-on-death chain).
        expect(round.perActorSplash?.['enemy-back']).toBe(200);
    });

    it("dot-detonated emits per victim carrying that victim's id (inferno + corrosion bypass)", () => {
        idc = 0;
        // enemy-mid carries an inferno entry; the detonate skill detonates inferno. Inferno payout =
        // stacks × (tier/100) × effectiveAttack × remainingRounds × dotMult × affinityMult × pct ×
        // detonationMult. With dotMult/affinityMult/detonationMult = 1, effectiveAttack = 100:
        // 1 × (100/100) × 100 × 1 = 100.
        const { events, result } = collect(
            BASE({
                shipSkills: { slots: [detonateSlot(detonate('inferno'))] },
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-mid')
                        ?.infernoEntries.push({
                            stacks: 1,
                            tier: 100,
                            remainingRounds: 1,
                            sourceId: 'attacker',
                        });
                },
            })
        );
        const round = result.rounds[0];
        const dotDet = events.filter((e) => e.type === 'dot-detonated');
        // Exactly one dot-detonated, carrying the covered victim's id.
        expect(dotDet.length).toBe(1);
        expect(dotDet[0].targetId).toBe('enemy-mid');
        expect(dotDet[0].damage).toBe(100);
        // Covered victim took firing 50 + inferno bypass 100.
        expect(round.perTargetDamage?.['enemy-mid']).toBe(50 + 100);
        expect(round.perActorDetonation?.['attacker']).toBe(100);
    });

    it('a NON-detonating positional cast does not populate perActorDetonation (no-op guard)', () => {
        idc = 0;
        // A bomb-bearing roster but the focus fires a plain AoE (no detonate ability) → the recipe
        // has no dets → the per-victim detonation loop never runs → perActorDetonation absent.
        const { events, result } = collect(
            BASE({
                shipSkills: { slots: [detonateSlot()] }, // basic attack only, no detonate
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'enemy-front')?.pendingBombs.push(bomb(1000, 2));
                    actors.find((a) => a.id === 'enemy-mid')?.pendingBombs.push(bomb(1000, 2));
                },
            })
        );
        const round = result.rounds[0];
        expect(round.perActorDetonation).toBeUndefined();
        expect(events.filter((e) => e.type === 'bomb-detonated').length).toBe(0);
        // Firing hit still lands per-victim.
        expect(round.perTargetDamage?.['enemy-front']).toBe(100);
        expect(round.perTargetDamage?.['enemy-mid']).toBe(50);
    });
});
