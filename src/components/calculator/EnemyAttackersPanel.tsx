import React from 'react';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { Ship } from '../../types/ship';
import { ShipSkills } from '../../types/abilities';
import { ShipSelector } from '../ship/ShipSelector';
import { CloseIcon } from '../ui';
import { useShips } from '../../contexts/ShipsContext';

/** UI state for one enemy attacker card. Maps to EnemyAttackerInput at sim time. */
export interface EnemyAttackerConfig {
    id: string;
    name: string;
    shipId?: string;
    attack: number;
    crit: number;
    critDamage: number;
    speed: number;
    chargeCount: number;
    startCharged: boolean;
    /** Walked basics for the damage walk; present only when a ship is picked. */
    shipSkills?: ShipSkills;
}

export const MAX_ENEMY_ATTACKERS = 4;

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
    onRemove: () => void;
    onSelectShip: (ship: Ship) => void;
    onUpdate: (updates: Partial<EnemyAttackerConfig>) => void;
}> = ({ enemy, onRemove, onSelectShip, onUpdate }) => {
    const { getShipById } = useShips();
    const selectedShip = enemy.shipId ? getShipById(enemy.shipId) : undefined;

    return (
        <div className="p-4 bg-dark border border-dark-border space-y-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                    <ShipSelector
                        selected={selectedShip ?? null}
                        onSelect={onSelectShip}
                        variant="compact"
                    />
                </div>
                <Button variant="danger" onClick={onRemove} aria-label="Remove enemy attacker">
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
                <span className="text-lg font-bold">
                    Enemy Attackers ({enemies.length}/{MAX_ENEMY_ATTACKERS})
                </span>
            </span>
        </Button>
        <CollapsibleForm isVisible={isOpen}>
            <div className="space-y-4 pt-2">
                <p className="text-sm text-theme-text-secondary">
                    The enemies dealing damage to the heal target. Pick a ship to autofill its
                    offensive stats and walk its damage abilities, or enter stats manually.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {enemies.map((enemy) => (
                        <EnemyCard
                            key={enemy.id}
                            enemy={enemy}
                            onRemove={() => onRemove(enemy.id)}
                            onSelectShip={(ship) => onSelectShip(enemy.id, ship)}
                            onUpdate={(updates) => onUpdate(enemy.id, updates)}
                        />
                    ))}
                </div>
                {enemies.length < MAX_ENEMY_ATTACKERS && (
                    <Button variant="secondary" size="sm" onClick={onAdd}>
                        + Add enemy attacker
                    </Button>
                )}
            </div>
        </CollapsibleForm>
    </div>
);
