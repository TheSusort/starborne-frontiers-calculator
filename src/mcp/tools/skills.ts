import { z } from 'zod';
import type { Ship } from '../../types/ship';
import { getShipSkillRows } from '../../utils/ship/skillRows';
import { parseAllSkillEffects } from '../../utils/skillTextParser';
import type { McpTool } from '../types';
import { findShipTemplate } from './ships';

const getShipSkillsInput = z.object({
    name: z.string().trim().min(1).describe('The exact ship name, any case.'),
    refits: z
        .union([z.literal(0), z.literal(2), z.literal(4)])
        .default(0)
        .describe('Refit count; picks which passive is active (0 = base, 2 = R2, 4 = R4).'),
});

/** A template ship carrying `count` refits, so `getShipSkillRows` resolves the passive a ship at
 *  that refit level has. Refit stats do not affect skill resolution, so the refits are empty. */
const withRefits = (ship: Ship, count: number): Ship => ({
    ...ship,
    refits: Array.from({ length: count }, (_, i) => ({ id: `refit-${i + 1}`, stats: [] })),
});

export const getShipSkills: McpTool<z.output<typeof getShipSkillsInput>> = {
    name: 'get_ship_skills',
    description:
        'Skill text for a ship: active, charged, and the passive active at the given refit count, plus the buffs and debuffs the planner parses from that text.',
    input: getShipSkillsInput,
    run: async ({ name, refits }, { db }) => {
        const ship = withRefits(await findShipTemplate(db, name), refits);
        return {
            name: ship.name,
            refits,
            skills: getShipSkillRows(ship).map(({ label, text, charge }) => ({
                label,
                text,
                ...(charge !== undefined && { charge }),
            })),
            effects: parseAllSkillEffects(ship).map((effect) => ({
                buffName: effect.buffName,
                target: effect.target,
                duration: effect.duration,
                source: effect.source,
                ...(effect.stacks !== undefined && { stacks: effect.stacks }),
                ...(effect.application !== undefined && { application: effect.application }),
            })),
        };
    },
};
