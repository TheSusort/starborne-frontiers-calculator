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

// Single seam for the page preview (memoize on shipSkills + enemyType). Converts buff/
// debuff abilities → SelectedGameBuff[] for display-only purposes (the merged attacker
// buff totals panel). The sim no longer uses this output — buff/debuff abilities are read
// from shipSkills directly by the combat engine (src/utils/combat/engine.ts), which
// applies them in-loop with dynamic condition gating. NOTE: sourceChargeCount/
// sourceStartCharged are not reconstructed (not on the buff config) — correct for
// single-attacker DPS, where the timeline falls back to the attacker's own charged set;
// team debuffs flow through the teamActors input (TeamActorInput), re-timed onto each
// team actor's own turns.
export function configShipSkillsToSimInputs(
    shipSkills: ShipSkills,
    enemyType?: EnemyBaseClass
): { selfBuffs: SelectedGameBuff[]; enemyDebuffs: SelectedGameBuff[] } {
    return buffAbilitiesToSelectedBuffs(shipSkills, buildStaticBuffContext({ enemyType }));
}
