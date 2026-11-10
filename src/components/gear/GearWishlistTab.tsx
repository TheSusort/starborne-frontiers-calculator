import React, { useState, useMemo, useEffect, useRef } from 'react';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import { useGearWishlistContext } from '../../contexts/GearWishlistProvider';
import { useNotification } from '../../hooks/useNotification';
import { GearPiece } from '../../types/gear';
import { WishlistEntry } from '../../types/wishlist';
import { matchesWishlistEntry } from '../../utils/wishlist/matchWishlistEntry';
import { WISHLIST_NAME_MAX_LENGTH } from '../../utils/wishlist/describeWishlistEntry';
import { groupWishlistEntries } from '../../utils/wishlist/groupWishlistEntries';
import { useShips } from '../../contexts/ShipsContext';
import { useWishlistScores, type WishlistScoreRequest } from '../../hooks/useWishlistScores';
import {
    describeBestHit,
    describeGroupBestHit,
    describeWishlistTarget,
} from '../../utils/wishlist/wishlistScoreDisplay';
import { Button, Chip, CloseIcon, ConfirmModal, CopyIcon, EditIcon, StarOutlineIcon } from '../ui';
import { ChevronDownIcon, ChevronUpIcon } from '../ui/icons/ChevronIcons';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import { Loader } from '../ui/Loader';
import { WishlistEntryForm } from './WishlistEntryForm';
import { WishlistFilterChips } from './WishlistFilterChips';
import { WishlistFromShipModal } from './WishlistFromShipModal';
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

/** localStorage key for the names of collapsed wishlist groups. Per browser, not synced. */
const COLLAPSED_GROUPS_KEY = 'gear_wishlist_collapsed_groups';

function readCollapsedGroups(): Set<string> {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? '[]');
        return new Set(
            Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
        );
    } catch {
        return new Set();
    }
}

function writeCollapsedGroups(groups: Set<string>) {
    try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...groups]));
    } catch {
        // Collapse state is a convenience; losing it is harmless.
    }
}

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
    const { entries, loading, addEntry, updateEntry, deleteEntry, moveEntry, moveGroup } =
        useGearWishlistContext();
    const { addNotification } = useNotification();
    const [form, setForm] = useState<FormTarget | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<WishlistEntry | null>(null);
    const [fromShipOpen, setFromShipOpen] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedGroups);
    const formRef = useRef<HTMLDivElement>(null);
    const formHeadingRef = useRef<HTMLHeadingElement>(null);
    const waitingForEntries = loading && entries.length === 0;

    // Every open (new, edit, copy, draft) sets a fresh `form` object, so this runs on each one.
    // A draft can arrive while the loader shows; the form mounts, and scrolls, once it clears.
    // Focus follows the scroll so the next Tab starts in the form, not back in the list.
    useEffect(() => {
        if (!form || waitingForEntries) return;
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        formHeadingRef.current?.focus({ preventScroll: true });
    }, [form, waitingForEntries]);

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

    const groups = useMemo(() => groupWishlistEntries(requests.map((r) => r.entry)), [requests]);
    const requestById = useMemo(() => new Map(requests.map((r) => [r.entry.id, r])), [requests]);
    const showGroupHeaders = groups.some((g) => g.name !== null);
    const namedGroups = groups.filter((g) => g.name !== null);
    const groupNames = namedGroups.map((g) => g.name!);

    const selectedEntry =
        entries.find((e) => e.id === selectedId) ?? groups[0]?.entries[0] ?? undefined;
    const selectedRequest = requests.find((r) => r.entry.id === selectedEntry?.id);

    const handleSubmit = async (data: Omit<WishlistEntry, 'id'>) => {
        try {
            if (form?.kind === 'edit') {
                const { source } = form.entry;
                await updateEntry({ ...data, id: form.entry.id, ...(source ? { source } : {}) });
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

    const handleMoveGroup = async (group: string, offset: -1 | 1) => {
        try {
            await moveGroup(group, offset);
        } catch {
            addNotification('error', 'Could not reorder the wishlist groups. Please try again.');
        }
    };

    const toggleGroup = (group: string) => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(group)) next.delete(group);
            else next.add(group);
            writeCollapsedGroups(next);
            return next;
        });
    };

    const handleConfirmDelete = async () => {
        if (!pendingDelete) return;
        try {
            await deleteEntry(pendingDelete.id);
        } catch {
            addNotification('error', 'Could not delete the wishlist entry. Please try again.');
        }
    };

    if (waitingForEntries) {
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
                <div className="flex gap-2">
                    <Button onClick={() => setForm({ kind: 'new' })} variant="primary">
                        Add Entry
                    </Button>
                    <Button onClick={() => setFromShipOpen(true)} variant="secondary">
                        From ship
                    </Button>
                </div>
                {fromShipOpen && (
                    <WishlistFromShipModal isOpen onClose={() => setFromShipOpen(false)} />
                )}
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
                <div ref={formRef} className="card scroll-mt-24">
                    <h2
                        ref={formHeadingRef}
                        tabIndex={-1}
                        className="text-xl font-semibold text-white mb-4 focus:outline-none"
                    >
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
                        groupOptions={groupNames}
                        onSubmit={handleSubmit}
                        onCancel={() => setForm(null)}
                    />
                </div>
            </CollapsibleForm>

            {entries.length > 0 && (
                <div className="space-y-4">
                    {groups.map((group) => {
                        const isCollapsed = group.name !== null && collapsed.has(group.name);
                        const namedIndex =
                            group.name === null ? -1 : groupNames.indexOf(group.name);
                        const matchCount = group.entries.reduce(
                            (sum, e) => sum + (requestById.get(e.id)?.matches.length ?? 0),
                            0
                        );
                        const groupBestHit = describeGroupBestHit(
                            group.entries.map((e) => scoreResults.get(e.id))
                        );
                        return (
                            <section key={group.name ?? ''} className="space-y-2">
                                {showGroupHeaders && (
                                    <div className="flex items-center gap-2">
                                        {group.name !== null ? (
                                            <button
                                                type="button"
                                                className="flex-1 min-w-0 flex items-center gap-2 text-left"
                                                aria-expanded={!isCollapsed}
                                                onClick={() => toggleGroup(group.name!)}
                                            >
                                                {isCollapsed ? (
                                                    <ChevronDownIcon />
                                                ) : (
                                                    <ChevronUpIcon />
                                                )}
                                                <GroupHeading
                                                    name={group.name}
                                                    entryCount={group.entries.length}
                                                    matchCount={matchCount}
                                                    bestHit={groupBestHit}
                                                />
                                            </button>
                                        ) : (
                                            <div className="flex-1 min-w-0">
                                                <GroupHeading
                                                    name="Ungrouped"
                                                    entryCount={group.entries.length}
                                                    matchCount={matchCount}
                                                    bestHit={groupBestHit}
                                                />
                                            </div>
                                        )}
                                        {group.name !== null && namedGroups.length > 1 && (
                                            <div className="flex gap-2 shrink-0">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    disabled={namedIndex === 0}
                                                    onClick={() =>
                                                        void handleMoveGroup(group.name!, -1)
                                                    }
                                                    aria-label={`Move group ${group.name} up`}
                                                >
                                                    <ChevronUpIcon />
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    disabled={namedIndex === namedGroups.length - 1}
                                                    onClick={() =>
                                                        void handleMoveGroup(group.name!, 1)
                                                    }
                                                    aria-label={`Move group ${group.name} down`}
                                                >
                                                    <ChevronDownIcon />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {!isCollapsed &&
                                    group.entries.map((entry, indexInGroup) => {
                                        const matches = requestById.get(entry.id)?.matches ?? [];
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
                                                    isSelected
                                                        ? 'border-primary'
                                                        : 'hover:border-primary'
                                                }`}
                                            >
                                                <div className="min-w-0">
                                                    <p className="font-medium text-white truncate">
                                                        {entry.name}
                                                        <span className="ml-2 text-xs font-normal text-theme-text-secondary">
                                                            {count} match{count !== 1 ? 'es' : ''}
                                                        </span>
                                                    </p>
                                                    <WishlistFilterChips entry={entry} />
                                                    {target && (
                                                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-theme-text-secondary">
                                                            <Chip
                                                                variant={
                                                                    target.valid
                                                                        ? 'accent'
                                                                        : 'default'
                                                                }
                                                            >
                                                                {target.label}
                                                            </Chip>
                                                            {target.valid && count > 0 && (
                                                                <span>
                                                                    {bestHit ??
                                                                        (scoring
                                                                            ? 'Scoring...'
                                                                            : '')}
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
                                                        disabled={indexInGroup === 0}
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
                                                        disabled={
                                                            indexInGroup ===
                                                            group.entries.length - 1
                                                        }
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
                            </section>
                        );
                    })}
                </div>
            )}

            {form === null && (
                <div className="flex gap-2">
                    <Button variant="primary" onClick={() => setForm({ kind: 'new' })}>
                        Add Entry
                    </Button>
                    <Button variant="secondary" onClick={() => setFromShipOpen(true)}>
                        From ship
                    </Button>
                </div>
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

            {fromShipOpen && (
                <WishlistFromShipModal isOpen onClose={() => setFromShipOpen(false)} />
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

function GroupHeading({
    name,
    entryCount,
    matchCount,
    bestHit,
}: {
    name: string;
    entryCount: number;
    matchCount: number;
    bestHit?: string;
}) {
    return (
        <span className="min-w-0 flex flex-wrap items-baseline gap-x-3">
            <span className="font-semibold text-white truncate">{name}</span>
            <span className="text-xs text-theme-text-secondary">
                {entryCount} {entryCount === 1 ? 'entry' : 'entries'} · {matchCount} match
                {matchCount !== 1 ? 'es' : ''}
                {bestHit ? ` · ${bestHit}` : ''}
            </span>
        </span>
    );
}
