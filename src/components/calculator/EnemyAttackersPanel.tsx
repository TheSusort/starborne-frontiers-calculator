import React from 'react';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { Select } from '../ui/Select';
import { Ship, AffinityName } from '../../types/ship';
import { ShipSkills } from '../../types/abilities';
import type { Position } from '../../types/encounters';
import { AFFINITY_OPTIONS } from '../../constants/affinities';
import { ShipSelector } from '../ship/ShipSelector';
import { CloseIcon } from '../ui';
import { useShips } from '../../contexts/ShipsContext';
import { SlotSelect } from './SlotSelect';

/** UI state for one enemy attacker card. Maps to EnemyAttackerInput at sim time. */
export interface EnemyAttackerConfig {
    id: string;
    name: string;
    shipId?: string;
    attack: number;
    crit: number;
    critDamage: number;
    speed: number;
    /** Enemy hacking — drives inbound debuff landing chance vs the heal target's security. */
    hacking: number;
    chargeCount: number;
    startCharged: boolean;
    /** Affinity for the matchup vs the heal target. Default 'antimatter' (neutral when the
     *  target's affinity is unknown). */
    affinity?: AffinityName;
    /** Walked basics for the damage walk; present only when a ship is picked. */
    shipSkills?: ShipSkills;
    /** Board slot. Column 4 is the FRONT. Seeded by defaultEnemySlot(index). */
    position: Position;
    /** Enemy's own max HP — it can now be destroyed. Never 0, defaulted OR entered: a 0-HP enemy is
     *  already dead, so the healer's cast delivers nothing to it and every `damage-dealt` rider
     *  silently pays out zero. The HP field clamps to 1 for exactly this reason. */
    hp: number;
    /** Enemy's own defence — the basis for the healer's damage-dealt riders. */
    defence: number;
    /** Enemy's own security — resists the healer's outbound debuffs. */
    security: number;
}

interface EnemyAttackersPanelProps {
    isOpen: boolean;
    onToggle: () => void;
    enemies: EnemyAttackerConfig[];
    onAdd: () => void;
    onRemove: (id: string) => void;
    onSelectShip: (id: string, ship: Ship) => void;
    onUpdate: (id: string, updates: Partial<EnemyAttackerConfig>) => void;
}

const EnemyCard: React.FC<{
    enemy: EnemyAttackerConfig;
    /** Cells the OTHER enemies hold — annotated in the dropdown so a collision is visible before it
     *  happens. Sides are independent boards, so only enemy cells count here. */
    takenSlots: readonly Position[];
    onRemove: () => void;
    onSelectShip: (ship: Ship) => void;
    onUpdate: (updates: Partial<EnemyAttackerConfig>) => void;
}> = ({ enemy, takenSlots, onRemove, onSelectShip, onUpdate }) => {
    const { getShipById } = useShips();
    const selectedShip = enemy.shipId ? getShipById(enemy.shipId) : undefined;

    return (
        <div className="card space-y-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                    <ShipSelector
                        selected={selectedShip ?? null}
                        onSelect={onSelectShip}
                        variant="compact"
                    />
                </div>
                <Button variant="danger" onClick={onRemove} aria-label="Remove enemy">
                    <CloseIcon />
                </Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <Input
                    label="Attack"
                    type="number"
                    min="0"
                    value={enemy.attack}
                    onChange={(e) => onUpdate({ attack: parseInt(e.target.value) || 0 })}
                />
                <Input
                    label="Speed"
                    type="number"
                    min="0"
                    value={enemy.speed}
                    onChange={(e) =>
                        onUpdate({ speed: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                />
                <Input
                    label="Crit Rate (%)"
                    type="number"
                    min="0"
                    max="100"
                    value={enemy.crit}
                    onChange={(e) => onUpdate({ crit: parseInt(e.target.value) || 0 })}
                />
                <Input
                    label="Crit Damage (%)"
                    type="number"
                    min="0"
                    value={enemy.critDamage}
                    onChange={(e) => onUpdate({ critDamage: parseInt(e.target.value) || 0 })}
                />
                <Input
                    label="Hacking"
                    type="number"
                    min="0"
                    value={enemy.hacking}
                    onChange={(e) =>
                        onUpdate({ hacking: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                    helpLabel="The enemy's hacking stat. Landing chance for its debuffs = (enemy hacking − heal-target security), clamped to 0–100%."
                />
                <Input
                    label="HP"
                    type="number"
                    // Clamped to 1, NOT 0 — the one value `EnemyAttackerConfig.hp` documents as
                    // unreachable. A 0-HP enemy enters the run already destroyed: the healer's cast
                    // delivers nothing to it and every `basis:'damage-dealt'` heal or shield rider
                    // silently pays out zero. Clearing the field yields NaN, so the `|| 1` fallback
                    // matters as much as the clamp does.
                    min="1"
                    value={enemy.hp}
                    onChange={(e) => onUpdate({ hp: Math.max(1, parseInt(e.target.value) || 1) })}
                    helpLabel="The enemy's own max HP. It can be destroyed, and a destroyed enemy stops attacking. Minimum 1 — an enemy with 0 HP would start the fight already destroyed."
                />
                <Input
                    label="Defence"
                    type="number"
                    min="0"
                    value={enemy.defence}
                    onChange={(e) =>
                        onUpdate({ defence: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                    helpLabel="The enemy's own defence — it reduces the damage your healer deals to it, which is the basis for heals and shields scaled off damage dealt."
                />
                <Input
                    label="Security"
                    type="number"
                    min="0"
                    value={enemy.security}
                    onChange={(e) =>
                        onUpdate({ security: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                    helpLabel="Resists debuffs your healer applies."
                />
                <Input
                    label="Charge Count"
                    type="number"
                    min="0"
                    value={enemy.chargeCount}
                    onChange={(e) => onUpdate({ chargeCount: parseInt(e.target.value) || 0 })}
                />
                <div className="flex items-end">
                    <Checkbox
                        id={`enemy-start-charged-${enemy.id}`}
                        label="Start Charged"
                        checked={enemy.startCharged}
                        onChange={(checked) => onUpdate({ startCharged: checked })}
                    />
                </div>
            </div>
            <SlotSelect
                value={enemy.position}
                onChange={(position) => onUpdate({ position })}
                taken={takenSlots}
                helpLabel="Column 4 is the front of the board. Two enemies cannot share a cell — a collision moves the later one."
            />
            <Select
                label="Affinity"
                value={enemy.affinity ?? 'antimatter'}
                onChange={(v) => onUpdate({ affinity: v as AffinityName })}
                options={AFFINITY_OPTIONS}
                className="w-full"
                helpLabel="The enemy's affinity vs the heal target — drives the damage matchup."
            />
            {selectedShip && (
                <p className="text-xs text-theme-text-secondary">
                    Damage abilities are simulated; other abilities are not yet.
                </p>
            )}
        </div>
    );
};

export const EnemyAttackersPanel: React.FC<EnemyAttackersPanelProps> = ({
    isOpen,
    onToggle,
    enemies,
    onAdd,
    onRemove,
    onSelectShip,
    onUpdate,
}) => (
    <div className="card space-y-2">
        <Button
            variant="link"
            onClick={onToggle}
            className="w-[calc(100%+1.5rem)] flex justify-between items-center -m-3 !p-3"
        >
            <span className="flex items-center gap-2">
                <ChevronDownIcon
                    className={`h-4 w-4 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                />
                <span className="text-lg font-bold">Enemy Team ({enemies.length})</span>
            </span>
        </Button>
        <CollapsibleForm isVisible={isOpen}>
            <div className="space-y-4 pt-2">
                <p className="text-sm text-theme-text-secondary">
                    The enemy team attacking the heal target. A ship with a damage ability hits the
                    target; a support ship buffs the team. Pick a ship to autofill its stats and
                    walk its abilities, or enter stats manually.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {enemies.map((enemy) => (
                        <EnemyCard
                            key={enemy.id}
                            enemy={enemy}
                            takenSlots={enemies
                                .filter((other) => other.id !== enemy.id)
                                .map((other) => other.position)}
                            onRemove={() => onRemove(enemy.id)}
                            onSelectShip={(ship) => onSelectShip(enemy.id, ship)}
                            onUpdate={(updates) => onUpdate(enemy.id, updates)}
                        />
                    ))}
                </div>
                <Button variant="secondary" size="sm" onClick={onAdd}>
                    + Add enemy
                </Button>
            </div>
        </CollapsibleForm>
    </div>
);
