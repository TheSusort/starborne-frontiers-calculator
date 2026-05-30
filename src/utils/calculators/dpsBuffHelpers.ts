import { Buff, SelectedGameBuff } from '../../types/calculator';

export function toSimBuffs(selected: SelectedGameBuff[]): Buff[] {
    return selected.flatMap((s) => {
        const entries: Buff[] = [];
        const { parsedEffects, stacks } = s;
        if (parsedEffects.attack !== undefined)
            entries.push({
                id: `${s.id}-atk`,
                stat: 'attack',
                value: parsedEffects.attack * stacks,
            });
        if (parsedEffects.crit !== undefined)
            entries.push({ id: `${s.id}-crit`, stat: 'crit', value: parsedEffects.crit * stacks });
        if (parsedEffects.critDamage !== undefined)
            entries.push({
                id: `${s.id}-cd`,
                stat: 'critDamage',
                value: parsedEffects.critDamage * stacks,
            });
        if (parsedEffects.outgoingDamage !== undefined)
            entries.push({
                id: `${s.id}-od`,
                stat: 'outgoingDamage',
                value: parsedEffects.outgoingDamage * stacks,
            });
        if (parsedEffects.defense !== undefined)
            entries.push({
                id: `${s.id}-def`,
                stat: 'defence',
                value: parsedEffects.defense * stacks,
            });
        if (parsedEffects.hp !== undefined)
            entries.push({ id: `${s.id}-hp`, stat: 'hp', value: parsedEffects.hp * stacks });
        return entries;
    });
}

export function toEnemyModifiers(selected: SelectedGameBuff[]): {
    enemyDefenseModifier: number;
    incomingDamageModifier: number;
} {
    return {
        enemyDefenseModifier: selected.reduce(
            (sum, s) => sum + (s.parsedEffects.defense ?? 0) * s.stacks,
            0
        ),
        incomingDamageModifier: selected.reduce(
            (sum, s) => sum + (s.parsedEffects.incomingDamage ?? 0) * s.stacks,
            0
        ),
    };
}

export function toDotAndPenModifiers(
    attacker: SelectedGameBuff[],
    enemy: SelectedGameBuff[]
): { defensePenetrationBuff: number; dotDamageModifier: number } {
    return {
        defensePenetrationBuff: attacker.reduce(
            (sum, s) => sum + (s.parsedEffects.defensePenetration ?? 0) * s.stacks,
            0
        ),
        dotDamageModifier:
            attacker.reduce((sum, s) => sum + (s.parsedEffects.dotDamage ?? 0) * s.stacks, 0) +
            enemy.reduce((sum, s) => sum + (s.parsedEffects.incomingDotDamage ?? 0) * s.stacks, 0),
    };
}

export function toEnemyDotModifier(selected: SelectedGameBuff[]): number {
    return selected.reduce(
        (sum, s) => sum + (s.parsedEffects.incomingDotDamage ?? 0) * s.stacks,
        0
    );
}
