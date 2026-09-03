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
    FACTION_FILTERABLE_TARGETS,
} from '../../types/abilities';
import { DoTType, ParsedBuffEffects, SelectedGameBuff } from '../../types/calculator';
import { ShipRoleCategory } from '../../constants/shipTypes';
import { FACTIONS, FACTION_KEYS, type FactionKey } from '../../constants/factions';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { CheckboxGroup } from '../ui/CheckboxGroup';
import { Button } from '../ui/Button';
import { ChevronUpIcon, ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { GameBuffPicker } from '../calculator/GameBuffPicker';
import { targetSideAllowedForType } from '../../utils/abilities/abilityTargetSide';
import {
    isAbilityNotSimulated,
    isVictimlessInfliction,
    PASSIVE_NOOP_TYPES,
    NOT_SIMULATED_NOTE,
    PASSIVE_NOOP_WARNING,
    VICTIMLESS_INFLICTION_WARNING,
    CHARGE_TARGET_OPTIONS,
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
    counter: 'Counterattack',
    'additional-damage': 'Additional Damage',
    'shield-strip': 'Shield Strip',
    modifier: 'Modifier',
    buff: 'Buff',
    debuff: 'Debuff',
    dot: 'Damage over Time',
    'extend-dot': 'Extend DoTs',
    'extend-status': 'Extend Status',
    'detonate-dot': 'Detonate DoTs',
    'accumulate-detonate': 'Accumulate & Detonate',
    charge: 'Charge',
    'extra-action': 'Extra Action',
    heal: 'Heal',
    shield: 'Shield',
    cleanse: 'Cleanse',
    purge: 'Purge',
    'buff-steal': 'Buff Steal',
    control: 'Control',
    'remove-self-buff': 'Remove Self Buff',
    'incoming-reduction': 'Incoming Reduction',
    'incoming-block': 'Incoming Block',
    'incoming-shield-grant': 'Incoming Shield Grant',
    'outgoing-amplification': 'Outgoing Amplification',
    'heal-amplification': 'Heal Amplification',
    'incoming-heal-amplification': 'Incoming Heal Amplification',
    'pre-combat-stat': 'Pre-Combat Stat',
    'transform-incoming-to-dot': 'Transform Incoming to DoT',
    'convert-dot': 'Convert DoT',
    'defense-substitution': 'Defense Substitution',
    'bomb-countdown-reduce': 'Bomb Countdown Reduce',
    // ship-kit wave 4 Task 8: wired directly at the engine's defensive-read seam, no editor UI
    // yet — placeholder label only, no editor UI (falls through to the `default:` "No editable
    // fields" branch below).
    'conditional-stat': 'Conditional Stat Bonus',
};

const TARGET_OPTIONS: { value: AbilityTarget; label: string }[] = [
    { value: 'self', label: 'Self' },
    { value: 'ally', label: 'Ally' },
    { value: 'all-allies', label: 'All allies' },
    { value: 'lowest-hp-ally', label: 'Lowest HP ally' },
    { value: 'adjacent-allies', label: 'Adjacent allies' },
    { value: 'enemy', label: 'Enemy' },
    { value: 'all-enemies', label: 'All enemies' },
    { value: 'adjacent-enemies', label: 'Adjacent enemies' },
    { value: 'target-and-adjacent-enemies', label: 'Target + adjacent enemies' },
];

const MODIFIER_CHANNEL_OPTIONS: { value: ModifierChannel; label: string }[] = [
    { value: 'attack', label: 'Attack' },
    { value: 'defense', label: 'Defense' },
    { value: 'defensePenetration', label: 'Defense Penetration' },
    { value: 'hp', label: 'HP' },
    { value: 'crit', label: 'Crit' },
    { value: 'critDamage', label: 'Crit Damage' },
    { value: 'outgoingDamage', label: 'Outgoing Damage' },
    { value: 'dotDamage', label: 'DoT Damage' },
    { value: 'detonationDamage', label: 'Detonation Damage' },
    { value: 'bombSplashDamage', label: 'Bomb Splash Damage' },
    { value: 'outgoingHeal', label: 'Outgoing Heal' },
    { value: 'incomingDamage', label: 'Incoming Damage' },
];

const ADDITIONAL_DAMAGE_STAT_OPTIONS = [
    { value: 'hp', label: 'HP' },
    { value: 'defense', label: 'Defense' },
    { value: 'shield', label: 'Shield' },
    { value: 'security', label: 'Security' },
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

const EXTEND_STATUS_KIND_OPTIONS: { value: 'buff' | 'debuff'; label: string }[] = [
    { value: 'buff', label: 'Buffs' },
    { value: 'debuff', label: 'Debuffs' },
];

const EXTEND_STATUS_SCOPE_OPTIONS: { value: 'active' | 'inflicted'; label: string }[] = [
    { value: 'active', label: 'All active statuses' },
    { value: 'inflicted', label: 'Only statuses from this cast' },
];

const ROLE_FILTER_OPTIONS: { value: ShipRoleCategory; label: string }[] = [
    { value: 'ATTACKER', label: 'Attacker' },
    { value: 'DEFENDER', label: 'Defender' },
    { value: 'DEBUFFER', label: 'Debuffer' },
    { value: 'SUPPORTER', label: 'Supporter' },
];

// #363: recipient FACTION scope options for an ally-scoped grant ("grants Tianchao allies
// Stealth"). Derived from FACTION_KEYS so a new faction cannot be forgotten here.
const FACTION_FILTER_OPTIONS: { value: FactionKey; label: string }[] = FACTION_KEYS.map((key) => ({
    value: key,
    label: FACTIONS[key].name,
}));

const PRE_COMBAT_STAT_OPTIONS: { value: 'hp' | 'attack' | 'crit' | 'hacking'; label: string }[] = [
    { value: 'hp', label: 'HP' },
    { value: 'attack', label: 'Attack' },
    { value: 'crit', label: 'Crit Rate' },
    { value: 'hacking', label: 'Hacking' },
];

const PRE_COMBAT_VALUE_KIND_OPTIONS: {
    value: 'flat' | 'percent-of-own' | 'percent-of-donor';
    label: string;
}[] = [
    { value: 'flat', label: 'Flat points' },
    { value: 'percent-of-own', label: "% of recipient's stat" },
    { value: 'percent-of-donor', label: "% of granting ship's stat" },
];

const TRIGGER_OPTIONS: { value: AbilityTrigger; label: string }[] = [
    { value: 'on-cast', label: 'On cast (default)' },
    { value: 'start-of-turn', label: 'Start of own turn' },
    { value: 'end-of-turn', label: 'End of own turn' },
    { value: 'start-of-round', label: 'Start of round' },
    { value: 'on-crit', label: 'On critical hit' },
    { value: 'on-deal-damage', label: 'On dealing direct damage' },
    { value: 'on-attacked', label: 'When attacked' },
    { value: 'on-debuffed', label: 'On debuffed (self)' },
    { value: 'on-debuff-resisted', label: 'On debuff resisted (self)' },
    { value: 'on-enemy-debuff-resisted', label: 'On enemy resists a debuff (any inflictor)' },
    { value: 'on-ally-attacked', label: 'When an ally is attacked' },
    { value: 'on-ally-destroyed', label: 'On ally destroyed' },
    { value: 'on-destroyed', label: 'On destroyed' },
    { value: 'on-enemy-destroyed', label: 'On enemy destroyed' },
    { value: 'on-enemy-repaired', label: 'When an enemy repairs' },
    { value: 'on-enemy-cleansed', label: 'When an enemy cleanses a debuff' },
    { value: 'on-enemy-charged-cast', label: 'When an enemy uses their charged skill' },
    { value: 'on-cheat-death-activated', label: 'When Cheat Death activates' },
    { value: 'on-debuff-inflicted', label: 'After inflicting a debuff' },
    { value: 'on-ally-debuff-inflicted', label: 'After an ally inflicts a debuff' },
    { value: 'on-ally-crit-dot', label: 'After an ally inflicts a DoT with a crit' },
    { value: 'on-ally-critically-repaired', label: 'After this unit critically repairs an ally' },
    { value: 'on-ally-crit', label: 'After an ally critically hits' },
    { value: 'on-bomb-detonated', label: 'When a Bomb detonates' },
    { value: 'on-hp-threshold-crossed', label: 'When HP drops below a threshold' },
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

    // #363: `FACTION_FILTERABLE_TARGETS` narrows on the TARGET axis only; this narrows on the
    // ABILITY TYPE axis, for the one type whose ally-targeted call site does not honour
    // `factionFilter` at all — see the "Recipient faction filter" control's own comment below for
    // why `charge` is excluded rather than wired up.
    const factionFilterHonoredForType = ability.type !== 'charge';

    // #407: the target dropdown is narrowed by ability TYPE. Unfiltered, it let a user author a
    // `buff` aimed at `all-enemies` and save it — a status that lands in the per-victim ENEMY store
    // but inflicts on ONE enemy (the cast anchor), because `playerTurn.ts`'s `matchingAbility`
    // lookup searches debuff-typed configs only. Owner ruling R4 closes that here rather than in the
    // engine. The permitted SIDES come from `ABILITY_TYPE_TARGET_SIDES` (abilityTargetSide.ts),
    // which is total over `AbilityType` and seeded from a sweep of all 1140 corpus abilities — see
    // `abilityTypeTargetSides.test.ts`.
    const sideAllowedTargets = TARGET_OPTIONS.filter((opt) =>
        targetSideAllowedForType(ability.type, opt.value)
    );

    // #399 Change 1a: a `charge`-typed ability may only pick from `CHARGE_TARGET_OPTIONS` — see
    // that constant's doc comment for why. It is STRICTER than the side filter above (three exact
    // targets, not a side), so it is applied instead of it rather than on top; `charge` is one of
    // the three `'both'`-sided types, so the side filter would narrow nothing for it anyway.
    //
    // Both arms share one rule for saved data: a previously-saved ability may carry a target that
    // is no longer offered (a legacy save, a shape imported from elsewhere, or — new in #407 — a
    // buff-at-enemy authored before the filter existed). Rather than let the `Select` silently fall
    // back to its blank "Select" placeholder for an unrecognised value (or coerce it to something
    // the user never chose), the stored value is appended as its own labelled, still-selectable
    // option so it stays visible and editable until the user picks a supported target.
    const savedTargetLabel = (suffix: string): { value: AbilityTarget; label: string } => ({
        value: ability.target,
        label: `${TARGET_OPTIONS.find((opt) => opt.value === ability.target)?.label ?? ability.target} ${suffix}`,
    });
    const targetOptionsForSelect: { value: AbilityTarget; label: string }[] =
        ability.type === 'charge'
            ? CHARGE_TARGET_OPTIONS.some((opt) => opt.value === ability.target)
                ? CHARGE_TARGET_OPTIONS
                : [
                      ...CHARGE_TARGET_OPTIONS,
                      savedTargetLabel('(legacy — not offered for new Charge abilities)'),
                  ]
            : sideAllowedTargets.some((opt) => opt.value === ability.target)
              ? sideAllowedTargets
              : [
                    ...sideAllowedTargets,
                    savedTargetLabel(
                        `(saved value — not valid for a ${ABILITY_TYPE_LABELS[ability.type]} ability)`
                    ),
                ];

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
                                updateConfig({
                                    ...config,
                                    stat: value as 'hp' | 'defense' | 'shield' | 'security',
                                })
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

            case 'shield-strip':
                return (
                    <Input
                        label="Percent of enemy Shield removed"
                        type="number"
                        value={config.pct}
                        onChange={(e) => updateConfig({ ...config, pct: toNumber(e.target.value) })}
                    />
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

            case 'extend-status':
                return (
                    <div className="flex flex-wrap gap-2">
                        <Select
                            label="Status kind"
                            helpLabel="Buffs extend every active buff on the recipient (self-side); Debuffs extend every active debuff on the recipient (enemy-side)."
                            value={config.statusKind}
                            options={EXTEND_STATUS_KIND_OPTIONS}
                            onChange={(value) =>
                                updateConfig({
                                    ...config,
                                    statusKind: value as 'buff' | 'debuff',
                                })
                            }
                        />
                        <Input
                            label="Extend by (turns)"
                            helpLabel="Adds this many turns to each eligible Buff/Debuff in the chosen scope when the skill fires. Permanent (stacking) buffs and recurring auras are unaffected."
                            type="number"
                            min={1}
                            value={config.turns}
                            onChange={(e) =>
                                updateConfig({ ...config, turns: toNumber(e.target.value) })
                            }
                        />
                        <Select
                            label="Scope"
                            helpLabel="All active grows every standing Buff/Debuff on the recipient; Only from this cast grows just the ones this skill applies this turn, its DoTs included (e.g. Asphyxiator's newly applied Debuff on a critical hit)."
                            value={config.scope ?? 'active'}
                            options={EXTEND_STATUS_SCOPE_OPTIONS}
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
                        {config.type === 'buff' && (
                            <Checkbox
                                label="Once per battle"
                                checked={config.oncePerCombat ?? false}
                                onChange={(checked) =>
                                    updateConfig({
                                        ...config,
                                        oncePerCombat: checked ? true : undefined,
                                    })
                                }
                            />
                        )}
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
                        {config.type === 'heal' && (
                            <Checkbox
                                label="Once per battle"
                                checked={config.oncePerCombat ?? false}
                                onChange={(checked) =>
                                    updateConfig({
                                        ...config,
                                        oncePerCombat: checked ? true : undefined,
                                    })
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

            case 'buff-steal':
                return (
                    <div className="flex flex-wrap items-end gap-2">
                        <Input
                            label="Count"
                            type="number"
                            min={1}
                            value={config.count}
                            onChange={(e) =>
                                updateConfig({ ...config, count: toNumber(e.target.value) })
                            }
                        />
                        <Checkbox
                            label="Also grant to adjacent allies"
                            checked={config.grantAdjacentAllies ?? false}
                            onChange={(checked) =>
                                updateConfig({
                                    ...config,
                                    grantAdjacentAllies: checked ? true : undefined,
                                })
                            }
                        />
                        {/* The top-up pair is ALL-OR-NOTHING. A half-specified pair would fall
                            through to the generic "steal N buffs" path and take an arbitrary buff
                            for a clause that names one status, so both fields are cleared together
                            unless the name is present AND the threshold is a positive integer.
                            The engine re-checks the same invariant — the editor is not the only
                            writer of a persisted config. */}
                        <Input
                            label="Named buff (top-up)"
                            helpLabel="Meatshield's shape: steal only this status, up to the threshold beside it. Leave blank for a normal 'steal N buffs'."
                            value={config.buffName ?? ''}
                            onChange={(e) => {
                                // The typed value is kept VERBATIM. This input is controlled, so
                                // trimming on change rewrites the DOM value on every keystroke
                                // and an interior space can never survive being typed — which
                                // locks the field to single-word statuses ("Titanite Plating" is
                                // unreachable). Surrounding whitespace is normalized on blur.
                                // A value that is ONLY whitespace still reads as ABSENT, so the
                                // all-or-nothing pair below can never be half-saved.
                                const buffName = e.target.value.trim() ? e.target.value : undefined;
                                updateConfig({
                                    ...config,
                                    buffName,
                                    upToStacks: buffName ? config.upToStacks : undefined,
                                });
                            }}
                            onBlur={(e) => {
                                const buffName = e.target.value.trim() || undefined;
                                if (buffName === config.buffName) return;
                                updateConfig({
                                    ...config,
                                    buffName,
                                    upToStacks: buffName ? config.upToStacks : undefined,
                                });
                            }}
                        />
                        <Input
                            label="Up to stacks"
                            helpLabel="The threshold the caster tops itself up TO. Only the deficit moves, and the source keeps the rest. Requires the named buff, and must be a whole number above 0."
                            type="number"
                            min={1}
                            step={1}
                            value={config.upToStacks ?? ''}
                            onChange={(e) => {
                                const raw = toNumber(e.target.value);
                                const upToStacks =
                                    e.target.value && Number.isInteger(raw) && raw > 0
                                        ? raw
                                        : undefined;
                                updateConfig({
                                    ...config,
                                    upToStacks,
                                    buffName: upToStacks ? config.buffName : undefined,
                                });
                            }}
                        />
                    </div>
                );

            case 'pre-combat-stat':
                return (
                    <div className="space-y-2">
                        <p className="text-xs text-theme-text-secondary">
                            Permanent base-stat grant applied before round 1 (battle simulator
                            only). Hidden and non-purgeable — never a timed status.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <Select
                                label="Stat"
                                value={config.stat}
                                options={PRE_COMBAT_STAT_OPTIONS}
                                onChange={(value) =>
                                    updateConfig({
                                        ...config,
                                        stat: value as 'hp' | 'attack' | 'crit' | 'hacking',
                                    })
                                }
                            />
                            <Input
                                label="Value"
                                type="number"
                                step="0.01"
                                value={config.value}
                                onChange={(e) =>
                                    updateConfig({ ...config, value: toNumber(e.target.value) })
                                }
                            />
                            <Select
                                label="Value kind"
                                helpLabel="Flat = absolute points (crit rate is always flat). % of recipient = scales the receiving ship's own pre-fight stat. % of granting ship = scales the donor's stat (Lionheart)."
                                value={config.valueKind}
                                options={PRE_COMBAT_VALUE_KIND_OPTIONS}
                                onChange={(value) =>
                                    updateConfig({
                                        ...config,
                                        valueKind: value as
                                            'flat' | 'percent-of-own' | 'percent-of-donor',
                                    })
                                }
                            />
                        </div>
                        <Checkbox
                            label="Multiply by adjacent-ally count"
                            checked={config.perAdjacentAlly ?? false}
                            onChange={(checked) =>
                                updateConfig({
                                    ...config,
                                    perAdjacentAlly: checked ? true : undefined,
                                })
                            }
                        />
                        <Select
                            label="Requires adjacent role"
                            helpLabel="Grant applies only while adjacent to at least one living ally of this role category. None = unconditional."
                            value={config.requiresAdjacentRole ?? 'none'}
                            options={[{ value: 'none', label: 'None' }, ...ROLE_FILTER_OPTIONS]}
                            onChange={(value) =>
                                updateConfig({
                                    ...config,
                                    requiresAdjacentRole:
                                        value === 'none' ? undefined : (value as ShipRoleCategory),
                                })
                            }
                        />
                    </div>
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

            {/* SP-4c-2d: a DoT or debuff on a trigger that names no enemy is DROPPED by the
                engine — it used to land on a vestigial hidden actor, so either way the user saw
                the effect reported in the combat log while it dealt nothing. WARN, DON'T BLOCK:
                no target the editor can offer would make the shape work (only a debuff on the
                highest-attack enemy resolves its own target, and that is Selenite's real passive,
                which the predicate exempts), so there is nowhere to steer the user. This also
                reaches abilities ALREADY SAVED with the combination — SkillEditorModal is
                live-edit with no save gate, so nothing else can. */}
            {isVictimlessInfliction(ability) && (
                <p className="text-xs text-yellow-400">{VICTIMLESS_INFLICTION_WARNING}</p>
            )}

            {/* Not-simulated note is independent of the field editor so it always
                shows for flagged types even when a case provides editable fields
                (e.g. purge: count is editable for annotation but not yet simulated). */}
            {isAbilityNotSimulated(ability) && (
                <p className="text-xs text-theme-text-secondary">{NOT_SIMULATED_NOTE}</p>
            )}

            {/* #363: `FACTION_FILTERABLE_TARGETS` gates on the TARGET axis only, but recipient
                faction narrowing is honoured on the RECIPIENT-status path (a timed/aura/
                accumulating buff — the four-site sweep in engine.ts/playerTurn.ts/triggers.ts),
                not on every ability type that can carry an ally-scoped target. An ally-targeted
                `charge` grant (playerTurn.ts's `supportRecipients('all-allies', allyRoster)` ally-
                charge call site) sums its amount across the active+passive slots into one scalar
                per actor before applying it to a roster — there is no single ability object left
                by then to read a factionFilter off, so threading it through would mean
                restructuring that scalar-sum call site to carry a per-ability filtered list
                instead. Gating the control off for `charge` (rather than that restructuring) is
                the fix here: offering a control that provably does nothing is worse than not
                offering it, and `charge` is corpus-cold on this path today (every shipped
                passive ally-charge grant is reactive, not this cast-path branch — see that call
                site's own comment). Revisit if a non-reactive ally-charge grant ever needs
                faction scoping. */}
            <Select
                label="Target"
                value={ability.target}
                options={targetOptionsForSelect}
                onChange={(value) => {
                    // #363: factionFilter is a RECIPIENT scope, so it hangs off the TARGET axis
                    // (not the trigger axis roleFilter uses). Strip it when the new target cannot
                    // carry one — a faction predicate on 'self' or an enemy scope is meaningless,
                    // and a stale key would silently narrow nothing while looking meaningful.
                    const target = value as AbilityTarget;
                    // `recipientFilter` hangs off the TARGET axis for the same reason
                    // `factionFilter` does — it narrows a RECIPIENT SET — so it is dropped by the
                    // same rule when the new target has no recipient set to narrow. Left in
                    // place, a "has Stealth" predicate re-pointed at 'self' would quietly become
                    // a self-mute the editor gives no way to see.
                    const { factionFilter, recipientFilter, ...rest } = ability;
                    const keepsRecipientScope = FACTION_FILTERABLE_TARGETS.has(target);
                    onChange({
                        ...rest,
                        ...(keepsRecipientScope &&
                        factionFilterHonoredForType &&
                        factionFilter !== undefined
                            ? { factionFilter }
                            : {}),
                        ...(keepsRecipientScope && recipientFilter !== undefined
                            ? { recipientFilter }
                            : {}),
                        target,
                    });
                }}
            />

            {FACTION_FILTERABLE_TARGETS.has(ability.target) && factionFilterHonoredForType && (
                <CheckboxGroup
                    label="Recipient faction filter"
                    helpLabel="Empty = any ally. Otherwise only allies of the chosen factions receive this, on top of the ship's targeting pattern."
                    options={FACTION_FILTER_OPTIONS}
                    values={ability.factionFilter ?? []}
                    onChange={(values) => {
                        // Empty selection normalizes to an ABSENT key (any ally), never an empty
                        // array, so the stored ability stays canonical — same rule as roleFilter.
                        if (values.length === 0) {
                            const { factionFilter: _removed, ...rest } = ability;
                            onChange(rest);
                        } else {
                            onChange({ ...ability, factionFilter: values as FactionKey[] });
                        }
                    }}
                />
            )}

            {(ability.type === 'buff' ||
                ability.type === 'debuff' ||
                ability.type === 'dot' ||
                ability.type === 'charge' ||
                ability.type === 'heal' ||
                ability.type === 'shield' ||
                ability.type === 'cleanse' ||
                // Reactive damage procs (Grif's on-enemy-cleansed "75% Damage") need the trigger
                // editor too. A plain on-cast damage now shows the Trigger dropdown (defaulting to
                // on-cast) — acceptable and consistent with every other type.
                ability.type === 'damage') && (
                <>
                    <Select
                        label="Trigger"
                        value={ability.trigger}
                        options={TRIGGER_OPTIONS}
                        onChange={(value) => {
                            // triggerCritFilter applies to the attacked family (on-attacked +
                            // on-ally-attacked, same engine contract); roleFilter and
                            // requireDamagedAllyStatus (#363, Fuying's "when an ally in Stealth
                            // is directly damaged") only to on-ally-attacked — both filter on the
                            // DAMAGED ally, which no other trigger has. Strip whatever the new
                            // trigger doesn't support so the stored ability stays canonical.
                            const trigger = value as AbilityTrigger;
                            const {
                                triggerCritFilter,
                                roleFilter,
                                requireDamagedAllyStatus,
                                ...rest
                            } = ability;
                            const keepCritFilter =
                                trigger === 'on-attacked' || trigger === 'on-ally-attacked';
                            const keepAllyFilters = trigger === 'on-ally-attacked';
                            onChange({
                                ...rest,
                                ...(keepCritFilter && triggerCritFilter !== undefined
                                    ? { triggerCritFilter }
                                    : {}),
                                ...(keepAllyFilters && roleFilter !== undefined
                                    ? { roleFilter }
                                    : {}),
                                ...(keepAllyFilters && requireDamagedAllyStatus !== undefined
                                    ? { requireDamagedAllyStatus }
                                    : {}),
                                trigger,
                            });
                        }}
                    />
                    {ability.trigger !== 'on-cast' && !LIVE_TRIGGERS.has(ability.trigger) && (
                        <p className="text-xs text-theme-text-secondary">
                            Not simulated — treated as assume-active
                        </p>
                    )}
                    {ability.trigger === 'on-hp-threshold-crossed' && (
                        <p className="text-xs text-theme-text-secondary">
                            The threshold comes from a self HP-threshold condition below — without
                            one the reaction stays dormant.
                        </p>
                    )}
                    {(ability.trigger === 'on-attacked' ||
                        ability.trigger === 'on-ally-attacked') && (
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
                                    onChange(rest);
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
                    {ability.trigger === 'on-ally-attacked' && (
                        <CheckboxGroup
                            label="Ally role filter"
                            helpLabel="Empty = reacts to any ally. Categories match all variants (Debuffer covers every Debuffer subtype)."
                            options={ROLE_FILTER_OPTIONS}
                            values={ability.roleFilter ?? []}
                            onChange={(values) => {
                                // Empty selection normalizes to an ABSENT key (any ally),
                                // never an empty array, so the stored ability stays canonical.
                                if (values.length === 0) {
                                    const { roleFilter: _removed, ...rest } = ability;
                                    onChange(rest);
                                } else {
                                    onChange({
                                        ...ability,
                                        roleFilter: values as ShipRoleCategory[],
                                    });
                                }
                            }}
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
