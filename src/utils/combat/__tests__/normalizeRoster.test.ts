import { describe, it, expect } from 'vitest';
import { normalizeCombatRoster } from '../normalizeRoster';
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
    DEFAULT_FRONT_ENEMY_TARGET,
    DEFAULT_BASE_PATTERN,
} from '../../calculators/dpsEnemyPlacement';
import type { CombatEngineInput } from '../engine';

/** Minimal valid engine input. Fields the boundary never reads are set to inert values. */
const baseInput = (over: Partial<CombatEngineInput> = {}): CombatEngineInput =>
    ({
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
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
        hp: 100_000,
        ...over,
    }) as CombatEngineInput;

const enemyInput = (id: string, position?: string) => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, speed: 10 },
    chargeCount: 0,
    startCharged: false,
    ...(position ? { position: position as never } : {}),
});

describe('normalizeCombatRoster — auto-placement', () => {
    it('places a position-less focus attacker on DEFAULT_ATTACKER_SLOT', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.position).toBe(DEFAULT_ATTACKER_SLOT);
    });

    it('places a position-less first enemy on DEFAULT_ENEMY_SLOT', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers?.[0].position).toBe(DEFAULT_ENEMY_SLOT);
    });

    it('walks later enemies back instead of stacking them on the anchor', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [enemyInput('e1'), enemyInput('e2'), enemyInput('e3')] })
        );
        const slots = out.enemyAttackers!.map((e) => e.position);
        expect(new Set(slots).size).toBe(3);
        expect(slots[0]).toBe(DEFAULT_ENEMY_SLOT);
    });

    it('does NOT move an explicitly-positioned actor', () => {
        const out = normalizeCombatRoster(
            baseInput({
                position: 'B1' as never,
                enemyAttackers: [enemyInput('e1', 'T2')],
            })
        );
        expect(out.position).toBe('B1');
        expect(out.enemyAttackers?.[0].position).toBe('T2');
    });

    it('places team actors without colliding with the focus', () => {
        const out = normalizeCombatRoster(
            baseInput({
                enemyAttackers: [enemyInput('e1')],
                teamActors: [{ id: 't1' }, { id: 't2' }] as never,
            })
        );
        const playerSlots = [out.position, ...out.teamActors!.map((t) => t.position)];
        expect(new Set(playerSlots).size).toBe(3);
    });

    it('keeps the two sides on independent boards (both may anchor on M4)', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.position).toBe('M4');
        expect(out.enemyAttackers?.[0].position).toBe('M4');
    });

    it('leaves an empty enemy roster empty — it never invents an enemy', () => {
        const out = normalizeCombatRoster(baseInput());
        expect(out.enemyAttackers ?? []).toEqual([]);
    });

    it('is a pure function — the caller’s input object is not mutated', () => {
        const input = baseInput({ enemyAttackers: [enemyInput('e1')] });
        normalizeCombatRoster(input);
        expect(input.position).toBeUndefined();
        expect(input.enemyAttackers?.[0].position).toBeUndefined();
    });

    it('walks enemies back in defaultEnemySlot order, not collision-resolver order', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [enemyInput('e1'), enemyInput('e2'), enemyInput('e3')] })
        );
        // defaultEnemySlot order is ['M4','T4','B4',...]; index 0 takes the anchor.
        expect(out.enemyAttackers!.map((e) => e.position)).toEqual(['M4', 'T4', 'B4']);
    });
});

describe('normalizeCombatRoster — targeting synthesis', () => {
    it('gives a target-less focus the front-enemy default and the base pattern', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.target).toEqual(DEFAULT_FRONT_ENEMY_TARGET);
        expect(out.pattern).toEqual(DEFAULT_BASE_PATTERN);
    });

    it('gives target-less enemies the same defaults (side is relative to the actor)', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers?.[0].target).toEqual(DEFAULT_FRONT_ENEMY_TARGET);
        expect(out.enemyAttackers?.[0].pattern).toEqual(DEFAULT_BASE_PATTERN);
    });

    it('synthesizes a pattern with range 0 — "base|1|" has no offset table and throws', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.pattern?.range).toBe(0);
    });

    it('NEVER substitutes a target the caller supplied, including an ally-side one', () => {
        const allySide = { raw: 'lowest hp ally', side: 'ally', selection: 'lowest-hp' } as never;
        const out = normalizeCombatRoster(
            baseInput({ target: allySide, enemyAttackers: [enemyInput('e1')] })
        );
        // Substituting here is the healing ADAPTER's policy, not the boundary's. A battle-sim
        // support ship must keep targeting allies.
        expect(out.target).toBe(allySide);
    });

    it('NEVER synthesizes the charged axes — undefined there means "reuse the active axis"', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers?.[0].chargedTarget).toBeUndefined();
        expect(out.enemyAttackers?.[0].chargedPattern).toBeUndefined();
    });

    it('fills a missing pattern even when the target was supplied, and vice versa', () => {
        const explicitTarget = { raw: 'back enemy', side: 'enemy', selection: 'back' } as never;
        const out = normalizeCombatRoster(
            baseInput({ target: explicitTarget, enemyAttackers: [enemyInput('e1')] })
        );
        // Both axes are independently required for a positional cast, and a missing PATTERN fails
        // silently — perTargetDealt comes back empty while the damage number looks plausible.
        expect(out.target).toBe(explicitTarget);
        expect(out.pattern).toEqual(DEFAULT_BASE_PATTERN);
    });

    it('gives target-less team actors the defaults too', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [enemyInput('e1')], teamActors: [{ id: 't1' }] as never })
        );
        expect(out.teamActors?.[0].target).toEqual(DEFAULT_FRONT_ENEMY_TARGET);
        expect(out.teamActors?.[0].pattern).toEqual(DEFAULT_BASE_PATTERN);
    });
});
