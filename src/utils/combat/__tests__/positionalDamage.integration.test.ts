/**
 * Task 8b — positional AoE damage APPLY wired into the focus + team damage sites.
 *
 * Tasks 1–7 built the per-victim damage pipeline (victimHitDamage / applyOutgoingToEnemy /
 * applyPositionalDamage) but left it unreachable through `runCombat`. Task 8b wires it in: when
 * the focus attacker (or a walked team actor) carries a board `position` + a parsed `target` +
 * a parsed `pattern` AND the positioned enemy roster is non-empty AND its firing hit produced
 * `turn.positionalScalars`, the engine drives `applyPositionalDamage` against the LIVE enemy
 * roster — landing real per-victim HP damage (origin full, covered half) — and SUPPRESSES the
 * legacy DPS-sink direct/secondary/conditional credit for that case (so the firing-hit damage is
 * not double-counted into cumulativeDamage). Detonation credit is preserved (bombs are separate).
 *
 * REACHABILITY: the positioned enemy roster (`enemyAttackerActors`) is only populated in HEALING
 * mode (the engine throws `enemyAttackers require healTargetId` otherwise) — so every test here
 * runs `runCombat` with `healTargetId` set.
 *
 * OBSERVABLE: the engine does not surface live enemy-actor HP, and the per-victim `hp-changed`
 * crossing is suppressed for enemy victims (their max HP is unknown to the tank-centric
 * recipientMaxHp). What IS observable is `ship-destroyed`: `applyOutgoingToEnemy` runs the full
 * HP/death path and emits `ship-destroyed{actorId}` when a victim's HP reaches 0. So we PIN the
 * landed damage with lethality brackets — size each enemy's HP just AT or just ABOVE the expected
 * damage and assert it dies / survives accordingly. `damageLandedInRange(victimId)` runs two
 * combats (HP = lo → must die; HP = hi → must survive) to bracket the firing-hit damage to
 * `[lo, hi)`. A NON-positional run lands NO enemy damage (the enemy actors are pure targets the
 * legacy path never touches), so the victim never dies regardless of HP.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pd${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A no-passive single-hit basic-attack active slot. `multiplier: 100` (1x), 1 hit. No passive
// payload damage, so the firing-hit damage equals turn.directDamage exactly (single victim).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// A positioned, finite-HP enemy with zero offense (a stationary, damageable target). `hp`
// is sized per-test to sit at/above the expected firing-hit damage so death brackets it.
const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// Single-target pattern: origin cell only (Pattern-Base).
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1).
// Anchored at the FRONT enemy (M4 = axial (2,1)) it covers (1,1) = M3.
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

// Focus attacker positioned at M4 with a real basic attack. `attack: 5000` against
// `defence: 0` victims; multiplier 100 (1x), 1 hit → a clean known firing-hit damage.
const BASE = (
    overrides: Partial<CombatEngineInput> = {},
    target?: ParsedTarget,
    pattern?: ParsedPattern
): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    hp: 1_000_000_000,
    // Healing mode — required for the positioned enemy roster to be built.
    healTargetId: 'attacker',
    position: 'M4',
    ...(target ? { target } : {}),
    ...(pattern ? { pattern } : {}),
    ...overrides,
});

/** The set of distinct actor ids that emitted a ship-destroyed event in this run. */
const destroyedIds = (input: CombatEngineInput): Set<string> => {
    const bus = createEventBus();
    const ids = new Set<string>();
    bus.on('ship-destroyed', (e) => {
        ids.add(e.actorId);
    });
    runCombat({ ...input, bus });
    return ids;
};

describe('Task 8b — positional AoE damage apply at the focus site', () => {
    // Focus: attack 5000 × 100% × 1 hit vs defence 0, no crit → firing-hit damage = 5000.
    it('single-target pattern: the targeted enemy takes EXACTLY the firing-hit damage (death bracket)', () => {
        // Front enemy at M4 (the `front` selection target); back enemy at M1 untouched by a
        // base (origin-only) footprint. HP=5000 → dies (damage ≥ 5000); HP=5001 → survives
        // (damage < 5001) → pins the landed damage to exactly 5000.
        const atFront = (frontHp: number): CombatEngineInput =>
            BASE(
                {
                    enemyAttackers: [
                        enemyAt('enemy-front', 'M4', frontHp),
                        enemyAt('enemy-back', 'M1', 5000),
                    ],
                },
                parsedTarget('front'),
                basePattern()
            );
        idc = 0;
        const deadAt5000 = destroyedIds(atFront(5000));
        idc = 0;
        const deadAt5001 = destroyedIds(atFront(5001));
        // The origin victim dies at HP 5000 but survives at 5001 → exactly 5000 landed.
        expect(deadAt5000.has('enemy-front')).toBe(true);
        expect(deadAt5001.has('enemy-front')).toBe(false);
        // The back enemy (HP 5000) is outside the origin-only footprint → never hit, never dies.
        expect(deadAt5000.has('enemy-back')).toBe(false);
    });

    it('AoE pattern: origin takes FULL (5000) and the covered enemy takes HALF (2500)', () => {
        // Line-Range-1 anchored at M4 covers M3. Origin = front (M4), covered = mid (M3).
        const aoe = (frontHp: number, midHp: number): CombatEngineInput =>
            BASE(
                {
                    enemyAttackers: [
                        enemyAt('enemy-front', 'M4', frontHp),
                        enemyAt('enemy-mid', 'M3', midHp),
                    ],
                },
                parsedTarget('front'),
                lineRange1Pattern()
            );
        // Origin full damage = 5000: dies at HP 5000, survives at 5001.
        idc = 0;
        const lo = destroyedIds(aoe(5000, 2500));
        idc = 0;
        const hi = destroyedIds(aoe(5001, 2501));
        // Origin pinned to exactly 5000 (full); covered pinned to exactly 2500 (half).
        expect(lo.has('enemy-front')).toBe(true);
        expect(hi.has('enemy-front')).toBe(false);
        expect(lo.has('enemy-mid')).toBe(true); // covered dies at HP 2500 → took ≥ 2500
        expect(hi.has('enemy-mid')).toBe(false); // survives at 2501 → took < 2501 → exactly 2500 (half)
    });

    it('byte-identical sanity: a NON-positional run lands NO enemy HP damage (legacy dummy sink)', () => {
        idc = 0;
        // No position on the focus → positional is false → legacy path. The enemy actors here are
        // pure targets; the legacy path drains the dummy sink, never these enemies' HP. Even at
        // HP=1 (trivially lethal if any damage landed) they survive.
        const input = BASE({
            position: undefined,
            enemyAttackers: [enemyAt('enemy-front', 'M4', 1), enemyAt('enemy-back', 'M1', 1)],
        });
        const dead = destroyedIds(input);
        expect(dead.has('enemy-front')).toBe(false);
        expect(dead.has('enemy-back')).toBe(false);
    });
});

type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const teamActorAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    pattern: ParsedPattern
): TeamActor => ({
    id,
    speed: 200, // faster than the focus
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget(selection),
    pattern,
    walk: {
        shipSkills: { slots: [basicAttack()] },
        stats: {
            attack: 7000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1_000_000_000,
        },
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

describe('Task 8b — positional AoE damage apply at the walked-team site', () => {
    it('a walked team actor lands its OWN positional firing-hit damage on its OWN selected enemy', () => {
        // Focus at M4 selects `front` (origin M4, attack 5000 → 5000 damage); team actor at M1
        // selects `back` (origin M1, attack 7000 → 7000 damage). Distinct origin-only targets so
        // the two firing hits don't overlap. Death brackets pin each independently.
        const run = (frontHp: number, backHp: number): CombatEngineInput =>
            BASE(
                {
                    teamActors: [teamActorAt('team-1', 'M1', 'back', basePattern())],
                    enemyAttackers: [
                        enemyAt('enemy-front', 'M4', frontHp),
                        enemyAt('enemy-back', 'M1', backHp),
                    ],
                },
                parsedTarget('front'),
                basePattern()
            );
        idc = 0;
        const lo = destroyedIds(run(5000, 7000));
        idc = 0;
        const hi = destroyedIds(run(5001, 7001));
        // Focus pins the front enemy to exactly 5000; team actor pins the back enemy to exactly 7000.
        expect(lo.has('enemy-front')).toBe(true);
        expect(hi.has('enemy-front')).toBe(false);
        expect(lo.has('enemy-back')).toBe(true);
        expect(hi.has('enemy-back')).toBe(false);
    });
});
