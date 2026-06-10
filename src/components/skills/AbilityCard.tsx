import React from 'react';
import {
    Ability,
    AbilityConfig,
    AbilityTarget,
    AbilityTrigger,
    Condition,
    ModifierChannel,
    SkillSlot,
    LIVE_TRIGGERS,
} from '../../types/abilities';
import { DoTType, ParsedBuffEffects, SelectedGameBuff } from '../../types/calculator';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { Button } from '../ui/Button';
import { ChevronUpIcon, ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { GameBuffPicker } from '../calculator/GameBuffPicker';
import {
    NOT_SIMULATED_TYPES,
    PASSIVE_NOOP_TYPES,
    NOT_SIMULATED_NOTE,
    PASSIVE_NOOP_WARNING,
} from './simCoverage';
import { ConditionRow } from './ConditionRow';

interface Props {
    ability: Ability;
    onChange: (ability: Ability) => void;
    onRemove: () => void;
    /** Move this ability up/down in the skill's execution order; undefined at the ends. */
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    /** Slot this ability lives in; enables slot-specific sim-coverage warnings. */
    slot?: SkillSlot;
}

const ABILITY_TYPE_LABELS: Record<Ability['type'], string> = {
    damage: 'Damage',
    'additional-damage': 'Additional Damage',
    modifier: 'Modifier',
    buff: 'Buff',
    debuff: 'Debuff',
    dot: 'Damage over Time',
    'extend-dot': 'Extend DoTs',
    'detonate-dot': 'Detonate DoTs',
    'accumulate-detonate': 'Accumulate & Detonate',
    charge: 'Charge',
    'extra-action': 'Extra Action',
    heal: 'Heal',
    shield: 'Shield',
    cleanse: 'Cleanse',
    purge: 'Purge',
    control: 'Control',
};

const TARGET_OPTIONS: { value: AbilityTarget; label: string }[] = [
    { value: 'self', label: 'Self' },
    { value: 'ally', label: 'Ally' },
    { value: 'all-allies', label: 'All allies' },
    { value: 'enemy', label: 'Enemy' },
    { value: 'all-enemies', label: 'All enemies' },
];

const MODIFIER_CHANNEL_OPTIONS: { value: ModifierChannel; label: string }[] = [
    { value: 'attack', label: 'Attack' },
    { value: 'defense', label: 'Defense' },
    { value: 'defensePenetration', label: 'Defense Penetration' },
    { value: 'hp', label: 'HP' },
    { value: 'crit', label: 'Crit' },
    { value: 'critDamage', label: 'Crit Damage' },
    { value: 'outgoingDamage', label: 'Outgoing Damage' },
    { value: 'outgoingHeal', label: 'Outgoing Heal' },
    { value: 'incomingDamage', label: 'Incoming Damage' },
];

const ADDITIONAL_DAMAGE_STAT_OPTIONS = [
    { value: 'hp', label: 'HP' },
    { value: 'defense', label: 'Defense' },
];

const DOT_TYPE_OPTIONS: { value: DoTType; label: string }[] = [
    { value: 'corrosion', label: 'Corrosion' },
    { value: 'inferno', label: 'Inferno' },
    { value: 'bomb', label: 'Bomb' },
];

const DEBUFF_APPLICATION_OPTIONS = [
    { value: 'inflict', label: 'Inflict' },
    { value: 'apply', label: 'Apply' },
];

const HEAL_BASIS_OPTIONS = [
    { value: 'hp', label: "Caster's Max HP" },
    { value: 'attack', label: "Caster's Attack" },
    { value: 'defense', label: "Caster's Defense" },
    { value: 'target-hp', label: "Recipient's Max HP" },
    { value: 'damage-dealt', label: 'Damage dealt' },
    { value: 'damage-taken', label: 'Damage taken' },
];

const LEECH_SCOPE_OPTIONS = [
    { value: 'all', label: 'All damage' },
    { value: 'detonation', label: 'Detonations only' },
];

const EXTEND_DOT_SCOPE_OPTIONS: { value: 'active' | 'inflicted'; label: string }[] = [
    { value: 'active', label: 'All active DoTs' },
    { value: 'inflicted', label: 'Only DoTs from this cast' },
];

const TRIGGER_OPTIONS: { value: AbilityTrigger; label: string }[] = [
    { value: 'on-cast', label: 'On cast (default)' },
    { value: 'start-of-round', label: 'Start of round' },
    { value: 'on-crit', label: 'On critical hit' },
    { value: 'on-attacked', label: 'When attacked' },
    { value: 'on-ally-destroyed', label: 'On ally destroyed' },
    { value: 'on-destroyed', label: 'On destroyed' },
    { value: 'on-enemy-destroyed', label: 'On enemy destroyed' },
    { value: 'on-cheat-death-activated', label: 'When Cheat Death activates' },
    { value: 'on-debuff-inflicted', label: 'After inflicting a debuff' },
    { value: 'on-ally-debuff-inflicted', label: 'After an ally inflicts a debuff' },
    { value: 'on-ally-crit-dot', label: 'After an ally inflicts a DoT with a crit' },
    { value: 'on-ally-critically-repaired', label: 'After this unit critically repairs an ally' },
    { value: 'on-ally-crit', label: 'After an ally critically hits' },
    { value: 'on-bomb-detonated', label: 'When a Bomb detonates' },
];

const ALL_BUFF_STATS = [
    'attack',
    'crit',
    'critDamage',
    'outgoingDamage',
    'defensePenetration',
    'dotDamage',
    'outgoingHeal',
    'hp',
    'incomingHeal',
    'defense',
    'incomingDamage',
    'incomingDotDamage',
    'speed',
    'security',
] as (keyof ParsedBuffEffects)[];

const toNumber = (raw: string): number => {
    const n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
};

// Numeric input → turns; any non-numeric input (e.g. typing "r…") → 'recurring',
// so the recurring mode is reachable from a text field and survives editing.
const toDuration = (raw: string): number | 'recurring' => {
    const n = parseInt(raw, 10);
    return isNaN(n) ? 'recurring' : n;
};

export const AbilityCard: React.FC<Props> = ({
    ability,
    onChange,
    onRemove,
    onMoveUp,
    onMoveDown,
    slot,
}) => {
    const updateConfig = (config: AbilityConfig) => onChange({ ...ability, config });

    // "Scales per condition": per-unit bonus × the count from conditions[conditionIndex],
    // capped. Shared by damage and modifier abilities (e.g. "7.5% defPen per buff, up to 45%").
    const scalingEditor = (
        <>
            <Checkbox
                label="Scales per condition"
                checked={!!ability.scaling}
                onChange={(checked) =>
                    onChange({
                        ...ability,
                        scaling: checked ? { conditionIndex: 0, perUnit: 0 } : undefined,
                    })
                }
            />
            {ability.scaling && (
                <div className="flex gap-2">
                    <Input
                        label="Per condition count"
                        type="number"
                        step="0.01"
                        value={ability.scaling.perUnit}
                        helpLabel="added × the count of the first condition below"
                        onChange={(e) =>
                            onChange({
                                ...ability,
                                scaling: { ...ability.scaling!, perUnit: toNumber(e.target.value) },
                            })
                        }
                    />
                    <Input
                        label="Cap (optional)"
                        type="number"
                        value={ability.scaling.cap ?? ''}
                        onChange={(e) =>
                            onChange({
                                ...ability,
                                scaling: {
                                    ...ability.scaling!,
                                    cap: e.target.value ? toNumber(e.target.value) : undefined,
                                },
                            })
                        }
                    />
                </div>
            )}
        </>
    );

    const renderBody = () => {
        const config = ability.config;
        switch (config.type) {
            case 'damage':
                return (
                    <div className="space-y-2">
                        <div className="flex gap-2">
                            <Input
                                label="Skill multiplier"
                                type="number"
                                step="0.01"
                                value={config.multiplier}
                                onChange={(e) =>
                                    updateConfig({
                                        ...config,
                                        multiplier: toNumber(e.target.value),
                                    })
                                }
                            />
                            <Input
                                label="Hits (optional)"
                                type="number"
                                min={1}
                                value={config.hits ?? ''}
                                onChange={(e) =>
                                    updateConfig({
                                        ...config,
                                        hits: e.target.value
                                            ? parseInt(e.target.value, 10)
                                            : undefined,
                                    })
                                }
                            />
                        </div>
                        <Checkbox
                            label="Cannot critically hit"
                            checked={config.noCrit ?? false}
                            onChange={(checked) =>
                                updateConfig({ ...config, noCrit: checked ? true : undefined })
                            }
                        />
                        {scalingEditor}
                    </div>
                );

            case 'additional-damage':
                return (
                    <div className="flex gap-2">
                        <Select
                            label="Based on stat"
                            value={config.stat}
                            options={ADDITIONAL_DAMAGE_STAT_OPTIONS}
                            onChange={(value) =>
                                updateConfig({ ...config, stat: value as 'hp' | 'defense' })
                            }
                        />
                        <Input
                            label="Percent"
                            type="number"
                            value={config.pct}
                            onChange={(e) =>
                                updateConfig({ ...config, pct: toNumber(e.target.value) })
                            }
                        />
                    </div>
                );

            case 'modifier':
                return (
                    <div className="space-y-2">
                        <div className="flex gap-2">
                            <Select
                                label="Channel"
                                value={config.channel}
                                options={MODIFIER_CHANNEL_OPTIONS}
                                onChange={(value) =>
                                    updateConfig({ ...config, channel: value as ModifierChannel })
                                }
                            />
                            <Input
                                label="Value (flat %)"
                                type="number"
                                value={config.value}
                                onChange={(e) =>
                                    updateConfig({ ...config, value: toNumber(e.target.value) })
                                }
                            />
                        </div>
                        {scalingEditor}
                        <p className="text-xs text-theme-text-secondary">
                            Applied additively (flat value + per-condition scaling). Multiplicative
                            flag not yet simulated.
                        </p>
                    </div>
                );

            case 'charge':
                return (
                    <Input
                        label="Amount"
                        type="number"
                        value={config.amount}
                        onChange={(e) =>
                            updateConfig({ ...config, amount: toNumber(e.target.value) })
                        }
                    />
                );

            case 'extra-action':
                return (
                    <div className="space-y-2">
                        <p className="text-xs text-theme-text-secondary">
                            {config.oncePerRound
                                ? '+1 extra action (once per round)'
                                : '+1 extra action'}
                        </p>
                        <Checkbox
                            label="Once per round"
                            checked={config.oncePerRound}
                            onChange={(checked) =>
                                updateConfig({ ...config, oncePerRound: checked })
                            }
                        />
                    </div>
                );

            case 'dot':
                return (
                    <div className="flex flex-wrap gap-2">
                        <Select
                            label="DoT type"
                            value={config.dotType}
                            options={DOT_TYPE_OPTIONS}
                            onChange={(value) =>
                                updateConfig({ ...config, dotType: value as DoTType })
                            }
                        />
                        <Input
                            label="Tier"
                            type="number"
                            value={config.tier}
                            onChange={(e) =>
                                updateConfig({ ...config, tier: toNumber(e.target.value) })
                            }
                        />
                        <Input
                            label="Stacks"
                            type="number"
                            value={config.stacks}
                            onChange={(e) =>
                                updateConfig({ ...config, stacks: toNumber(e.target.value) })
                            }
                        />
                        <Input
                            label="Duration"
                            type="number"
                            value={config.duration}
                            onChange={(e) =>
                                updateConfig({ ...config, duration: toNumber(e.target.value) })
                            }
                        />
                    </div>
                );

            case 'extend-dot':
                return (
                    <div className="space-y-2">
                        <Input
                            label="Extend active DoTs by (turns)"
                            helpLabel="Adds this many turns to active Corrosion/Inferno effects when the skill fires, so they tick longer. Bombs are unaffected."
                            type="number"
                            min={1}
                            value={config.turns}
                            onChange={(e) =>
                                updateConfig({ ...config, turns: toNumber(e.target.value) })
                            }
                        />
                        <Checkbox
                            label="Chance = Crit Power"
                            checked={config.chanceFromCritPower ?? false}
                            onChange={(checked) =>
                                updateConfig({
                                    ...config,
                                    chanceFromCritPower: checked ? true : undefined,
                                })
                            }
                        />
                        <Select
                            label="Scope"
                            helpLabel="All active DoTs grow every standing Corrosion/Inferno; Only DoTs from this cast grow only the ones this skill applies this turn (e.g. Valerian's newly applied Corrosion)."
                            value={config.scope ?? 'active'}
                            options={EXTEND_DOT_SCOPE_OPTIONS}
                            onChange={(value) =>
                                updateConfig({
                                    ...config,
                                    scope: value as 'active' | 'inflicted',
                                })
                            }
                        />
                    </div>
                );

            case 'detonate-dot':
                return (
                    <div className="flex flex-wrap gap-2">
                        <Select
                            label="Detonate DoT type"
                            value={config.dotType}
                            options={DOT_TYPE_OPTIONS}
                            onChange={(value) =>
                                updateConfig({ ...config, dotType: value as DoTType })
                            }
                        />
                        <Input
                            label="Power (%)"
                            helpLabel="Consumes active DoTs of this type and deals their full remaining damage at once, scaled by this %. The payout is detonation damage."
                            type="number"
                            value={config.powerPct}
                            onChange={(e) =>
                                updateConfig({ ...config, powerPct: toNumber(e.target.value) })
                            }
                        />
                    </div>
                );

            case 'accumulate-detonate':
                return (
                    <div className="flex flex-wrap gap-2">
                        <Input
                            label="Gather for (turns)"
                            helpLabel="While active, this debuff gathers all direct damage dealt to the enemy. On expiry it detonates for the % below of the accumulated total (e.g. Echoing Burst)."
                            type="number"
                            min={1}
                            value={config.turns}
                            onChange={(e) =>
                                updateConfig({ ...config, turns: toNumber(e.target.value) })
                            }
                        />
                        <Input
                            label="Detonate for (%)"
                            helpLabel="Percentage of the accumulated direct damage dealt as detonation damage when the debuff expires."
                            type="number"
                            value={config.pct}
                            onChange={(e) =>
                                updateConfig({ ...config, pct: toNumber(e.target.value) })
                            }
                        />
                    </div>
                );

            case 'buff':
            case 'debuff': {
                const pickerValue: SelectedGameBuff[] = config.buffName
                    ? [
                          {
                              id: config.buffName,
                              buffName: config.buffName,
                              stacks: config.stacks,
                              parsedEffects: config.parsedEffects,
                              isStackable: config.isStackable,
                              maxStacks: config.maxStacks,
                          },
                      ]
                    : [];

                const handlePickerChange = (buffs: SelectedGameBuff[]) => {
                    if (buffs.length === 0) {
                        updateConfig({
                            ...config,
                            buffName: '',
                            parsedEffects: {},
                            isStackable: false,
                            maxStacks: undefined,
                        });
                        return;
                    }
                    const last = buffs[buffs.length - 1];
                    updateConfig({
                        ...config,
                        buffName: last.buffName,
                        parsedEffects: last.parsedEffects,
                        isStackable: last.isStackable,
                        maxStacks: last.maxStacks,
                    });
                };

                return (
                    <div className="space-y-2">
                        <GameBuffPicker
                            label={config.type === 'buff' ? 'Buff' : 'Debuff'}
                            relevantStats={ALL_BUFF_STATS}
                            value={pickerValue}
                            onChange={handlePickerChange}
                        />
                        <div className="flex flex-wrap gap-2">
                            <Input
                                label="Stacks"
                                type="number"
                                min={1}
                                value={config.stacks}
                                onChange={(e) =>
                                    updateConfig({ ...config, stacks: toNumber(e.target.value) })
                                }
                            />
                            {config.type === 'debuff' && (
                                <Select
                                    label="Application"
                                    helpLabel="Inflict = resistible (rolls against your Hacking vs enemy Security). Apply = guaranteed to land, except when you're at an affinity disadvantage (then it's resisted)."
                                    value={config.application}
                                    options={DEBUFF_APPLICATION_OPTIONS}
                                    onChange={(value) =>
                                        updateConfig({
                                            ...config,
                                            application: value as 'inflict' | 'apply',
                                        })
                                    }
                                />
                            )}
                            <Input
                                label="Duration"
                                helpLabel='turns, or "recurring"'
                                value={
                                    typeof config.duration === 'number'
                                        ? String(config.duration)
                                        : (config.duration ?? '')
                                }
                                onChange={(e) =>
                                    updateConfig({
                                        ...config,
                                        duration: e.target.value
                                            ? toDuration(e.target.value)
                                            : undefined,
                                    })
                                }
                            />
                        </div>
                    </div>
                );
            }

            case 'heal':
            case 'shield':
                return (
                    <div className="space-y-2">
                        <div className="flex gap-2">
                            <Input
                                label="Percent"
                                type="number"
                                min={0}
                                step="0.01"
                                value={config.pct}
                                onChange={(e) =>
                                    updateConfig({ ...config, pct: toNumber(e.target.value) })
                                }
                            />
                            <Select
                                label="Based on stat"
                                value={config.basis}
                                options={HEAL_BASIS_OPTIONS}
                                onChange={(value) =>
                                    updateConfig({
                                        ...config,
                                        basis: value as
                                            | 'hp'
                                            | 'attack'
                                            | 'defense'
                                            | 'target-hp'
                                            | 'damage-dealt'
                                            | 'damage-taken',
                                    })
                                }
                            />
                        </div>
                        {config.basis === 'damage-dealt' && slot === 'passive' && (
                            <Select
                                label="Leech scope"
                                value={config.leechScope ?? 'all'}
                                options={LEECH_SCOPE_OPTIONS}
                                onChange={(value) =>
                                    updateConfig({
                                        ...config,
                                        leechScope: value as 'all' | 'detonation',
                                    })
                                }
                            />
                        )}
                        {config.basis === 'damage-taken' && slot === 'passive' && (
                            <Checkbox
                                label="Only when damage punches through shield"
                                checked={config.requiresHpDamage ?? false}
                                onChange={(checked) =>
                                    updateConfig({
                                        ...config,
                                        requiresHpDamage: checked ? true : undefined,
                                    })
                                }
                            />
                        )}
                        {config.type === 'heal' && (
                            <Checkbox
                                label="Cannot critically hit"
                                checked={config.noCrit ?? false}
                                onChange={(checked) =>
                                    updateConfig({ ...config, noCrit: checked ? true : undefined })
                                }
                            />
                        )}
                    </div>
                );

            case 'cleanse':
            case 'purge':
                return (
                    <Input
                        label="Count"
                        type="number"
                        min={1}
                        value={config.count}
                        onChange={(e) =>
                            updateConfig({ ...config, count: toNumber(e.target.value) })
                        }
                    />
                );

            default:
                return (
                    <p className="text-xs text-theme-text-secondary">
                        No editable fields for this ability type.
                    </p>
                );
        }
    };

    const handleConditionChange = (index: number, condition: Condition) => {
        const conditions = ability.conditions.map((c, i) => (i === index ? condition : c));
        onChange({ ...ability, conditions });
    };

    const handleConditionRemove = (index: number) => {
        onChange({ ...ability, conditions: ability.conditions.filter((_, i) => i !== index) });
    };

    const handleAddCondition = () => {
        onChange({
            ...ability,
            conditions: [...ability.conditions, { subject: 'always', derivable: true }],
        });
    };

    return (
        <div className="card space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">{ABILITY_TYPE_LABELS[ability.type]}</h4>
                <div className="flex items-center gap-1">
                    {onMoveUp && (
                        <Button
                            variant="secondary"
                            size="xs"
                            onClick={onMoveUp}
                            aria-label="Move ability up"
                        >
                            <ChevronUpIcon />
                        </Button>
                    )}
                    {onMoveDown && (
                        <Button
                            variant="secondary"
                            size="xs"
                            onClick={onMoveDown}
                            aria-label="Move ability down"
                        >
                            <ChevronDownIcon />
                        </Button>
                    )}
                    <Button
                        variant="danger"
                        size="xs"
                        onClick={onRemove}
                        aria-label="Remove ability"
                    >
                        ×
                    </Button>
                </div>
            </div>

            {/* Reactive abilities fire through the trigger machinery regardless of slot, so
                suppress the passive-noop warning when a live trigger is set. */}
            {slot === 'passive' &&
                PASSIVE_NOOP_TYPES.has(ability.type) &&
                !LIVE_TRIGGERS.has(ability.trigger) && (
                    <p className="text-xs text-yellow-400">{PASSIVE_NOOP_WARNING}</p>
                )}

            {/* Not-simulated note is independent of the field editor so it always
                shows for flagged types even when a case provides editable fields
                (e.g. purge: count is editable for annotation but not yet simulated). */}
            {NOT_SIMULATED_TYPES.has(ability.type) && (
                <p className="text-xs text-theme-text-secondary">{NOT_SIMULATED_NOTE}</p>
            )}

            <Select
                label="Target"
                value={ability.target}
                options={TARGET_OPTIONS}
                onChange={(value) => onChange({ ...ability, target: value as AbilityTarget })}
            />

            {(ability.type === 'buff' ||
                ability.type === 'debuff' ||
                ability.type === 'dot' ||
                ability.type === 'charge' ||
                ability.type === 'heal' ||
                ability.type === 'shield' ||
                ability.type === 'cleanse') && (
                <>
                    <Select
                        label="Trigger"
                        value={ability.trigger}
                        options={TRIGGER_OPTIONS}
                        onChange={(value) => {
                            if (value === 'on-attacked') {
                                onChange({ ...ability, trigger: value as AbilityTrigger });
                            } else {
                                const { triggerCritFilter: _removed, ...rest } = ability;
                                onChange({ ...rest, trigger: value as AbilityTrigger });
                            }
                        }}
                    />
                    {ability.trigger !== 'on-cast' && !LIVE_TRIGGERS.has(ability.trigger) && (
                        <p className="text-xs text-theme-text-secondary">
                            Not simulated — treated as assume-active
                        </p>
                    )}
                    {ability.trigger === 'on-attacked' && (
                        <Select
                            label="Hit filter"
                            value={ability.triggerCritFilter ?? 'any'}
                            options={[
                                { value: 'any', label: 'Any hit' },
                                { value: 'crit', label: 'Only critical hits' },
                                { value: 'non-crit', label: 'Only non-critical hits' },
                            ]}
                            onChange={(value) => {
                                if (value === 'any') {
                                    const { triggerCritFilter: _removed, ...rest } = ability;
                                    onChange(rest as Ability);
                                } else {
                                    onChange({
                                        ...ability,
                                        triggerCritFilter: value as 'crit' | 'non-crit',
                                    });
                                }
                            }}
                            helpLabel="Per-hit: a multi-hit attack checks each hit separately"
                        />
                    )}
                </>
            )}

            {renderBody()}

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Conditions</span>
                    <Button variant="secondary" size="xs" onClick={handleAddCondition}>
                        Add condition
                    </Button>
                </div>
                {ability.conditions.map((condition, index) => (
                    <ConditionRow
                        key={index}
                        condition={condition}
                        onChange={(c) => handleConditionChange(index, c)}
                        onRemove={() => handleConditionRemove(index)}
                    />
                ))}
            </div>
        </div>
    );
};
