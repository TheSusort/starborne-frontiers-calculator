import React, { useState, useEffect } from 'react';
import { GEAR_SETS } from '../../constants/gearSets';
import { STATS } from '../../constants/stats';
import { useGearWishlistContext } from '../../contexts/GearWishlistProvider';
import { GearPiece } from '../../types/gear';
import { WishlistEntry } from '../../types/wishlist';
import { Button, CloseIcon, EditIcon, StarOutlineIcon } from '../ui';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { Loader } from '../ui/Loader';
import { WishlistEntryForm } from './WishlistEntryForm';
import { WishlistSearchResults } from './WishlistSearchResults';

interface Props {
    inventory: GearPiece[];
}

export const GearWishlistTab: React.FC<Props> = ({ inventory }) => {
    const { entries, loading, addEntry, updateEntry, deleteEntry } = useGearWishlistContext();
    const [editingEntry, setEditingEntry] = useState<WishlistEntry | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [showSearch, setShowSearch] = useState(false);

    useEffect(() => {
        if (entries.length === 0) setShowSearch(false);
    }, [entries.length]);

    const handleSubmit = async (data: Omit<WishlistEntry, 'id'>) => {
        if (editingEntry) {
            await updateEntry({ ...data, id: editingEntry.id });
            setEditingEntry(null);
        } else {
            await addEntry(data);
        }
        setShowForm(false);
    };

    const handleEdit = (entry: WishlistEntry) => {
        setEditingEntry(entry);
        setShowForm(true);
        setShowSearch(false);
    };

    const handleCancelForm = () => {
        setEditingEntry(null);
        setShowForm(false);
    };

    if (loading && entries.length === 0) {
        return <Loader />;
    }

    if (entries.length === 0 && !showForm) {
        return (
            <div className="card text-center py-12 flex flex-col items-center gap-4">
                <StarOutlineIcon className="w-12 h-12 text-theme-text-secondary" />
                <div>
                    <h3 className="text-lg font-semibold text-white mb-2">Start Tracking Gear</h3>
                    <p className="text-theme-text-secondary max-w-md mx-auto">
                        Add entries describing gear you&apos;re farming. The app will highlight
                        matches in the Import Summary when new gear arrives.
                    </p>
                </div>
                <Button onClick={() => setShowForm(true)} variant="primary">
                    Add Entry
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <CollapsibleForm isVisible={showForm}>
                <div className="card">
                    <h2 className="text-xl font-semibold text-white mb-4">
                        {editingEntry ? 'Edit Entry' : 'Add Entry'}
                    </h2>
                    <WishlistEntryForm
                        initial={editingEntry ?? undefined}
                        onSubmit={(data) => void handleSubmit(data)}
                        onCancel={handleCancelForm}
                    />
                </div>
            </CollapsibleForm>

            {entries.length > 0 && (
                <div className="space-y-2">
                    {entries.map((entry) => (
                        <div key={entry.id} className="card flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className="font-medium text-white truncate">{entry.name}</p>
                                <FilterChips entry={entry} />
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleEdit(entry)}
                                    aria-label="Edit entry"
                                >
                                    <EditIcon />
                                </Button>
                                <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => void deleteEntry(entry.id)}
                                    aria-label="Delete entry"
                                >
                                    <CloseIcon />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex gap-2 flex-wrap">
                {!showForm && (
                    <Button
                        variant="primary"
                        onClick={() => {
                            setEditingEntry(null);
                            setShowForm(true);
                        }}
                    >
                        Add Entry
                    </Button>
                )}
                <Button
                    variant="secondary"
                    onClick={() => setShowSearch((v) => !v)}
                    disabled={entries.length === 0}
                >
                    {showSearch ? 'Hide Results' : 'Search Inventory'}
                </Button>
            </div>

            {showSearch && <WishlistSearchResults entries={entries} inventory={inventory} />}
        </div>
    );
};

function FilterChips({ entry }: { entry: WishlistEntry }) {
    const chips: string[] = [];
    const { filters } = entry;
    if (filters.slot) chips.push(filters.slot);
    if (filters.stars !== undefined) chips.push(`${filters.stars}★+`);
    if (filters.rarity) chips.push(filters.rarity);
    if (filters.setBonus) chips.push(GEAR_SETS[filters.setBonus]?.name ?? filters.setBonus);
    if (filters.mainStat) chips.push(STATS[filters.mainStat.name]?.label ?? filters.mainStat.name);
    if (filters.subStats?.length) {
        chips.push(filters.subStats.map((s) => STATS[s.name]?.shortLabel ?? s.name).join(' + '));
    }

    if (chips.length === 0) {
        return <p className="text-xs text-theme-text-secondary">No filters — matches everything</p>;
    }

    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {chips.map((chip) => (
                <span
                    key={chip}
                    className="text-xs px-2 py-0.5 bg-dark-lighter border border-dark-border text-theme-text-secondary"
                >
                    {chip}
                </span>
            ))}
        </div>
    );
}
