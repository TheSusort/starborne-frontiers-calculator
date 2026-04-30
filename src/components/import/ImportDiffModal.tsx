import React from 'react';
import { Modal } from '../ui/layout/Modal';
import { ImportDiff } from '../../types/importDiff';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { RARITIES } from '../../constants/rarities';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { GEAR_SETS } from '../../constants/gearSets';
import { STATS } from '../../constants/stats';
import { hasChanges } from '../../utils/import/computeImportDiff';

interface Props {
    diff: ImportDiff | null;
    onClose: () => void;
}

function Stars({ count }: { count: number }) {
    return <span className="text-yellow-400">{'★'.repeat(count)}</span>;
}

function ShipName({ ship }: { ship: Ship }) {
    const colorClass = RARITIES[ship.rarity]?.textColor ?? 'text-white';
    return <span className={colorClass}>{ship.name}</span>;
}

function GearLine({ gear }: { gear: GearPiece }) {
    const slotLabel = GEAR_SLOTS[gear.slot]?.label ?? gear.slot;
    const setName = gear.setBonus ? GEAR_SETS[gear.setBonus]?.name : null;
    const rarityLabel = RARITIES[gear.rarity]?.label ?? gear.rarity;
    const mainStatLabel = gear.mainStat
        ? (STATS[gear.mainStat.name]?.shortLabel ?? gear.mainStat.name)
        : null;
    return (
        <div className="flex items-center gap-2 text-sm py-0.5">
            <Stars count={gear.stars} />
            <span className={RARITIES[gear.rarity]?.textColor}>{rarityLabel}</span>
            <span className="text-theme-text">{slotLabel}</span>
            {mainStatLabel && (
                <span className="text-theme-text-secondary text-xs">{mainStatLabel}</span>
            )}
            {setName && <span className="text-theme-text-secondary">[{setName}]</span>}
            <span className="text-green-400 text-xs">(new)</span>
        </div>
    );
}

export const ImportDiffModal: React.FC<Props> = ({ diff, onClose }) => {
    if (!diff) return null;

    const { ships, gear } = diff;

    const hasLegendaryChanges =
        ships.legendary.added.length > 0 ||
        ships.legendary.leveled.length > 0 ||
        ships.legendary.refitted.length > 0 ||
        ships.legendary.removed.length > 0;

    const hasEpicChanges =
        ships.epic.leveled.length > 0 ||
        ships.epic.refitted.length > 0 ||
        ships.epic.added > 0 ||
        ships.epic.removed > 0;

    const hasOtherChanges = ships.otherDelta !== 0;
    const hasShipChanges = hasLegendaryChanges || hasEpicChanges || hasOtherChanges;
    const hasGearChanges = gear.added > 0 || gear.removed > 0 || gear.newLegendary6Star.length > 0;

    return (
        <Modal isOpen={true} onClose={onClose} title="Import Complete">
            {!hasChanges(diff) ? (
                <p className="text-theme-text-secondary">No changes detected.</p>
            ) : (
                <div className="space-y-4">
                    {/* Ships */}
                    {hasShipChanges && (
                        <div>
                            <h4 className="text-sm font-semibold text-theme-text uppercase tracking-wide mb-2">
                                Ships
                            </h4>
                            <div className="space-y-3">
                                {/* Legendary */}
                                {hasLegendaryChanges && (
                                    <div>
                                        <div className="text-xs text-theme-text-secondary uppercase tracking-wider mb-1 border-b border-dark-border pb-0.5">
                                            Legendary
                                        </div>
                                        <div className="space-y-0.5 text-sm">
                                            {ships.legendary.added.map((s) => (
                                                <div key={s.id} className="flex justify-between">
                                                    <ShipName ship={s} />
                                                    <span className="text-green-400 text-xs">
                                                        (new)
                                                    </span>
                                                </div>
                                            ))}
                                            {ships.legendary.leveled.map(({ ship, oldLevel }) => (
                                                <div
                                                    key={`lv-${ship.id}`}
                                                    className="flex justify-between"
                                                >
                                                    <ShipName ship={ship} />
                                                    <span className="text-theme-text-secondary text-xs">
                                                        {oldLevel} → {ship.level}
                                                    </span>
                                                </div>
                                            ))}
                                            {ships.legendary.refitted.map(
                                                ({ ship, oldRefitCount }) => (
                                                    <div
                                                        key={`rf-${ship.id}`}
                                                        className="flex justify-between"
                                                    >
                                                        <ShipName ship={ship} />
                                                        <span className="text-theme-text-secondary text-xs">
                                                            R{oldRefitCount} → R{ship.refits.length}
                                                        </span>
                                                    </div>
                                                )
                                            )}
                                            {ships.legendary.removed.map((s) => (
                                                <div
                                                    key={`rm-${s.id}`}
                                                    className="flex justify-between"
                                                >
                                                    <span className={RARITIES[s.rarity]?.textColor}>
                                                        {s.name}
                                                    </span>
                                                    <span className="text-red-400 text-xs">
                                                        (lost)
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Epic */}
                                {hasEpicChanges && (
                                    <div>
                                        <div className="text-xs text-theme-text-secondary uppercase tracking-wider mb-1 border-b border-dark-border pb-0.5">
                                            Epic
                                        </div>
                                        <div className="space-y-0.5 text-sm">
                                            {ships.epic.leveled.map(({ ship, oldLevel }) => (
                                                <div
                                                    key={`ep-lv-${ship.id}`}
                                                    className="flex justify-between"
                                                >
                                                    <ShipName ship={ship} />
                                                    <span className="text-theme-text-secondary text-xs">
                                                        {oldLevel} → {ship.level}
                                                    </span>
                                                </div>
                                            ))}
                                            {ships.epic.refitted.map(({ ship, oldRefitCount }) => (
                                                <div
                                                    key={`ep-rf-${ship.id}`}
                                                    className="flex justify-between"
                                                >
                                                    <ShipName ship={ship} />
                                                    <span className="text-theme-text-secondary text-xs">
                                                        R{oldRefitCount} → R{ship.refits.length}
                                                    </span>
                                                </div>
                                            ))}
                                            {(ships.epic.added > 0 || ships.epic.removed > 0) && (
                                                <div className="text-theme-text-secondary text-xs mt-1">
                                                    {ships.epic.added > 0 && (
                                                        <span className="text-green-400">
                                                            +{ships.epic.added} new
                                                        </span>
                                                    )}
                                                    {ships.epic.added > 0 &&
                                                        ships.epic.removed > 0 && <span> · </span>}
                                                    {ships.epic.removed > 0 && (
                                                        <span className="text-red-400">
                                                            -{ships.epic.removed} removed
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Other */}
                                {hasOtherChanges && (
                                    <div>
                                        <div className="text-xs text-theme-text-secondary uppercase tracking-wider mb-1 border-b border-dark-border pb-0.5">
                                            Other
                                        </div>
                                        <span className="text-sm text-theme-text-secondary">
                                            {ships.otherDelta > 0 ? '+' : ''}
                                            {ships.otherDelta} ships
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Gear */}
                    {hasGearChanges && (
                        <div>
                            <h4 className="text-sm font-semibold text-theme-text uppercase tracking-wide mb-2">
                                Gear
                            </h4>
                            {(gear.added > 0 || gear.removed > 0) && (
                                <p className="text-sm text-theme-text-secondary mb-2">
                                    {gear.added > 0 && (
                                        <span className="text-green-400">+{gear.added} pieces</span>
                                    )}
                                    {gear.added > 0 && gear.removed > 0 && ' / '}
                                    {gear.removed > 0 && (
                                        <span className="text-red-400">-{gear.removed} pieces</span>
                                    )}
                                </p>
                            )}
                            {gear.newLegendary6Star.map((g) => (
                                <GearLine key={g.id} gear={g} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
};
