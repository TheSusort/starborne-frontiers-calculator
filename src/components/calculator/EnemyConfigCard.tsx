import React from 'react';
import { Ship } from '../../types/ship';
import { EnemyShipConfig, EnemyShipConfigNumericField } from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { ShipSelector } from '../ship/ShipSelector';
import { Input } from '../ui/Input';
import { SkillSlotList } from '../skills/SkillSlotList';

interface EnemyConfigCardProps {
    config: EnemyShipConfig;
    onUpdate: (field: EnemyShipConfigNumericField, value: number) => void;
    onSelectShip: (ship: Ship) => void;
    /** Omit to hide the kit editor (the enemy still acts — a skill-less walked actor gets one
     *  synthesized basic attack per turn). */
    onShipSkillsChange?: (shipSkills: ShipSkills) => void;
    selectedShip?: Ship | null;
    /** Which stats to render. Omit for all of them. The DPS page passes only the offensive stats,
     *  because EnemySettingsPanel already renders defense/hp/security/speed alongside this card —
     *  rendering both would give the same stat two inputs. */
    fields?: ReadonlyArray<EnemyShipConfigNumericField>;
}

const STAT_FIELDS: ReadonlyArray<{
    field: EnemyShipConfigNumericField;
    label: string;
    helpLabel?: string;
}> = [
    { field: 'hp', label: 'HP' },
    { field: 'defense', label: 'Defense' },
    { field: 'security', label: 'Security', helpLabel: 'resists your debuff landing rolls' },
    { field: 'attack', label: 'Attack', helpLabel: 'how hard it hits back' },
    { field: 'crit', label: 'Crit' },
    { field: 'critDamage', label: 'Crit Damage' },
    { field: 'speed', label: 'Speed', helpLabel: 'decides whether it acts before you' },
];

/**
 * The DPS calculator's opponent: a real ship with its own stats and kit that takes turns and
 * fights back. Mirrors HealerConfigCard's shape (ShipSelector + labelled stat Inputs +
 * SkillSlotList) so the two calculators stay recognisably the same tool.
 */
export const EnemyConfigCard: React.FC<EnemyConfigCardProps> = ({
    config,
    onUpdate,
    onSelectShip,
    onShipSkillsChange,
    selectedShip,
    fields,
}) => (
    <div className="card space-y-4">
        <ShipSelector selected={selectedShip ?? null} onSelect={onSelectShip} variant="compact" />

        <div className="grid grid-cols-2 gap-3">
            {(fields ? STAT_FIELDS.filter((s) => fields.includes(s.field)) : STAT_FIELDS).map(
                ({ field, label, helpLabel }) => (
                    <Input
                        key={field}
                        type="number"
                        label={label}
                        value={config[field]}
                        // `|| 0` also catches a cleared input (parseInt('') === NaN), which would
                        // otherwise reach the engine's stat maths as NaN and poison every derived value.
                        onChange={(e) => onUpdate(field, parseInt(e.target.value, 10) || 0)}
                        {...(helpLabel ? { helpLabel } : {})}
                    />
                )
            )}
        </div>

        {onShipSkillsChange && (
            <SkillSlotList
                shipSkills={config.shipSkills}
                hasPassive
                ship={selectedShip ?? undefined}
                onChange={onShipSkillsChange}
            />
        )}
    </div>
);
