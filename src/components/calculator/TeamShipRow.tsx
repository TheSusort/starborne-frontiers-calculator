import React, { useState, useEffect } from 'react';
import { Ship } from '../../types/ship';
import { TeamShipConfig, SelectedGameBuff } from '../../types/calculator';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../ui/icons/ChevronIcons';
import { CloseIcon } from '../ui';
import { useShips } from '../../contexts/ShipsContext';
import { ShipSelector } from '../ship/ShipSelector';
import { ShipSkillList } from '../ship/ShipSkillList';
import { GameBuffPicker } from './GameBuffPicker';

interface TeamShipRowProps {
    config: TeamShipConfig;
    onRemove: () => void;
    onSelectShip: (ship: Ship) => void;
    onStartChargedChange: (checked: boolean) => void;
    onBuffsChange: (buffs: SelectedGameBuff[]) => void;
    onEnemyDebuffsChange: (debuffs: SelectedGameBuff[]) => void;
}

export const TeamShipRow: React.FC<TeamShipRowProps> = ({
    config,
    onRemove,
    onSelectShip,
    onStartChargedChange,
    onBuffsChange,
    onEnemyDebuffsChange,
}) => {
    const [expanded, setExpanded] = useState(false);
    const [skillRefOpen, setSkillRefOpen] = useState(false);
    const { getShipById } = useShips();
    const selectedShip = config.shipId ? getShipById(config.shipId) : undefined;

    useEffect(() => {
        if (!selectedShip) setSkillRefOpen(false);
    }, [selectedShip]);

    return (
        <div className="card space-y-2">
            {/* Header row */}
            <div className="flex items-center gap-2">
                <div className="flex-1">
                    <ShipSelector
                        selected={selectedShip ?? null}
                        onSelect={onSelectShip}
                        variant="compact"
                    />
                </div>
                <Button
                    variant="link"
                    onClick={() => setExpanded((v) => !v)}
                    aria-label="Toggle team ship details"
                >
                    <ChevronDownIcon
                        className={`h-4 w-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
                    />
                </Button>
                <Button variant="danger" size="sm" onClick={onRemove} aria-label="Remove team ship">
                    <CloseIcon />
                </Button>
            </div>

            {/* Expanded body */}
            <CollapsibleForm isVisible={expanded}>
                <div className="space-y-4 pt-2">
                    {/* Skill Reference */}
                    {selectedShip && (
                        <>
                            <Button
                                variant="link"
                                onClick={() => setSkillRefOpen((v) => !v)}
                                className="w-full flex justify-between items-center mt-4 border-b border-dark-border pb-4 mb-4"
                            >
                                <span className="flex items-center gap-2">
                                    <ChevronDownIcon
                                        className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${skillRefOpen ? 'rotate-180' : ''}`}
                                    />
                                    Skill Reference
                                </span>
                            </Button>
                            <CollapsibleForm isVisible={skillRefOpen}>
                                <div className="pt-2 pb-4 border-b border-dark-border">
                                    <ShipSkillList ship={selectedShip} />
                                </div>
                            </CollapsibleForm>
                        </>
                    )}

                    {/* Start Charged */}
                    <Checkbox
                        id={`team-start-charged-${config.id}`}
                        label="Start Charged"
                        checked={config.startCharged}
                        onChange={onStartChargedChange}
                    />

                    {/* Ship Buffs */}
                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mt-4 mb-2">
                        Ship Buffs
                    </div>
                    <GameBuffPicker
                        label="Ship Buffs"
                        relevantStats={[
                            'attack',
                            'crit',
                            'critDamage',
                            'outgoingDamage',
                            'defensePenetration',
                            'dotDamage',
                        ]}
                        excludeTypes={['effect']}
                        value={config.buffs}
                        onChange={onBuffsChange}
                    />

                    {/* Applied Enemy Debuffs */}
                    <div className="text-xs font-semibold text-primary uppercase tracking-wide mt-4 mb-2">
                        Applied Enemy Debuffs
                    </div>
                    <GameBuffPicker
                        label="Applied Enemy Debuffs"
                        relevantStats={['defense', 'incomingDamage', 'incomingDotDamage']}
                        excludeTypes={['effect']}
                        value={config.enemyDebuffs}
                        onChange={onEnemyDebuffsChange}
                    />
                </div>
            </CollapsibleForm>
        </div>
    );
};
