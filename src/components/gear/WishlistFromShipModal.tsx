import React, { useMemo, useState } from 'react';
import { getGearSet, type GearSetName } from '../../constants/gearSets';
import { useAutogearConfig } from '../../contexts/AutogearConfigContext';
import { useGearWishlistContext } from '../../contexts/GearWishlistProvider';
import { useShips } from '../../contexts/ShipsContext';
import { useNotification } from '../../hooks/useNotification';
import type { SavedAutogearConfig } from '../../types/autogear';
import type { Ship } from '../../types/ship';
import {
    buildEntriesFromAutogearConfig,
    wantedSets,
    wantedStats,
    type WishlistDraft,
} from '../../utils/wishlist/buildEntriesFromAutogearConfig';
import { WISHLIST_NAME_MAX_LENGTH } from '../../utils/wishlist/describeWishlistEntry';
import { wishlistGroupName } from '../../utils/wishlist/groupWishlistEntries';
import { ShipSelector } from '../ship/ShipSelector';
import { Button, Callout, Checkbox, Input, Modal, Select, ToggleChipGroup } from '../ui';
import { Loader } from '../ui/Loader';
import { WishlistFilterChips } from './WishlistFilterChips';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

/** Builds wishlist entries for a ship from its saved autogear config (`buildEntriesFromAutogearConfig`). */
export const WishlistFromShipModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const { ships } = useShips();
    const { getConfig, loading } = useAutogearConfig();
    const [shipId, setShipId] = useState<string | null>(null);
    const ship = ships.find((s) => s.id === shipId) ?? null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Wishlist entries from a ship">
            <div className="space-y-4">
                <ShipSelector selected={ship} onSelect={(s) => setShipId(s.id)} />
                {ship &&
                    (loading ? (
                        <Loader />
                    ) : (
                        <ShipEntriesPreview
                            key={ship.id}
                            ship={ship}
                            config={getConfig(ship.id)}
                            onDone={onClose}
                        />
                    ))}
            </div>
        </Modal>
    );
};

function ShipEntriesPreview({
    ship,
    config,
    onDone,
}: {
    ship: Ship;
    config: SavedAutogearConfig | null;
    onDone: () => void;
}) {
    const { entries, addEntries } = useGearWishlistContext();
    const { addNotification } = useNotification();
    const stats = useMemo(() => wantedStats(ship, config), [ship, config]);
    const allSets = useMemo(() => wantedSets(ship, config), [ship, config]);
    const [sets, setSets] = useState<GearSetName[]>(allSets);
    const [subStatsMin, setSubStatsMin] = useState(Math.min(2, stats.length));
    const defaults = useMemo(() => buildEntriesFromAutogearConfig(ship, config), [ship, config]);
    const [names, setNames] = useState({ top: defaults.top.name, bottom: defaults.bottom.name });
    const [ticked, setTicked] = useState({ top: true, bottom: true });
    const [saving, setSaving] = useState(false);

    const drafts = buildEntriesFromAutogearConfig(ship, config, { subStatsMin, sets });
    const group = defaults.top.group ?? null;
    const replaceIds = entries
        .filter(
            (e) =>
                e.source === 'autogear' &&
                e.target?.kind === 'ship' &&
                e.target.shipId === ship.id &&
                wishlistGroupName(e) === group
        )
        .map((e) => e.id);

    const rows = [
        { key: 'top', label: 'Weapon, hull and generator', draft: drafts.top },
        { key: 'bottom', label: 'Sensor, software and thrusters', draft: drafts.bottom },
    ] as const;

    const handleCreate = async () => {
        const chosen: WishlistDraft[] = rows
            .filter(({ key }) => ticked[key])
            .map(({ key, draft }) => ({
                ...draft,
                name: names[key].trim().slice(0, WISHLIST_NAME_MAX_LENGTH) || draft.name,
            }));
        setSaving(true);
        try {
            await addEntries(chosen, replaceIds);
            onDone();
        } catch {
            addNotification('error', 'Could not save the wishlist entries. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            {!config && (
                <Callout variant="tip" title="Note">
                    {ship.name} has no saved autogear settings, so these entries use the ship&apos;s
                    role defaults.
                </Callout>
            )}

            {stats.length > 0 && (
                <Select
                    label="At least N of these substats"
                    value={String(subStatsMin)}
                    onChange={(value) => setSubStatsMin(Number(value))}
                    options={stats.map((_, i) => ({
                        value: String(i + 1),
                        label: `${i + 1} of ${stats.length}`,
                    }))}
                    helpLabel="How many of the wanted substats a piece needs to match. Lower finds more pieces; higher finds better ones."
                />
            )}

            {allSets.length > 0 && (
                <ToggleChipGroup
                    label="Gear sets (any of)"
                    values={sets}
                    onChange={(values) => setSets(allSets.filter((s) => values.includes(s)))}
                    options={allSets.map((s) => ({ value: s, label: getGearSet(s)?.name ?? s }))}
                />
            )}

            {rows.map(({ key, label, draft }) => (
                <div key={key} className="card space-y-2">
                    <Checkbox
                        id={`wishlist-from-ship-${key}`}
                        label={label}
                        checked={ticked[key]}
                        onChange={(checked) => setTicked((prev) => ({ ...prev, [key]: checked }))}
                    />
                    <Input
                        aria-label={`${label} entry name`}
                        value={names[key]}
                        maxLength={WISHLIST_NAME_MAX_LENGTH}
                        disabled={!ticked[key]}
                        onChange={(e) => {
                            const value = e.target.value;
                            setNames((prev) => ({ ...prev, [key]: value }));
                        }}
                    />
                    <WishlistFilterChips entry={{ ...draft, id: key }} />
                </div>
            ))}

            {replaceIds.length > 0 && (
                <p className="text-sm text-theme-text-secondary">
                    Replaces the {replaceIds.length} {replaceIds.length === 1 ? 'entry' : 'entries'}{' '}
                    made for {ship.name} earlier. Entries you made yourself in the group are kept.
                </p>
            )}

            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="primary"
                    disabled={saving || (!ticked.top && !ticked.bottom)}
                    onClick={() => void handleCreate()}
                >
                    Create
                </Button>
                <Button type="button" variant="secondary" onClick={onDone}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}
