import React, { useState, useMemo, useEffect } from 'react';
import { getGearSet } from '../../constants/gearSets';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { RARITIES } from '../../constants/rarities';
import { useGearWishlistContext } from '../../contexts/GearWishlistProvider';
import { useNotification } from '../../hooks/useNotification';
import { GearPiece } from '../../types/gear';
import { WishlistEntry } from '../../types/wishlist';
import { matchesWishlistEntry } from '../../utils/wishlist/matchWishlistEntry';
import {
    WISHLIST_NAME_MAX_LENGTH,
    wishlistStatLabel,
} from '../../utils/wishlist/describeWishlistEntry';
import { useShips } from '../../contexts/ShipsContext';
import { useWishlistScores, type WishlistScoreRequest } from '../../hooks/useWishlistScores';
import { describeBestHit, describeWishlistTarget } from '../../utils/wishlist/wishlistScoreDisplay';
import { Button, Chip, CloseIcon, ConfirmModal, CopyIcon, EditIcon, StarOutlineIcon } from '../ui';
import { ChevronDownIcon, ChevronUpIcon } from '../ui/icons/ChevronIcons';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { Loader } from '../ui/Loader';
import { WishlistEntryForm } from './WishlistEntryForm';
import { WishlistSearchResults } from './WishlistSearchResults';

interface Props {
    inventory: GearPiece[];
    /** An entry to start the add form with, e.g. built from an Upgrade Analysis config. */
    draft?: Omit<WishlistEntry, 'id'> | null;
    onDraftHandled?: () => void;
    /** Opens Upgrade Analysis for a targeted entry. */
    onOpenInAnalysis?: (entry: WishlistEntry) => void;
}

/** Upgrade Analysis stat filters also match the main stat and either stat type; an entry's
 * substat filter does not, so a saved analysis can match fewer pieces. */
const ANALYSIS_DRAFT_NOTICE =
    'Prefilled from Upgrade Analysis. Upgrade Analysis also counts a stat when it is the main stat, ' +
    'and counts flat and % alike. This entry only checks substats, with the types selected below, ' +
    'so it may match fewer pieces. Adjust the filters if needed.';

type FormTarget =
    | { kind: 'new' }
    | { kind: 'edit'; entry: WishlistEntry }
    | { kind: 'copy'; entry: WishlistEntry }
    | { kind: 'draft'; entry: Omit<WishlistEntry, 'id'> };

export const GearWishlistTab: React.FC<Props> = ({
    inventory,
    draft,
    onDraftHandled,
    onOpenInAnalysis,
}) => {
    const { entries, loading, addEntry, updateEntry, deleteEntry, moveEntry } =
        useGearWishlistContext();
    const { addNotification } = useNotification();
    const [form, setForm] = useState<FormTarget | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<WishlistEntry | null>(null);

    const gearInventory = useMemo(() => inventory.filter((p) => p.slot in GEAR_SLOTS), [inventory]);

    const { ships } = useShips();

    useEffect(() => {
        if (!draft) return;
        setForm({ kind: 'draft', entry: draft });
        onDraftHandled?.();
    }, [draft, onDraftHandled]);

    const requests = useMemo<WishlistScoreRequest[]>(
        () =>
            entries.map((entry) => ({
                entry,
                matches: gearInventory.filter((g) => matchesWishlistEntry(g, entry)),
            })),
        [entries, gearInventory]
    );
    const { results: scoreResults, scoring } = useWishlistScores(requests);

    const selectedEntry = entries.find((e) => e.id === selectedId) ?? entries[0];
    const selectedRequest = requests.find((r) => r.entry.id === selectedEntry?.id);

    const handleSubmit = async (data: Omit<WishlistEntry, 'id'>) => {
        try {
            if (form?.kind === 'edit') {
                await updateEntry({ ...data, id: form.entry.id });
            } else {
                await addEntry(data);
            }
            setForm(null);
        } catch {
            addNotification('error', 'Could not save the wishlist entry. Please try again.');
        }
    };

    const handleMove = async (id: string, offset: -1 | 1) => {
        try {
            await moveEntry(id, offset);
        } catch {
            addNotification('error', 'Could not reorder the wishlist entries. Please try again.');
        }
    };

    const handleConfirmDelete = async () => {
        if (!pendingDelete) return;
        try {
            await deleteEntry(pendingDelete.id);
        } catch {
            addNotification('error', 'Could not delete the wishlist entry. Please try again.');
        }
    };

    if (loading && entries.length === 0) {
        return <Loader />;
    }

    if (entries.length === 0 && !form) {
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
                <Button onClick={() => setForm({ kind: 'new' })} variant="primary">
                    Add Entry
                </Button>
            </div>
        );
    }

    const formInitial =
        form?.kind === 'edit' || form?.kind === 'draft'
            ? form.entry
            : form?.kind === 'copy'
              ? {
                    ...form.entry,
                    name: `${form.entry.name} (copy)`.slice(0, WISHLIST_NAME_MAX_LENGTH),
                }
              : undefined;

    return (
        <div className="space-y-4">
            <CollapsibleForm isVisible={form !== null}>
                <div className="card">
                    <h2 className="text-xl font-semibold text-white mb-4">
                        {form?.kind === 'edit' ? 'Edit Entry' : 'Add Entry'}
                    </h2>
                    <WishlistEntryForm
                        key={
                            form
                                ? `${form.kind}-${
                                      form.kind === 'new' || form.kind === 'draft'
                                          ? ''
                                          : form.entry.id
                                  }`
                                : 'closed'
                        }
                        initial={formInitial}
                        submitLabel={form?.kind === 'edit' ? 'Save' : 'Add Entry'}
                        notice={form?.kind === 'draft' ? ANALYSIS_DRAFT_NOTICE : undefined}
                        onSubmit={handleSubmit}
                        onCancel={() => setForm(null)}
                    />
                </div>
            </CollapsibleForm>

            {entries.length > 0 && (
                <div className="space-y-2">
                    {requests.map(({ entry, matches }, index) => {
                        const isSelected = entry.id === selectedEntry?.id;
                        const count = matches.length;
                        const target = entry.target
                            ? describeWishlistTarget(entry.target, ships)
                            : undefined;
                        const bestHit = describeBestHit(scoreResults.get(entry.id));
                        return (
                            <div
                                key={entry.id}
                                role="button"
                                tabIndex={0}
                                aria-pressed={isSelected}
                                onClick={() => setSelectedId(entry.id)}
                                onKeyDown={(e) => {
                                    if (
                                        e.target === e.currentTarget &&
                                        (e.key === 'Enter' || e.key === ' ')
                                    ) {
                                        e.preventDefault();
                                        setSelectedId(entry.id);
                                    }
                                }}
                                className={`card flex items-start justify-between gap-4 cursor-pointer transition-colors ${
                                    isSelected ? 'border-primary' : 'hover:border-primary'
                                }`}
                            >
                                <div className="min-w-0">
                                    <p className="font-medium text-white truncate">
                                        {entry.name}
                                        <span className="ml-2 text-xs font-normal text-theme-text-secondary">
                                            {count} match{count !== 1 ? 'es' : ''}
                                        </span>
                                    </p>
                                    <FilterChips entry={entry} />
                                    {target && (
                                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-theme-text-secondary">
                                            <Chip variant={target.valid ? 'accent' : 'default'}>
                                                {target.label}
                                            </Chip>
                                            {target.valid && count > 0 && (
                                                <span>
                                                    {bestHit ?? (scoring ? 'Scoring...' : '')}
                                                </span>
                                            )}
                                        </p>
                                    )}
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    {entry.target && onOpenInAnalysis && (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onOpenInAnalysis(entry);
                                            }}
                                        >
                                            Open in Upgrade Analysis
                                        </Button>
                                    )}
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={index === 0}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void handleMove(entry.id, -1);
                                        }}
                                        aria-label="Move entry up"
                                    >
                                        <ChevronUpIcon />
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={index === requests.length - 1}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void handleMove(entry.id, 1);
                                        }}
                                        aria-label="Move entry down"
                                    >
                                        <ChevronDownIcon />
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setForm({ kind: 'copy', entry });
                                        }}
                                        aria-label="Duplicate entry"
                                    >
                                        <CopyIcon />
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setForm({ kind: 'edit', entry });
                                        }}
                                        aria-label="Edit entry"
                                    >
                                        <EditIcon />
                                    </Button>
                                    <Button
                                        variant="danger"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setPendingDelete(entry);
                                        }}
                                        aria-label="Delete entry"
                                    >
                                        <CloseIcon />
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {form === null && (
                <Button variant="primary" onClick={() => setForm({ kind: 'new' })}>
                    Add Entry
                </Button>
            )}

            {selectedEntry && selectedRequest && (
                <WishlistSearchResults
                    entry={selectedEntry}
                    matches={selectedRequest.matches}
                    scoreResult={scoreResults.get(selectedEntry.id)}
                    scoring={
                        scoring && !!selectedEntry.target && !scoreResults.has(selectedEntry.id)
                    }
                />
            )}

            <ConfirmModal
                isOpen={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
                onConfirm={() => void handleConfirmDelete()}
                title="Delete wishlist entry"
                message={`Delete "${pendingDelete?.name ?? ''}"? This cannot be undone.`}
                confirmLabel="Delete"
            />
        </div>
    );
};

function FilterChips({ entry }: { entry: WishlistEntry }) {
    const chips: string[] = [];
    const { filters } = entry;
    if (filters.slot?.length) chips.push(...filters.slot.map((s) => GEAR_SLOTS[s]?.label ?? s));
    if (filters.stars?.length) chips.push(...filters.stars.map((n) => `${n}★`));
    if (filters.rarity?.length) chips.push(...filters.rarity.map((r) => RARITIES[r]?.label ?? r));
    if (filters.setBonus?.length)
        chips.push(...filters.setBonus.map((s) => getGearSet(s)?.name ?? s));
    if (filters.mainStat?.length) {
        chips.push(`Main: ${filters.mainStat.map(wishlistStatLabel).join(' / ')}`);
    }
    if (filters.subStats?.length) {
        const names = filters.subStats.map(wishlistStatLabel).join(' + ');
        const min = filters.subStatsMin ?? filters.subStats.length;
        chips.push(min < filters.subStats.length ? `Subs: ${min} of ${names}` : `Subs: ${names}`);
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
