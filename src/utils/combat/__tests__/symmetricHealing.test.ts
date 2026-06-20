import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

// ---------------------------------------------------------------------------
// E5 §4.1: Symmetric enemy healing (the core). An ENEMY healer takes damage from
// the player focus, then self-heals into its OWN currentHp via the per-victim
// pool. Roles are INVERTED vs nayraRepairedPurge.test.ts: the player focus just
// attacks; the enemy ship does the healing.
//
// Two assertions:
//   1. The enemy healer's currentHp recovers (was HP-restore-blocked before E5).
//   2. The player healing result does NOT contain the enemy id (no player-bucket
//      credit / surface leak on the enemy path).
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `e5_${++idc}`,
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
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const hit = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });
const FOCUS_ID = 'attacker';
const selfHeal = (): Ability =>
    ab({ type: 'heal', target: 'self', config: { type: 'heal', pct: 2, basis: 'target-hp' } });
const enemyHealer = () => ({
    id: 'enemy-healer',
    stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 100 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4' as Position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active' as const, abilities: [selfHeal(), hit()] }] },
});
const focusSkills = (): ShipSkills => ({ slots: [{ slot: 'active', abilities: [hit()] }] });
const BASE = (): CombatEngineInput => ({
    attack: 50_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: focusSkills(),
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
    hp: 1_000_000,
    speed: 300,
    healTargetId: FOCUS_ID,
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: [enemyHealer()],
});

describe('E5 §4.1: enemy heals restore enemy HP into its own pool', () => {
    it('enemy healer recovers HP after taking damage', () => {
        idc = 0;
        let healer: CombatActor | undefined;
        runCombat({
            ...BASE(),
            __testTapActors: (actors) => {
                healer = actors.find((a) => a.id === 'enemy-healer');
            },
        });
        expect(healer).toBeDefined();
        // Per-round (player speed 300 acts first, enemy speed 100 last):
        //   hit −50,000 (attack 50k, defence 0, ×1.0 multiplier), then self-heal
        //   +20,000 (2% of the 1,000,000 max-HP basis). Net −30,000/round over 3 rounds.
        //   Without E5 the floor would be 1,000,000 − 3×50,000 = 850,000 (no restore).
        // Non-vacuous: above the no-heal floor (heals landed) AND below max (damage landed).
        expect(healer!.currentHp).toBe(910_000);
        expect(healer!.currentHp).toBeGreaterThan(850_000);
        expect(healer!.currentHp).toBeLessThan(1_000_000);
    });

    it('enemy heal does NOT pollute the player healing result', () => {
        idc = 0;
        const result = runCombat(BASE());
        // Scope to the HEALING surface: the player focus attacks the enemy healer, so the
        // enemy id legitimately appears in the DAMAGE perTargetDamage — that's not pollution.
        // The enemy heal must contribute NOTHING to the player healing buckets (no credit).
        expect(JSON.stringify(result.healing)).not.toContain('enemy-healer');
    });
});
