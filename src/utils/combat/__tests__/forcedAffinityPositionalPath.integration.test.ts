/**
 * SP-F F4 — forced-affinity override on the REAL positional apply path.
 *
 * The `forcedAffinityOverride.test.ts` suite drives `runPlayerTurn` directly with
 * `deferAbilityPerformedToEngine: false` — it proves the AGGREGATE math but NOT the production
 * path. `simulateBattle` / `runCombat` resolve a positioned cast POSITIONALLY: the engine emits
 * NO aggregate `ability-performed` and instead re-derives each victim's damage via
 * `victimHitDamage` (engine.ts `drivePositionalApply`). `victimHitDamage` recomputes affinity from
 * the RAW `attackerAffinity` vs each victim's affinity — so a forced-affinity override MUST be
 * plumbed onto that path explicitly, or it is silently lost in production (the exact F5-shape gap).
 *
 * These regressions run a real positioned `runCombat` and observe the ANCHOR enemy's HP drop:
 *   - Wusheng offensive: the damage ability's `forceAffinityAdvantage` flag lifts a REAL affinity
 *     DISADVANTAGE to ADVANTAGE (+25% instead of −25%).
 *   - Isha/Nayra defensive: a victim carrying 'Defensive Affinity Override' forces a REAL-advantage
 *     attacker to DISADVANTAGE against it (−25% instead of +25%).
 * Ratios (not absolute damage) are asserted so per-hit roleScale / attack / multiplier cancel.
 *
 * BEFORE the positional-path fix both flagged/buffed runs equalled their control (override dropped
 * at `victimHitDamage`) → every ratio assertion below fails.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { AffinityName } from '../../../types/ship';
import { getAffinityMatchup } from '../../calculators/affinityUtils';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `fap${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const allPattern = (): ParsedPattern => ({
    raw: 'all',
    shape: 'all',
    range: 'all',
    modifiers: {},
});

const hit = (forceAffinityAdvantage = false): Ability =>
    ab({
        type: 'damage',
        target: 'enemy',
        config: {
            type: 'damage',
            multiplier: 100,
            ...(forceAffinityAdvantage ? { forceAffinityAdvantage: true } : {}),
        },
    });

/** A named self-buff (no stat effects) the enemy grants itself on its own turn. */
const selfBuff = (name: string): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        config: {
            type: 'buff',
            buffName: name,
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            duration: 99,
        },
    });

/** A positioned enemy anchor. `slotAbilities` lets a test prepend a self-buff before its hit.
 *  Speed 200 > the focus's 100 so it acts (and self-buffs) FIRST — required for the victim-side
 *  Defensive Override to be live when the focus attacks it this same round. */
const anchorEnemy = (affinity: AffinityName, slotAbilities: Ability[]) => ({
    id: 'anchor',
    affinity,
    stats: { attack: 500, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4' as const,
    target: parsedTarget(),
    pattern: allPattern(),
    shipSkills: { slots: [{ slot: 'active' as const, abilities: slotAbilities }] } as ShipSkills,
});

const BASE = (
    focusAffinity: AffinityName,
    focusHit: Ability,
    enemyAffinity: AffinityName,
    enemySlot: Ability[]
): CombatEngineInput => ({
    attack: 1000,
    crit: 0, // deterministic — no crit variance
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    affinity: focusAffinity,
    shipSkills: { slots: [{ slot: 'active', abilities: [focusHit] }] },
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
    speed: 100,
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget(),
    pattern: allPattern(),
    enemyAttackers: [anchorEnemy(enemyAffinity, enemySlot)],
});

const anchorHpDrop = (input: CombatEngineInput): number => {
    let captured: CombatActor[] = [];
    runCombat({ ...input, __testTapActors: (actors) => (captured = actors) });
    const a = captured.find((x) => x.id === 'anchor');
    if (!a) throw new Error('no anchor in tapped roster');
    return 1_000_000_000 - a.currentHp;
};

describe('SP-F F4 — forced-affinity override on the positional apply path', () => {
    // Guard the affinity ring the ratios below depend on.
    it('affinity directions hold (chemical disadvantaged vs thermal, advantaged vs electric)', () => {
        expect(getAffinityMatchup('chemical', 'thermal')).toBe('disadvantage');
        expect(getAffinityMatchup('chemical', 'electric')).toBe('advantage');
    });

    it('Wusheng offensive flag: forces ADVANTAGE at a real disadvantage (chemical vs thermal)', () => {
        idc = 0;
        const neutral = anchorHpDrop(BASE('chemical', hit(), 'chemical', [hit()]));
        idc = 0;
        const disNoFlag = anchorHpDrop(BASE('chemical', hit(), 'thermal', [hit()]));
        idc = 0;
        const disFlag = anchorHpDrop(BASE('chemical', hit(true), 'thermal', [hit()]));

        // Control: real disadvantage lands −25%.
        expect(disNoFlag / neutral).toBeCloseTo(0.75, 5);
        // Fixed: the flag lifts the SAME real disadvantage to +25% (was === disNoFlag before fix).
        expect(disFlag / neutral).toBeCloseTo(1.25, 5);
        expect(disFlag / disNoFlag).toBeCloseTo(1.25 / 0.75, 5);
    });

    it("Isha/Nayra defensive: victim's Defensive Affinity Override forces the attacker to DISADVANTAGE", () => {
        // Focus chemical vs enemy electric → real ADVANTAGE for the focus.
        idc = 0;
        const advNoBuff = anchorHpDrop(BASE('chemical', hit(), 'electric', [hit()]));
        idc = 0;
        const advWithBuff = anchorHpDrop(
            BASE('chemical', hit(), 'electric', [selfBuff('Defensive Affinity Override'), hit()])
        );

        // The buff on the victim forces the focus from +25% down to −25% (was === advNoBuff before fix).
        expect(advWithBuff / advNoBuff).toBeCloseTo(0.75 / 1.25, 5);
    });
});
