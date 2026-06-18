/**
 * B1 Task 4 — Per-victim defense + incoming-damage debuff in positional apply.
 *
 * Verifies that after Task 4 wires victimEnemyModifiers into drivePositionalApply's
 * defenseProfileOf, each victim's OWN defense-down and incoming-damage debuffs are
 * applied to the per-victim positional damage.
 *
 * Setup: 1-player focus at M4 (targeting 'front') vs 2 positioned enemies.
 *   - enemy-front at M4 (origin anchor, roleScale 1.0)
 *   - enemy-back at M1 (covered, roleScale 0.5) — reached by line|3| pattern
 *   The attacker fires a line|3| pattern: origin M4 + covered M3/M2/M1.
 *   Only M4 and M1 have enemies, so both are hit.
 *
 * Ability debuffs applied to enemy-front ONLY (via targetId from Task 3):
 *   - Defense Down: parsedEffects.defense = -50 (enemy-front effective defense halved)
 *   - Incoming Damage Up: parsedEffects.incomingDamage = +30 (enemy-front takes +30% more)
 *   enemy-back has no debuffs.
 *
 * Expected damage (from victimHitDamage formula, attack=1000, mult=100%, 1 hit, no crit,
 * defence=500, no affinity modifier, no outgoing buff, no pen):
 *
 *   preCritDamage = 1000 * (100/100) = 1000
 *   perHitShare   = 1000 / 1 = 1000
 *
 *   enemy-front (origin, roleScale=1.0):
 *     effectiveDefense = 500 * (1 + -50/100) = 250
 *     dr_front = calculateDamageReduction(250)  ≈  6.342%
 *     nonCritFactor = (1 - dr_front/100) * (1 + 0/100) * (1 + 30/100) * 1
 *                   = (1 - dr_front/100) * 1.3
 *     dmgFront = 1000 * 1 * nonCritFactor * 1.0
 *              ≈ 1217.55
 *
 *   enemy-back (covered, roleScale=0.5):
 *     effectiveDefense = 500 * (1 + 0/100) = 500
 *     dr_back = calculateDamageReduction(500)   ≈ 12.567%
 *     nonCritFactor = (1 - dr_back/100) * 1 * (1 + 0/100) * 1
 *     dmgBack = 1000 * 1 * nonCritFactor * 0.5
 *             ≈ 437.16
 *
 * BEFORE Task 4: defenceModifierPct=0 for all victims → enemy-front ignores its -50
 *   defense debuff; incomingDamageModifierPct comes from the attacker-fixed scalar
 *   (=0 since no scheduled enemyDebuffs) → enemy-front's +30 incoming is also ignored.
 *   Both victims use defence=500, but front has roleScale=1 and back has roleScale=0.5,
 *   so the assertions on exact per-victim values FAIL before the fix.
 *
 * AFTER Task 4: both modifiers are per-victim → exact values match.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { victimHitDamage } from '../victimDamage';
import type { AttackerDamageScalars, VictimDefenseProfile } from '../victimDamage';
import { calculateDamageReduction } from '../../autogear/priorityScore';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvdd${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// Origin-only (single-target) footprint.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// Line-range-3: origin (anchor) + 3 covered cells extending back.
// From M4 (q:2): covers M3 (q:1), M2 (q:0), M1 (q:-1).
// With enemies at M4 (origin) and M1 (covered), both are hit.
const lineRange3Pattern = (): ParsedPattern => ({
    raw: 'line-range-3',
    shape: 'line',
    range: 3,
    modifiers: {},
});

// Active slot: damage + Defense Down + Incoming Damage Up, all on the targeted enemy.
// application='apply' → always lands (no affinity disadvantage gate).
const damageWithTwoDebuffsSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Defense Down',
                parsedEffects: { defense: -50 },
                stacks: 1,
                isStackable: false,
                application: 'apply',
                duration: 3,
            },
        }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Incoming Damage Up',
                parsedEffects: { incomingDamage: 30 },
                stacks: 1,
                isStackable: false,
                application: 'apply',
                duration: 3,
            },
        }),
    ],
});

// Passive enemy with no offensive abilities — its turns do not muddy debuff stores.
const passiveEnemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 500, hp: 100_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

// ---------------------------------------------------------------------------
// Pre-compute the expected damage from victimHitDamage's formula so the test
// pins exact numbers, not just relative ordering.
// ---------------------------------------------------------------------------
const ATTACK = 1000;
const MULTIPLIER_PCT = 100; // 1 hit × 100% multiplier (effectiveMultiplier = raw * hits)
const HITS = 1;
const DEFENCE = 500;
const DEF_MOD_FRONT = -50; // defense debuff on enemy-front
const INCOMING_MOD_FRONT = 30; // incoming-damage debuff on enemy-front

const scalars: AttackerDamageScalars = {
    effectiveAttack: ATTACK,
    multiplierPct: MULTIPLIER_PCT,
    secondaryStatValue: 0,
    hits: HITS,
    effectiveCritDamage: 0,
    outgoingDamageBuffPct: 0,
    incomingDamageModifierPct: 0, // no scheduled enemy debuffs on attacker side
    defensePenetrationPct: 0,
    attackerAffinity: 'antimatter',
};

const profileFront: VictimDefenseProfile = {
    defence: DEFENCE,
    defenceModifierPct: DEF_MOD_FRONT,
    affinity: 'antimatter',
    incomingDamageModifierPct: INCOMING_MOD_FRONT,
};

const profileBack: VictimDefenseProfile = {
    defence: DEFENCE,
    defenceModifierPct: 0,
    affinity: 'antimatter',
    // incomingDamageModifierPct absent → falls back to s.incomingDamageModifierPct (0)
};

// victimHitDamage is pure — we call it directly to get the ground-truth expectation.
const EXPECTED_FRONT = victimHitDamage(scalars, profileFront, false, 1.0);
const EXPECTED_BACK = victimHitDamage(scalars, profileBack, false, 0.5);

// Verify pre-computed values (sanity check the formula inline):
//   effDef_front = 500 * 0.5 = 250  → dr ≈ 6.342%
//   nonCrit_front = (1 - dr/100) * 1.3 → dmg_front = 1000 * nonCrit_front
//   effDef_back  = 500          → dr ≈ 12.567%
//   nonCrit_back = (1 - dr/100)      → dmg_back  = 1000 * nonCrit_back * 0.5
const _drFront = calculateDamageReduction(250);
const _drBack = calculateDamageReduction(500);
const _expFront = 1000 * (1 - _drFront / 100) * 1.3 * 1.0;
const _expBack = 1000 * (1 - _drBack / 100) * 1.0 * 0.5;

describe('B1 Task 4 — per-victim defense + incoming-damage debuff in positional apply', () => {
    it('inline formula sanity: pre-computed expected values match victimHitDamage', () => {
        expect(EXPECTED_FRONT).toBeCloseTo(_expFront, 10);
        expect(EXPECTED_BACK).toBeCloseTo(_expBack, 10);
        // front (origin, lower effective defense, incoming boost) > back (covered, full defense)
        expect(EXPECTED_FRONT).toBeGreaterThan(EXPECTED_BACK);
    });

    it('perTargetDamage reflects per-victim defense-down and incoming-damage debuffs', () => {
        idc = 0;

        const result = runCombat({
            // Focus player at M4, fires 'front' (enemy-front at M4 → anchor).
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            // Active slot fires damage + two debuffs onto the targeted enemy (enemy-front).
            shipSkills: { slots: [damageWithTwoDebuffsSlot()] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 1,
            selfBuffs: [],
            // No scheduled enemy debuffs — all debuffs are ability-sourced (per-victim via targetId).
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
            // Healing mode: required to unlock the positioned enemy roster.
            healTargetId: 'attacker',
            position: 'M4',
            // Focus fires at 'front' → anchor is enemy-front at M4.
            target: parsedTarget('front'),
            // Line-range-3 covers M4 (origin) through M1 (covered at -3 steps):
            // hits enemy-front (M4, roleScale=1.0) AND enemy-back (M1, roleScale=0.5).
            pattern: lineRange3Pattern(),
            // Two enemies: front (M4, origin) and back (M1, covered).
            enemyAttackers: [
                passiveEnemyAt('enemy-front', 'M4'),
                passiveEnemyAt('enemy-back', 'M1'),
            ],
        });

        const round0 = result.rounds[0];
        expect(round0.perTargetDamage).toBeDefined();
        const ptd = round0.perTargetDamage!;

        // EXACT values pinned from victimHitDamage — both defense-down AND incoming-damage
        // modifiers must be sourced per-victim for these to match.
        expect(ptd['enemy-front']).toBeCloseTo(EXPECTED_FRONT, 10);
        expect(ptd['enemy-back']).toBeCloseTo(EXPECTED_BACK, 10);

        // Relative ordering: front has lower effective defense AND incoming boost → more damage
        // despite same attack stats (the roleScale difference alone would make front > back, but
        // the defense + incoming modifiers further separate them).
        expect(ptd['enemy-front']).toBeGreaterThan(ptd['enemy-back']);
    });
});
