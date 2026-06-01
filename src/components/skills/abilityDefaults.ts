import { Ability, AbilityConfig, AbilityTarget, AbilityType } from '../../types/abilities';

let abilityIdCounter = 0;

const nextId = (): string => `ability-${Date.now()}-${abilityIdCounter++}`;

const makeDefaultConfig = (type: AbilityType): AbilityConfig => {
    switch (type) {
        case 'damage':
            return { type: 'damage', multiplier: 100 };
        case 'additional-damage':
            return { type: 'additional-damage', stat: 'hp', pct: 10 };
        case 'modifier':
            return {
                type: 'modifier',
                channel: 'outgoingDamage',
                value: 10,
                isMultiplicative: true,
            };
        case 'buff':
            return { type: 'buff', buffName: '', parsedEffects: {}, stacks: 1, isStackable: false };
        case 'debuff':
            return {
                type: 'debuff',
                buffName: '',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                application: 'inflict',
            };
        case 'dot':
            return { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 1, duration: 2 };
        case 'charge':
            return { type: 'charge', amount: 1 };
        case 'heal':
            return { type: 'heal', pct: 10, basis: 'hp' };
        case 'shield':
            return { type: 'shield', pct: 10, basis: 'hp' };
        case 'cleanse':
            return { type: 'cleanse', count: 1 };
        case 'purge':
            return { type: 'purge', count: 1 };
        case 'control':
            return { type: 'control', effect: 'provoke' };
    }
};

const DEFAULT_TARGETS: Record<AbilityType, AbilityTarget> = {
    damage: 'enemy',
    'additional-damage': 'enemy',
    modifier: 'self',
    buff: 'self',
    debuff: 'enemy',
    dot: 'enemy',
    charge: 'self',
    heal: 'ally',
    shield: 'ally',
    cleanse: 'ally',
    purge: 'enemy',
    control: 'enemy',
};

/**
 * Builds a valid default {@link Ability} for the given type, with a freshly
 * generated id. Pure aside from the monotonic id counter — pass `id` to make
 * the result fully deterministic (useful in tests).
 */
export const makeDefaultAbility = (type: AbilityType, id: string = nextId()): Ability => ({
    id,
    type,
    target: DEFAULT_TARGETS[type],
    trigger: 'on-cast',
    conditions: [],
    config: makeDefaultConfig(type),
});
