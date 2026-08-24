/**
 * Sub-project I, PR I5 — Selenite-shape "10% more direct damage for every enemy with
 * Stealth" count-scaling, combat-engine integration.
 *
 * `enemyBuffNames` is a DEDUPED UNION of buff names across every opposing actor — it can
 * only answer "is at least one enemy Stealthed", never "how many". This suite locks the
 * dedicated live count (`ConditionContext.stealthedEnemyCount`, sourced in `engine.ts` via
 * `countOwnersWithSelfBuff` and threaded through `buildTurnArgs` → `runPlayerTurn` →
 * `modifierCtx`) that lets a count-scaling modifier (`enemy-stealth-count` subject,
 * `scaling.perUnit`) tell 1 stealthed enemy from N.
 *
 * The focus attacker is made SLOW (speed 1) and both enemy attackers FAST (speed 100) so
 * the enemies' own self-cast Stealth grants land BEFORE the focus's turn is built within the
 * same round — no multi-round dance needed (mirrors teamAuraDistribution's `stealthSelfBuff`
 * pattern, applied here on the OPPOSING side instead of an ally).
 *
 * Damage is read off the `ability-performed` bus event for the focus actor ('attacker'), NOT
 * `perTargetDamage` — the engine's positional targeting deliberately treats a Stealthed enemy
 * as untargetable (positionalBinding.ts's stealth filter), so which enemy the attack actually
 * LANDS on shifts once an enemy is Stealthed. Reading the attacker's own emitted damage sidesteps
 * that entirely and proves the point directly: this is a GLOBAL count modifier on the CASTER's
 * own attack, not a per-victim gate (spec §5.4: "no team distribution, no per-victim").
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sec${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A self-cast Stealth grant (mirrors teamAuraDistribution.integration.test.ts's
// stealthSelfBuff — applied here on an ENEMY attacker rather than an ally).
const stealthSelfBuff = (id: string): Ability =>
    ab({
        id,
        type: 'buff',
        target: 'self',
        config: {
            type: 'buff',
            buffName: 'Stealth',
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            duration: 99,
        },
    });

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Fast (speed 100) enemy attacker so it acts BEFORE the (slow, speed 1) focus attacker
// within round 1. `abilities` is either empty (plain) or carries stealthSelfBuff (stealthed).
const enemyAt = (id: string, position: Position, abilities: Ability[]): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 100,
        security: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities }] },
});

// Selenite-shape passive: self-scoped outgoing-damage modifier scaling 10% per stealthed
// enemy, uncapped (the CSV text states no maximum).
const seleniteStealthCountModifier = (): Ability =>
    ab({
        target: 'self',
        type: 'modifier',
        conditions: [{ subject: 'enemy-stealth-count', derivable: true }],
        config: {
            type: 'modifier',
            channel: 'outgoingDamage',
            value: 0,
            isMultiplicative: true,
        },
        scaling: { conditionIndex: 0, perUnit: 10 },
    });

const skills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                seleniteStealthCountModifier(),
            ],
        },
    ],
});

const engineBase = (enemyAttackers: EnemyAttacker[]): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: skills(),
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
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    // Slow focus attacker: both enemy attackers (speed 100) act first each round, so a
    // self-cast Stealth grant from an enemy's OWN turn is already live when this actor's
    // turn is built (no multi-round dance needed, unlike the enemy-inflicted-debuff shapes).
    speed: 1,
    enemyAttackers,
});

// Focus actor's own emitted 'ability-performed' damage — target-agnostic, so it is unaffected
// by the engine's Stealth-untargetable positional filter (positionalBinding.ts).
const focusDamage = (input: CombatEngineInput): number => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('ability-performed', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    const hit = events.find((e) => e.type === 'ability-performed' && e.actorId === 'attacker');
    return hit && hit.type === 'ability-performed' ? (hit.damage ?? 0) : NaN;
};

describe('enemy-stealth-count scaling (sub-project I, PR I5) — engine integration', () => {
    it('no enemy is Stealthed → base damage (0 × 10% = 0)', () => {
        idc = 0;
        const damage = focusDamage(
            engineBase([enemyAt('front', 'M4', []), enemyAt('covered', 'M3', [])])
        );
        expect(damage).toBe(10_000); // 10000 * 1.00
    });

    it('exactly ONE stealthed enemy → +10%', () => {
        idc = 0;
        const damage = focusDamage(
            engineBase([
                enemyAt('front', 'M4', [stealthSelfBuff('front-stealth')]),
                enemyAt('covered', 'M3', []),
            ])
        );
        expect(damage).toBe(11_000); // 10000 * 1.10
    });

    it('TWO stealthed enemies → +20% (proves COUNT, not a binary union gate)', () => {
        idc = 0;
        const damage = focusDamage(
            engineBase([
                enemyAt('front', 'M4', [stealthSelfBuff('front-stealth')]),
                enemyAt('covered', 'M3', [stealthSelfBuff('covered-stealth')]),
            ])
        );
        // A deduped `enemyBuffNames` union would read the SAME (1 for "Stealth present") for
        // both 1-stealthed and 2-stealthed cases; the dedicated count tells them apart: +20%.
        expect(damage).toBe(12_000); // 10000 * 1.20
    });
});
