import { describe, it, expect } from 'vitest';
import { matchesRule, getMatchingModifiers, applyArenaModifiers } from '../arenaModifiers';
import { ArenaSeasonRule } from '../../../types/arena';
import { BaseStats } from '../../../types/stats';

const baseStats: BaseStats = {
    hp: 50000,
    attack: 10000,
    defence: 8000,
    speed: 300,
    hacking: 5000,
    security: 3000,
    crit: 50,
    critDamage: 150,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    damageReduction: 0,
    defensePenetration: 0,
};

const makeRule = (overrides: Partial<ArenaSeasonRule> = {}): ArenaSeasonRule => ({
    id: 'rule-1',
    season_id: 'season-1',
    factions: null,
    rarities: null,
    ship_types: null,
    modifiers: { hp: 150 },
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
});

describe('matchesRule', () => {
    it('matches when all filters are null (applies to all ships)', () => {
        const rule = makeRule();
        expect(matchesRule(rule, 'ATLAS_SYNDICATE', 'epic', 'ATTACKER')).toBe(true);
    });

    it('matches when all filters are empty arrays', () => {
        const rule = makeRule({ factions: [], rarities: [], ship_types: [] });
        expect(matchesRule(rule, 'XAOC', 'legendary', 'DEFENDER')).toBe(true);
    });

    it('matches when ship faction is in factions array', () => {
        const rule = makeRule({ factions: ['ATLAS_SYNDICATE', 'XAOC'] });
        expect(matchesRule(rule, 'ATLAS_SYNDICATE', 'epic', 'ATTACKER')).toBe(true);
    });

    it('does not match when ship faction is not in factions array', () => {
        const rule = makeRule({ factions: ['XAOC'] });
        expect(matchesRule(rule, 'ATLAS_SYNDICATE', 'epic', 'ATTACKER')).toBe(false);
    });

    it('matches when ship rarity is in rarities array', () => {
        const rule = makeRule({ rarities: ['epic', 'legendary'] });
        expect(matchesRule(rule, 'XAOC', 'epic', 'ATTACKER')).toBe(true);
    });

    it('does not match when ship rarity is not in rarities array', () => {
        const rule = makeRule({ rarities: ['legendary'] });
        expect(matchesRule(rule, 'XAOC', 'epic', 'ATTACKER')).toBe(false);
    });

    it('matches when ship role is in ship_types array', () => {
        const rule = makeRule({ ship_types: ['DEFENDER', 'ATTACKER'] });
        expect(matchesRule(rule, 'XAOC', 'epic', 'ATTACKER')).toBe(true);
    });

    it('does not match when ship role is not in ship_types array', () => {
        const rule = makeRule({ ship_types: ['DEFENDER'] });
        expect(matchesRule(rule, 'XAOC', 'epic', 'ATTACKER')).toBe(false);
    });

    it('requires ALL filters to match (AND logic)', () => {
        const rule = makeRule({
            factions: ['XAOC'],
            rarities: ['epic'],
            ship_types: ['DEFENDER'],
        });
        expect(matchesRule(rule, 'XAOC', 'epic', 'ATTACKER')).toBe(false);
        expect(matchesRule(rule, 'XAOC', 'epic', 'DEFENDER')).toBe(true);
    });
});

describe('getMatchingModifiers', () => {
    it('returns empty object when no rules match', () => {
        const rules = [makeRule({ factions: ['XAOC'] })];
        expect(getMatchingModifiers(rules, 'ATLAS_SYNDICATE', 'epic', 'ATTACKER')).toEqual({});
    });

    it('returns modifiers from a single matching rule', () => {
        const rules = [makeRule({ modifiers: { hp: 150, defence: 100 } })];
        expect(getMatchingModifiers(rules, 'XAOC', 'epic', 'ATTACKER')).toEqual({
            hp: 150,
            defence: 100,
        });
    });

    it('sums modifiers from multiple matching rules', () => {
        const rules = [
            makeRule({ modifiers: { hp: 50 } }),
            makeRule({ id: 'rule-2', modifiers: { hp: 100, defence: 100 } }),
        ];
        expect(getMatchingModifiers(rules, 'XAOC', 'epic', 'ATTACKER')).toEqual({
            hp: 150,
            defence: 100,
        });
    });

    it('excludes non-matching rules from sum', () => {
        const rules = [
            makeRule({ modifiers: { hp: 50 } }),
            makeRule({ id: 'rule-2', factions: ['XAOC'], modifiers: { hp: 100 } }),
        ];
        expect(getMatchingModifiers(rules, 'ATLAS_SYNDICATE', 'epic', 'ATTACKER')).toEqual({
            hp: 50,
        });
    });

    it('returns empty object for empty rules array', () => {
        expect(getMatchingModifiers([], 'XAOC', 'epic', 'ATTACKER')).toEqual({});
    });
});

describe('applyArenaModifiers', () => {
    it('returns stats unchanged when modifiers are empty', () => {
        const result = applyArenaModifiers(baseStats, {});
        expect(result).toEqual(baseStats);
    });

    it('applies positive percentage modifier: stat * (1 + mod/100)', () => {
        const result = applyArenaModifiers(baseStats, { hp: 150 });
        expect(result.hp).toBe(125000);
        expect(result.attack).toBe(10000);
        expect(result.defence).toBe(8000);
    });

    it('applies negative percentage modifier', () => {
        const result = applyArenaModifiers(baseStats, { speed: -30 });
        expect(result.speed).toBe(210);
    });

    it('applies multiple modifiers simultaneously', () => {
        const result = applyArenaModifiers(baseStats, { hp: 150, defence: 100 });
        expect(result.hp).toBe(125000);
        expect(result.defence).toBe(16000);
        expect(result.attack).toBe(10000);
    });

    it('does not modify stats with zero modifier', () => {
        const result = applyArenaModifiers(baseStats, { hp: 0 });
        expect(result.hp).toBe(50000);
    });
});
