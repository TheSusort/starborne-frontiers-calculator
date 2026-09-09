import { describe, it, expect } from 'vitest';
import {
    getAffinityMatchup,
    computeAffinityModifiers,
    affinityScaledHacking,
} from '../affinityUtils';

describe('getAffinityMatchup', () => {
    it('thermal has advantage over chemical', () => {
        expect(getAffinityMatchup('thermal', 'chemical')).toBe('advantage');
    });
    it('thermal has disadvantage against electric', () => {
        expect(getAffinityMatchup('thermal', 'electric')).toBe('disadvantage');
    });
    it('thermal vs thermal is neutral', () => {
        expect(getAffinityMatchup('thermal', 'thermal')).toBe('neutral');
    });
    it('chemical has advantage over electric', () => {
        expect(getAffinityMatchup('chemical', 'electric')).toBe('advantage');
    });
    it('chemical has disadvantage against thermal', () => {
        expect(getAffinityMatchup('chemical', 'thermal')).toBe('disadvantage');
    });
    it('chemical vs chemical is neutral', () => {
        expect(getAffinityMatchup('chemical', 'chemical')).toBe('neutral');
    });
    it('electric has advantage over thermal', () => {
        expect(getAffinityMatchup('electric', 'thermal')).toBe('advantage');
    });
    it('electric has disadvantage against chemical', () => {
        expect(getAffinityMatchup('electric', 'chemical')).toBe('disadvantage');
    });
    it('electric vs electric is neutral', () => {
        expect(getAffinityMatchup('electric', 'electric')).toBe('neutral');
    });
    it('antimatter attacker is always neutral', () => {
        expect(getAffinityMatchup('antimatter', 'thermal')).toBe('neutral');
        expect(getAffinityMatchup('antimatter', 'chemical')).toBe('neutral');
        expect(getAffinityMatchup('antimatter', 'electric')).toBe('neutral');
        expect(getAffinityMatchup('antimatter', 'antimatter')).toBe('neutral');
    });
    it('antimatter enemy is always neutral', () => {
        expect(getAffinityMatchup('thermal', 'antimatter')).toBe('neutral');
        expect(getAffinityMatchup('chemical', 'antimatter')).toBe('neutral');
        expect(getAffinityMatchup('electric', 'antimatter')).toBe('neutral');
    });
    it('undefined attacker is neutral', () => {
        expect(getAffinityMatchup(undefined, 'thermal')).toBe('neutral');
        expect(getAffinityMatchup(undefined, 'antimatter')).toBe('neutral');
    });
    it('undefined enemy is neutral', () => {
        expect(getAffinityMatchup('thermal', undefined)).toBe('neutral');
    });
});

describe('computeAffinityModifiers', () => {
    it('returns advantage modifiers', () => {
        const result = computeAffinityModifiers('thermal', 'chemical');
        expect(result).toEqual({ damageModifier: 25, critCap: 100, critPenalty: 0 });
    });
    it('returns disadvantage modifiers', () => {
        const result = computeAffinityModifiers('thermal', 'electric');
        expect(result).toEqual({ damageModifier: -25, critCap: 75, critPenalty: 25 });
    });
    it('returns neutral modifiers for same affinity', () => {
        const result = computeAffinityModifiers('thermal', 'thermal');
        expect(result).toEqual({ damageModifier: 0, critCap: 100, critPenalty: 0 });
    });
    it('returns neutral modifiers when attacker is antimatter', () => {
        const result = computeAffinityModifiers('antimatter', 'thermal');
        expect(result).toEqual({ damageModifier: 0, critCap: 100, critPenalty: 0 });
    });
    it('returns neutral modifiers when enemy is antimatter', () => {
        const result = computeAffinityModifiers('thermal', 'antimatter');
        expect(result).toEqual({ damageModifier: 0, critCap: 100, critPenalty: 0 });
    });
    it('returns neutral modifiers when attacker is undefined', () => {
        const result = computeAffinityModifiers(undefined, 'thermal');
        expect(result).toEqual({ damageModifier: 0, critCap: 100, critPenalty: 0 });
    });
});

describe('affinityScaledHacking', () => {
    it('raises hacking by the advantage modifier', () => {
        expect(affinityScaledHacking(200, 25)).toBe(250);
    });

    it('lowers hacking by the disadvantage modifier', () => {
        expect(affinityScaledHacking(200, -25)).toBe(150);
    });

    it('leaves hacking untouched at a neutral matchup', () => {
        expect(affinityScaledHacking(200, 0)).toBe(200);
    });

    it('scales the buffed total it is handed, not a base — the caller folds buffs first', () => {
        expect(affinityScaledHacking(200 + 40, 25)).toBe(300);
    });

    it("reads computeAffinityModifiers' one modifier for the hacking clause too", () => {
        // The contract this function exists to make findable: the game applies the SAME +-25% to
        // the damage clause and the hacking clause, so the hacking side is fed damageModifier.
        const advantage = computeAffinityModifiers('thermal', 'chemical');
        const disadvantage = computeAffinityModifiers('thermal', 'electric');
        expect(affinityScaledHacking(200, advantage.damageModifier)).toBe(250);
        expect(affinityScaledHacking(200, disadvantage.damageModifier)).toBe(150);
    });
});
