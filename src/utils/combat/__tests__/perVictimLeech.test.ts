/**
 * E2 Task 3 — PER-VICTIM standing leech on the positional apply path.
 *
 * Before E2, standing damage-dealt leeches were suppressed on the positional path: the
 * firing-hit damage lands per-victim via `applyPositionalDamage`, but the aggregate
 * `creditDamage(... 'direct' ...)` (which is what `procStandingLeeches` rides) is SKIPPED
 * for the positional case (no double-count). So a positional AoE attacker's own
 * standing leech never fired.
 *
 * E2 wires an `onVictimResolved` callback at the player→enemy positional sites that procs
 * the ACTING attacker's standing leeches off EACH footprint victim's dealt damage. Because
 * the per-victim `damage` is already role-scaled (origin full, covered half), leeching off
 * `damage` per victim yields exactly `origin dealt + 0.5×covered dealt`.
 *
 * Harness mirrors twoTeamBattle.test.ts / positionalDamage.integration.test.ts: positioned
 * actors, `healTargetId` to unlock the enemy roster, a passive damage-dealt heal leech on
 * the focus. Crit 0 keeps every credited value an exact integer; the heal-crit test pins the
 * per-victim heal-crit-gate cadence explicitly.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvl${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// Single-hit basic attack: multiplier 100% (1x), 1 hit, no passive payload — so the firing
// hit's per-victim damage is attack × roleScale vs defence 0 (origin full, covered half).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// A passive-slot damage-dealt heal leech (STANDING). `target` defaults to 'self' → the
// acting attacker is the recipient.
const leechHeal = (
    pct: number,
    extra: { leechScope?: 'all' | 'detonation'; noCrit?: boolean } = {},
    target: Ability['target'] = 'self'
): Ability =>
    ab({
        type: 'heal',
        target,
        config: { type: 'heal', pct, basis: 'damage-dealt', leechScope: 'all', ...extra },
    });

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1).
// Anchored at the FRONT enemy (M4) it covers M3 — origin full, covered half.
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

// A positioned, finite-HP enemy with zero offense (a stationary, damageable target).
const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

/** Sum a healing bucket over every round for `actorId` (defaults to the focus). */
const sumHeal = (
    result: ReturnType<typeof runCombat>,
    bucket: 'directHeal' | 'effectiveHeal' | 'overheal',
    actorId = 'attacker'
): number =>
    (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(actorId)?.[bucket] ?? 0),
        0
    );

// Focus attacker positioned at M4 firing Line-Range-1 at `front`. attack 5000 × 100% × 1 hit
// vs defence-0 victims. Origin (front enemy at M4) takes 5000, covered (mid enemy at M3) 2500.
// The focus carries a passive 20% damage-dealt self heal leech.
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            basicAttack(),
            { slot: 'passive', abilities: [leechHeal(20, { leechScope: 'all' })] },
        ],
    },
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
    // Below max HP so the heal has deficit to consume (effectiveHeal observable).
    hp: 1_000_000,
    healModifier: 0,
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: lineRange1Pattern(),
    enemyAttackers: [
        enemyAt('enemy-front', 'M4', 1_000_000_000),
        enemyAt('enemy-mid', 'M3', 1_000_000_000),
    ],
    ...overrides,
});

describe('E2 T3 — per-victim standing leech on the positional path', () => {
    it('standing leech credits origin dealt + 0.5×covered dealt (20% of 5000 + 2500 = 1500)', () => {
        idc = 0;
        // Origin 5000 + covered 2500 = 7500 dealt; 20% leech → directHeal 1500. crit 0 → no fold.
        const result = runCombat(BASE());
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(1500, 6);
    });

    it('standing leech with healModifier 50 folds × 1.5 per victim → 2250', () => {
        idc = 0;
        // (5000 + 2500) × 0.20 × 1.5 = 2250. healModifier folds into a heal-kind leech.
        const result = runCombat(BASE({ healModifier: 50 }));
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(2250, 6);
    });

    it('standing leech heal-crit gate draws ONCE PER VICTIM (crit 100 → both victims double)', () => {
        idc = 0;
        // crit 100 → the FIRING damage crits (× 2 via critDamage 100), so the per-victim dealt
        // damage is origin 10000 / covered 5000. crit 100 also makes activeHealCritGate(1.0)
        // always crit, and the per-victim proc draws the gate ONCE PER VICTIM → both leeches
        // double via critDamage 100.
        // origin: 10000 × 0.20 × 2 = 4000; covered: 5000 × 0.20 × 2 = 2000 → total 6000.
        const result = runCombat(BASE({ crit: 100, critDamage: 100 }));
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(6000, 6);
    });

    it('detonation-scoped leech does NOT fire on the per-victim direct channel', () => {
        idc = 0;
        // A detonation-scoped leech must be inert on the positional `direct` per-victim path
        // (no bomb in this run) → zero directHeal.
        const result = runCombat(
            BASE({
                shipSkills: {
                    slots: [
                        basicAttack(),
                        {
                            slot: 'passive',
                            abilities: [leechHeal(20, { leechScope: 'detonation' })],
                        },
                    ],
                },
            })
        );
        expect(sumHeal(result, 'directHeal')).toBe(0);
    });
});
