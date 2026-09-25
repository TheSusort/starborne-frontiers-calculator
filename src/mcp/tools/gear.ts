import { z } from 'zod';
import { GEAR_SETS } from '../../constants/gearSets';
import { IMPLANTS, type ImplantData } from '../../constants/implants';
import type { GearSetBonus } from '../../types/gear';
import type { McpTool } from '../types';

const listGearSetsInput = z.object({});

export const listGearSets: McpTool<z.output<typeof listGearSetsInput>> = {
    name: 'list_gear_sets',
    description:
        'Every gear set: its id (the value gear carries), name, the stats it grants, pieces needed and any special effect.',
    input: listGearSetsInput,
    run: async () => ({
        gearSets: Object.entries(GEAR_SETS).map(([id, set]: [string, GearSetBonus]) => ({
            id,
            name: set.name,
            stats: set.stats,
            ...(set.minPieces !== undefined && { minPieces: set.minPieces }),
            ...(set.description !== undefined && { description: set.description }),
        })),
    }),
};

const listImplantsInput = z.object({
    query: z.string().trim().min(1).optional().describe('Part of the implant name, any case.'),
});

export const listImplants: McpTool<z.output<typeof listImplantsInput>> = {
    name: 'list_implants',
    description:
        'Implants, optionally filtered by name: type (major, minor slot, ultimate) and each rarity variant’s stats and effect text.',
    input: listImplantsInput,
    run: async ({ query }) => {
        const q = query?.toLowerCase();
        return {
            implants: Object.entries(IMPLANTS)
                .filter(([, implant]) => !q || implant.name.toLowerCase().includes(q))
                .map(([id, implant]: [string, ImplantData]) => ({
                    id,
                    name: implant.name,
                    type: implant.type,
                    variants: implant.variants.map((variant) => ({
                        rarity: variant.rarity,
                        stats: variant.stats ?? [],
                        ...(variant.description !== undefined && {
                            description: variant.description,
                        }),
                    })),
                })),
        };
    },
};
