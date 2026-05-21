import { SelectedGameBuff } from '../../types/calculator';
import { Ship } from '../../types/ship';
import { BUFFS } from '../../constants/buffs';
import { parseAllSkillEffects, SkillEffect } from '../skillTextParser';
import { parseBuffEffects, isStackable } from './buffParser';

export interface SkillBuffAutoFill {
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
}

export function buildSkillBuffAutoFill(ship: Ship): SkillBuffAutoFill {
    const effects = parseAllSkillEffects(ship);
    return {
        selfBuffs: toSelectedBuffs(effects.filter((e) => e.target === 'self')),
        enemyDebuffs: toSelectedBuffs(effects.filter((e) => e.target === 'enemy')),
    };
}

function toSelectedBuffs(effects: SkillEffect[]): SelectedGameBuff[] {
    const seen = new Set<string>();
    const result: SelectedGameBuff[] = [];

    for (const effect of effects) {
        if (seen.has(effect.buffName)) continue;
        const buff = BUFFS.find((b) => b.name === effect.buffName);
        if (!buff) continue;

        seen.add(effect.buffName);
        const parsedEffects = parseBuffEffects(buff.name, buff.description);
        const stackInfo = isStackable(buff.description);

        result.push({
            id: buff.name,
            buffName: buff.name,
            stacks: 1,
            parsedEffects,
            isStackable: stackInfo.stackable,
            maxStacks: stackInfo.maxStacks,
            autoFilled: true,
        });
    }

    return result;
}

/**
 * Merges auto-filled buff entries into an existing list, skipping duplicates by buffName.
 * Existing entries always win over auto-filled entries of the same buff.
 */
export function mergeAutoFill(
    existing: SelectedGameBuff[],
    autoFilled: SelectedGameBuff[]
): SelectedGameBuff[] {
    const existingNames = new Set(existing.map((b) => b.buffName));
    return [...existing, ...autoFilled.filter((b) => !existingNames.has(b.buffName))];
}
