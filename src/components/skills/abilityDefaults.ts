import { Ability, AbilityConfig, AbilityTarget, AbilityType } from '../../types/abilities';

let abilityIdCounter = 0;

const nextId = (): string => `ability-${Date.now()}-${abilityIdCounter++}`;

const makeDefaultConfig = (type: AbilityType): AbilityConfig => {
    switch (type) {
        case 'damage':
            return { type: 'damage', multiplier: 100 };
        case 'counter':
            return { type: 'counter', multiplier: 100 };
        case 'additional-damage':
            return { type: 'additional-damage', stat: 'hp', pct: 10 };
        case 'shield-strip':
            return { type: 'shield-strip', pct: 10 };
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
        case 'extend-dot':
            return { type: 'extend-dot', turns: 1 };
        case 'detonate-dot':
            return { type: 'detonate-dot', dotType: 'inferno', powerPct: 100 };
        case 'accumulate-detonate':
            return { type: 'accumulate-detonate', turns: 2, pct: 100 };
        case 'charge':
            return { type: 'charge', amount: 1 };
        case 'extra-action':
            return { type: 'extra-action', oncePerRound: false };
        case 'heal':
            return { type: 'heal', pct: 10, basis: 'hp' };
        case 'shield':
            return { type: 'shield', pct: 10, basis: 'hp' };
        case 'cleanse':
            return { type: 'cleanse', count: 1 };
        case 'purge':
            return { type: 'purge', count: 1 };
        case 'buff-steal':
            return { type: 'buff-steal', count: 1 };
        case 'control':
            return { type: 'control', effect: 'provoke' };
        case 'remove-self-buff':
            return { type: 'remove-self-buff', buffName: '', scope: 'all' };
        case 'incoming-reduction':
            return {
                type: 'incoming-reduction',
                scope: 'direct',
                condition: 'incoming-crit',
                pct: 0,
                critFamily: false,
            };
        case 'incoming-block':
            return {
                type: 'incoming-block',
                condition: 'self-stealth',
                procChance: 0,
                blockPct: 1,
                oncePerRound: false,
            };
        case 'incoming-shield-grant':
            return {
                type: 'incoming-shield-grant',
                hpThresholdPct: 30,
                flatAmount: 0,
                attackPct: 100,
                oncePerCombat: true,
            };
        case 'outgoing-amplification':
            return {
                type: 'outgoing-amplification',
                condition: 'amplify-on-crit',
                ampPct: 0,
                procChance: 0,
            };
        case 'heal-amplification':
            return { type: 'heal-amplification', condition: 'target-hp-below-self', ampPct: 0 };
        case 'incoming-heal-amplification':
            return { type, ampPct: 0, procChance: 0 };
        case 'pre-combat-stat':
            return { type, stat: 'attack', value: 0, valueKind: 'flat' };
        case 'transform-incoming-to-dot':
            return { type, turns: 3, condition: 'always' };
        case 'convert-dot':
            return {
                type,
                fromDotType: 'corrosion',
                buffName: '',
                chanceFromStat: { stat: 'hacking', pctPerPoint: 0.1 },
            };
    }
};

const DEFAULT_TARGETS: Record<AbilityType, AbilityTarget> = {
    damage: 'enemy',
    counter: 'enemy',
    'additional-damage': 'enemy',
    'shield-strip': 'enemy',
    modifier: 'self',
    buff: 'self',
    debuff: 'enemy',
    dot: 'enemy',
    'extend-dot': 'enemy',
    'detonate-dot': 'enemy',
    'accumulate-detonate': 'enemy',
    charge: 'self',
    'extra-action': 'self',
    heal: 'ally',
    shield: 'ally',
    cleanse: 'ally',
    purge: 'enemy',
    'buff-steal': 'enemy',
    control: 'enemy',
    'remove-self-buff': 'self',
    'incoming-reduction': 'self',
    'incoming-block': 'self',
    'incoming-shield-grant': 'self',
    'outgoing-amplification': 'self',
    'heal-amplification': 'self',
    'incoming-heal-amplification': 'self',
    'pre-combat-stat': 'self',
    'transform-incoming-to-dot': 'self',
    'convert-dot': 'enemy',
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
    // A counter only ever fires on the victim-side `on-attacked` path (the parser builds it
    // that way and the combat executor reads that trigger), so default it correctly — the
    // helper should always yield a semantically valid ability, even though counters are
    // currently parser-generated rather than authored via the picker. Likewise a
    // pre-combat-stat grant only ever rides the annotation-only 'pre-combat' trigger
    // (the battle sim's pre-fight layer reads it before any combat event exists).
    // SP-E: a transform-incoming-to-dot ability, like counter, only ever rides the victim-side
    // `on-attacked` path (see buildShipAbilities.ts's Voron/Orel emit site). SP-E Task E4: a
    // convert-dot ability only ever rides on-ally-debuff-inflicted (Belladonna's emit site).
    trigger:
        type === 'counter' || type === 'transform-incoming-to-dot'
            ? 'on-attacked'
            : type === 'pre-combat-stat'
              ? 'pre-combat'
              : type === 'convert-dot'
                ? 'on-ally-debuff-inflicted'
                : 'on-cast',
    conditions: [],
    config: makeDefaultConfig(type),
});
