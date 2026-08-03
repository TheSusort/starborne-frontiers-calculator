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
        if (parsedEffects.outgoingHeal !== undefined)
            entries.push({
                id: `${s.id}-oh`,
                stat: 'outgoingHeal',
                value: parsedEffects.outgoingHeal * stacks,
            });
        if (parsedEffects.incomingHeal !== undefined)
            entries.push({
                id: `${s.id}-ih`,
                stat: 'incomingHeal',
                value: parsedEffects.incomingHeal * stacks,
            });
        if (parsedEffects.hotPct !== undefined)
            entries.push({
                id: `${s.id}-hot`,
                stat: 'hotPct',
                value: parsedEffects.hotPct * stacks,
            });
        if (parsedEffects.speed !== undefined)
            entries.push({ id: `${s.id}-spd`, stat: 'speed', value: parsedEffects.speed * stacks });
        if (parsedEffects.hacking !== undefined)
            entries.push({
                id: `${s.id}-hack`,
                stat: 'hacking',
                value: parsedEffects.hacking * stacks,
            });
        if (parsedEffects.security !== undefined)
            entries.push({
                id: `${s.id}-sec`,
                stat: 'security',
                value: parsedEffects.security * stacks,
            });
        if (parsedEffects.attackFlat !== undefined)
            entries.push({
                id: `${s.id}-attackFlat`,
                stat: 'attackFlat',
                value: parsedEffects.attackFlat * stacks,
            });
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

/** Sum the self-/friendly-side incoming-DIRECT-damage modifier from a victim's OWN buffs.
 *  Mirror of toEnemyModifiers' incoming reducer, but for friendly buffs (Inc. Damage Down/Up).
 *  Negative = less damage taken; positive = more. Summed into the same per-victim
 *  incomingDamageModifier as enemy-side debuffs (engine victimIncomingModifiers, D-PR12). */
export function toSelfIncomingDamageModifier(selected: SelectedGameBuff[]): number {
    return selected.reduce((sum, s) => sum + (s.parsedEffects.incomingDamage ?? 0) * s.stacks, 0);
}

export function toDotAndPenModifiers(
    attacker: SelectedGameBuff[],
    enemy: SelectedGameBuff[]
): { defensePenetrationBuff: number; dotDamageModifier: number; detonationDamageModifier: number } {
    return {
        defensePenetrationBuff: attacker.reduce(
            (sum, s) => sum + (s.parsedEffects.defensePenetration ?? 0) * s.stacks,
            0
        ),
        dotDamageModifier:
            attacker.reduce((sum, s) => sum + (s.parsedEffects.dotDamage ?? 0) * s.stacks, 0) +
            enemy.reduce((sum, s) => sum + (s.parsedEffects.incomingDotDamage ?? 0) * s.stacks, 0),
        // Outgoing-only: there is no incoming-detonation buff in the corpus, so the enemy list
        // contributes nothing here (unlike dotDamageModifier above).
        detonationDamageModifier: attacker.reduce(
            (sum, s) => sum + (s.parsedEffects.detonationDamage ?? 0) * s.stacks,
            0
        ),
    };
}

export function toEnemyDotModifier(selected: SelectedGameBuff[]): number {
    return selected.reduce(
        (sum, s) => sum + (s.parsedEffects.incomingDotDamage ?? 0) * s.stacks,
        0
    );
}
