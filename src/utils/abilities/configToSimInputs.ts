import { ShipSkills } from '../../types/abilities';

// Blank-ship default: one active slot with a single damage ability (multiplier 100),
// mirroring the old `activeMultiplier: 100, chargedMultiplier: 0` default. No charged slot.
export function buildDefaultShipSkills(): ShipSkills {
    return {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'default-active-damage',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    };
}

// Truly-empty kit (no abilities) for a buff-only team actor walked through runCombat: zero
// damage, no skill-sourced buffs — only the actor's manual selfBuffs/enemyDebuffs apply (via
// teamSources + sourceFired). Distinct from buildDefaultShipSkills, which carries a damage ability.
export function buildEmptyShipSkills(): ShipSkills {
    return { slots: [] };
}
