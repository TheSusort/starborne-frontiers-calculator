import { ShipSkills } from '../../types/abilities';
import { SelectedGameBuff, EnemyBaseClass } from '../../types/calculator';
import { buffAbilitiesToSelectedBuffs, buildStaticBuffContext } from './buffAbilityConverters';

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

// Single seam for the page (memoize on shipSkills + enemyType). Converts buff/debuff
// abilities → SelectedGameBuff[]. NOTE: sourceChargeCount/sourceStartCharged are not
// reconstructed (not on the buff config) — correct for single-attacker DPS, where the
// timeline falls back to the attacker's own charged set; team debuffs flow through the
// unchanged global teamEnemyDebuffs path.
export function configShipSkillsToSimInputs(
    shipSkills: ShipSkills,
    enemyType?: EnemyBaseClass
): { selfBuffs: SelectedGameBuff[]; enemyDebuffs: SelectedGameBuff[] } {
    return buffAbilitiesToSelectedBuffs(shipSkills, buildStaticBuffContext({ enemyType }));
}
