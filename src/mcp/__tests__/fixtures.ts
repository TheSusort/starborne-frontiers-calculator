import type { McpToolContext, McpTool } from '../types';
import { stubDb } from '../../__tests__/services/stubDb';

export const AUTH_USER = '11111111-1111-4111-8111-111111111111';
export const ALT_PROFILE = '22222222-2222-4222-8222-222222222222';
export const STRANGER = '33333333-3333-4333-8333-333333333333';

/** A `ship_templates` row as `select('*')` returns it. */
export const templateRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'tpl-1',
    name: 'Atlas',
    rarity: 'LEGENDARY',
    faction: 'ATLAS_SYNDICATE',
    type: 'ATTACKER',
    affinity: 'thermal',
    image_key: 'atlas',
    active_skill_text: 'This Unit deals <unit-damage>180% damage</unit-damage>',
    charge_skill_text: 'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns',
    charge_skill_charge: 3,
    first_passive_skill_text: 'This Unit gains <unit-skill>Attack Up I</unit-skill> for 1 turn',
    second_passive_skill_text: 'This Unit gains <unit-skill>Attack Up II</unit-skill> for 1 turn',
    third_passive_skill_text: 'This Unit gains <unit-skill>Attack Up III</unit-skill> for 1 turn',
    base_stats: {
        hp: 10000,
        attack: 3000,
        defence: 1500,
        hacking: 100,
        security: 50,
        crit_rate: 10,
        crit_damage: 50,
        speed: 100,
        shield: 0,
        shield_penetration: 0,
        defense_penetration: 0,
    },
    ...overrides,
});

/** A context over `tables`, reading as `AUTH_USER`. */
export const ctxOver = (tables: Record<string, Record<string, unknown>[]>, options = {}) => {
    const { db, calls } = stubDb(tables, options);
    const ctx: McpToolContext = { db, authUserId: AUTH_USER };
    return { ctx, calls };
};

/** Runs `tool` the way the SDK does: parse the raw arguments with its `input`, then `run`. */
export const call = <I>(tool: McpTool<I>, raw: unknown, ctx: McpToolContext) =>
    tool.run(tool.input.parse(raw), ctx);
