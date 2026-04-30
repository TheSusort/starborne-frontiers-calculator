import React from 'react';
import { Modal } from '../ui/layout/Modal';
import { ImportDiff } from '../../types/importDiff';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { RARITIES } from '../../constants/rarities';
import { GEAR_SLOTS, IMPLANT_SLOTS } from '../../constants/gearTypes';
import { GEAR_SETS } from '../../constants/gearSets';
import { IMPLANTS } from '../../constants/implants';
import { STATS } from '../../constants/stats';
import { hasChanges } from '../../utils/import/computeImportDiff';

interface Props {
    diff: ImportDiff | null;
    fileTimestamp: number | null;
    onClose: () => void;
}

function formatFileAge(timestamp: number): string {
    const days = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'from today';
    if (days === 1) return '1 day old';
    return `${days} days old`;
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
    const setIcon = gear.setBonus ? GEAR_SETS[gear.setBonus]?.iconUrl : null;
    const setName = gear.setBonus ? GEAR_SETS[gear.setBonus]?.name : null;
    const rarityLabel = RARITIES[gear.rarity]?.label ?? gear.rarity;
    const mainStatLabel = gear.mainStat
        ? (STATS[gear.mainStat.name]?.shortLabel ?? gear.mainStat.name) +
          (gear.mainStat.type === 'percentage' ? '%' : '')
        : null;
    return (
        <div className="flex items-center gap-2 text-sm py-0.5">
            <Stars count={gear.stars} />
            <span className={RARITIES[gear.rarity]?.textColor}>{rarityLabel}</span>
            <span className="text-theme-text">{slotLabel}</span>
            {mainStatLabel && (
                <span className="text-theme-text-secondary text-xs">{mainStatLabel}</span>
            )}
            {setIcon && (
                <img src={setIcon} alt={setName ?? ''} className="w-4 h-4 object-contain" />
            )}
            <span className="text-green-400 text-xs">(new)</span>
        </div>
    );
}

function ImplantLine({ implant }: { implant: GearPiece }) {
    const implantName = IMPLANTS[implant.setBonus ?? '']?.name ?? implant.setBonus ?? implant.slot;
    const slotLabel = IMPLANT_SLOTS[implant.slot]?.label ?? implant.slot;
    return (
        <div className="flex items-center gap-2 text-sm py-0.5">
            <Stars count={implant.stars} />
            <span className={RARITIES[implant.rarity]?.textColor}>
                {RARITIES[implant.rarity]?.label ?? implant.rarity}
            </span>
            <span className="text-theme-text">{implantName}</span>
            <span className="text-theme-text-secondary text-xs">{slotLabel}</span>
            <span className="text-green-400 text-xs">(new)</span>
        </div>
    );
}

export const ImportDiffModal: React.FC<Props> = ({ diff, fileTimestamp, onClose }) => {
    if (!diff) return null;

    const { ships, gear, implants } = diff;

    const fileAgeNote = fileTimestamp !== null ? formatFileAge(fileTimestamp) : null;

    if (diff.isFreshImport) {
        const totalShips = ships.legendary.added.length + ships.epic.added + ships.otherAdded;
        const parts: string[] = [];
        if (totalShips > 0) parts.push(`${totalShips} ships`);
        if (gear.added > 0) parts.push(`${gear.added} gear`);
        if (implants.added > 0) parts.push(`${implants.added} implants`);
        if (diff.engineeringStatsCount > 0)
            parts.push(`${diff.engineeringStatsCount} engineering stats`);

        return (
            <Modal isOpen={true} onClose={onClose} title="Import Complete" maxWidth="max-w-sm">
                <p className="text-sm text-theme-text-secondary">{parts.join(' · ')}</p>
                {fileAgeNote && (
                    <p className="text-xs text-theme-text-secondary mt-2">{fileAgeNote}</p>
                )}
            </Modal>
        );
    }

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

    const hasOtherChanges = ships.otherAdded > 0 || ships.otherRemoved > 0;
    const hasShipChanges = hasLegendaryChanges || hasEpicChanges || hasOtherChanges;
    const hasGearChanges = gear.added > 0 || gear.removed > 0 || gear.newLegendary6Star.length > 0;
    const hasImplantChanges =
        implants.added > 0 || implants.removed > 0 || implants.newLegendary.length > 0;

    return (
        <Modal isOpen={true} onClose={onClose} title="Import Complete" maxWidth="max-w-sm">
            {fileAgeNote && <p className="text-xs text-theme-text-secondary mb-3">{fileAgeNote}</p>}
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
                                                <div
                                                    key={s.id}
                                                    className="flex items-baseline gap-2"
                                                >
                                                    <ShipName ship={s} />
                                                    <span className="text-green-400 text-xs">
                                                        (new)
                                                    </span>
                                                </div>
                                            ))}
                                            {ships.legendary.leveled.map(({ ship, oldLevel }) => (
                                                <div
                                                    key={`lv-${ship.id}`}
                                                    className="flex items-baseline gap-2"
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
                                                        className="flex items-baseline gap-2"
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
                                                    className="flex items-baseline gap-2"
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
                                                    className="flex items-baseline gap-2"
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
                                                    className="flex items-baseline gap-2"
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
                                        <div className="text-theme-text-secondary text-xs mt-1">
                                            {ships.otherAdded > 0 && (
                                                <span className="text-green-400">
                                                    +{ships.otherAdded} new
                                                </span>
                                            )}
                                            {ships.otherAdded > 0 && ships.otherRemoved > 0 && (
                                                <span> · </span>
                                            )}
                                            {ships.otherRemoved > 0 && (
                                                <span className="text-red-400">
                                                    -{ships.otherRemoved} removed
                                                </span>
                                            )}
                                        </div>
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

                    {/* Implants */}
                    {hasImplantChanges && (
                        <div>
                            <h4 className="text-sm font-semibold text-theme-text uppercase tracking-wide mb-2">
                                Implants
                            </h4>
                            {(implants.added > 0 || implants.removed > 0) && (
                                <p className="text-sm text-theme-text-secondary mb-2">
                                    {implants.added > 0 && (
                                        <span className="text-green-400">
                                            +{implants.added} pieces
                                        </span>
                                    )}
                                    {implants.added > 0 && implants.removed > 0 && ' / '}
                                    {implants.removed > 0 && (
                                        <span className="text-red-400">
                                            -{implants.removed} pieces
                                        </span>
                                    )}
                                </p>
                            )}
                            {implants.newLegendary.map((g) => (
                                <ImplantLine key={g.id} implant={g} />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
};
