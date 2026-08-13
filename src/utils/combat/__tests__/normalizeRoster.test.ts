import { describe, it, expect } from 'vitest';
import { normalizeCombatRoster } from '../normalizeRoster';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../../calculators/dpsEnemyPlacement';
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
