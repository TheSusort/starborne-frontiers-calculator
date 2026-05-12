import { ParsedBuffEffects } from '../../types/calculator';

export function parseBuffEffects(name: string, description: string): ParsedBuffEffects {
    const effects: ParsedBuffEffects = {};

    const extract = (pattern: RegExp): number | undefined => {
        const m = description.match(pattern);
        return m ? parseInt(m[1], 10) : undefined;
    };

    const attack = extract(/([+-]\d+)%\s*(?:Outgoing\s*)?(?:Direct\s*)?Attack/);
    if (attack !== undefined) effects.attack = attack;

    const crit = extract(/([+-]\d+)%\s*(?:Outgoing\s*)?Crit\s*Rate/);
    if (crit !== undefined) effects.crit = crit;

    const critDamage = extract(/([+-]\d+)%\s*(?:Outgoing\s*)?Crit\s*Power/);
    if (critDamage !== undefined) effects.critDamage = critDamage;

    const outgoingDamage = extract(/([+-]\d+)%\s*Outgoing\s*Direct\s*Damage/);
    if (outgoingDamage !== undefined) effects.outgoingDamage = outgoingDamage;

    const defPen = extract(/([+-]\d+)%\s*Defense\s*Penetration/);
    if (defPen !== undefined) effects.defensePenetration = defPen;

    // DoT: use buff name prefix to distinguish Out. vs Inc.
    const dotValue = extract(/([+-]\d+)%\s*DoT\s*Damage/);
    if (dotValue !== undefined) {
        if (name.startsWith('Out.')) {
            effects.dotDamage = dotValue;
        } else if (name.startsWith('Inc.')) {
            effects.incomingDotDamage = dotValue;
        }
    }

    // Defense: negative lookahead to exclude "Defense Penetration"
    const defense = extract(/([+-]\d+)%\s*Defense(?!\s*Penetration)/);
    if (defense !== undefined) effects.defense = defense;

    const incomingDamage = extract(/([+-]\d+)%\s*Incoming\s*Direct\s*Damage/);
    if (incomingDamage !== undefined) effects.incomingDamage = incomingDamage;

    return effects;
}

export function isStackable(description: string): { stackable: boolean; maxStacks?: number } {
    if (!/stackable/i.test(description)) {
        return { stackable: false };
    }
    const m = description.match(/up to (\d+) times/i);
    return { stackable: true, maxStacks: m ? parseInt(m[1], 10) : undefined };
}

export function hasDpsEffect(
    effects: ParsedBuffEffects,
    relevantStats: (keyof ParsedBuffEffects)[]
): boolean {
    return relevantStats.some((stat) => effects[stat] !== undefined);
}
