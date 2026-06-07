import React from 'react';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { Ship } from '../../types/ship';
import { ShipSelector } from '../ship/ShipSelector';
import { useShips } from '../../contexts/ShipsContext';

export interface HealTargetState {
    /** When true, the healer heals itself (healTargetId 'healer') and no extra actor enters. */
    useHealerAsTarget: boolean;
    shipId?: string;
    hp: number;
    defence: number;
    speed: number;
}

interface HealTargetPanelProps {
    isOpen: boolean;
    onToggle: () => void;
    target: HealTargetState;
    onUseHealerAsTargetChange: (checked: boolean) => void;
    onSelectShip: (ship: Ship) => void;
    onHpChange: (v: number) => void;
    onDefenceChange: (v: number) => void;
    onSpeedChange: (v: number) => void;
}

export const HealTargetPanel: React.FC<HealTargetPanelProps> = ({
    isOpen,
    onToggle,
    target,
    onUseHealerAsTargetChange,
    onSelectShip,
    onHpChange,
    onDefenceChange,
    onSpeedChange,
}) => {
    const { getShipById } = useShips();
    const selectedShip = target.shipId ? getShipById(target.shipId) : undefined;

    return (
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
                    <span className="text-lg font-bold">Heal Target</span>
                </span>
            </Button>
            <CollapsibleForm isVisible={isOpen}>
                <div className="space-y-4 pt-2">
                    <p className="text-sm text-theme-text-secondary">
                        The actor the enemies bombard. Healing effectiveness depends on how much of
                        the raw healing the target can actually absorb.
                    </p>
                    <Checkbox
                        id="use-healer-as-target"
                        label="Use healer as target (heal self)"
                        checked={target.useHealerAsTarget}
                        onChange={onUseHealerAsTargetChange}
                    />
                    {!target.useHealerAsTarget && (
                        <div className="space-y-4">
                            <ShipSelector
                                selected={selectedShip ?? null}
                                onSelect={onSelectShip}
                                variant="compact"
                            />
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <Input
                                    label="Target HP"
                                    type="number"
                                    min="0"
                                    value={target.hp}
                                    onChange={(e) => onHpChange(parseInt(e.target.value) || 0)}
                                />
                                <Input
                                    label="Target Defense"
                                    type="number"
                                    min="0"
                                    value={target.defence}
                                    onChange={(e) => onDefenceChange(parseInt(e.target.value) || 0)}
                                />
                                <Input
                                    label="Target Speed"
                                    type="number"
                                    min="0"
                                    value={target.speed}
                                    onChange={(e) =>
                                        onSpeedChange(Math.max(0, parseInt(e.target.value) || 0))
                                    }
                                />
                            </div>
                            {selectedShip && (
                                <p className="text-xs text-theme-text-secondary">
                                    The target enters the simulation as a team actor and walks its
                                    own kit (its self-heals and buffs apply).
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </CollapsibleForm>
        </div>
    );
};
