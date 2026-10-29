import React, { useMemo } from 'react';
import { DataTable, Column } from '../ui/tables/DataTable';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { PodiumCard } from '../ui/PodiumCard';
import { Image } from '../ui/Image';
import type { ArcadeLeaderboardEntry } from '../../utils/arcade/leaderboardRows';
import { useShipPortraits } from './ships/useShipPortraits';
import { formatCredits, formatDistance, formatRunStats } from './bestRunSource';
import { isGapRow, splitPodium, withGapRows, type LeaderboardViewRow } from './leaderboardRowsView';

const MEDAL_COLORS: Record<number, string> = {
    1: '#facc15', // gold (yellow-400)
    2: '#d1d5db', // silver (gray-300)
    3: '#d97706', // bronze (amber-600)
};

/** Podium slots left to right, as indexes into the podium entries: #2, #1, #3. */
const PODIUM_SLOT_ORDER = [1, 0, 2];

const YouChip: React.FC = () => <Chip variant="accent">YOU</Chip>;

/** Marks a guest (anonymous) player's row; guest names are a separate namespace from usernames. */
const GuestTag: React.FC = () => (
    <span className="text-[10px] font-semibold tracking-wider text-theme-text-secondary">
        GUEST
    </span>
);

/** Row identity: a guest name may equal an account username. */
const entryKey = (e: ArcadeLeaderboardEntry): string =>
    `${e.rank}-${e.isGuest ? 'g' : 'u'}-${e.username}`;

type PortraitFor = (name: string) => string | null;

/** The ship of a best-score run: a round pilot portrait when the name resolves, and the name. */
const ShipTag: React.FC<{ ship: string; portraitFor: PortraitFor; className?: string }> = ({
    ship,
    portraitFor,
    className = '',
}) => {
    const portrait = portraitFor(ship);
    return (
        <span
            className={`inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-theme-text-secondary ${className}`}
        >
            {portrait && (
                <Image
                    src={portrait}
                    alt=""
                    fallback={null}
                    className="h-5 w-5 shrink-0 overflow-hidden rounded-full border border-dark-border"
                    imageClassName="h-full w-full object-cover"
                />
            )}
            <span className="truncate" title={ship}>
                {ship}
            </span>
        </span>
    );
};

const Podium: React.FC<{ entries: ArcadeLeaderboardEntry[]; portraitFor: PortraitFor }> = ({
    entries,
    portraitFor,
}) => {
    // One ship on the podium reserves the subtitle slot on every card so the tops stay level.
    const anyShip = entries.some((e) => e.ship);
    return (
        <div className="mx-auto grid w-full max-w-2xl grid-cols-3 items-end gap-2 sm:gap-3">
            {PODIUM_SLOT_ORDER.map((index) => {
                const entry = entries[index];
                if (!entry) return <div key={`empty-${index}`} aria-hidden="true" />;
                return (
                    <PodiumCard
                        key={entryKey(entry)}
                        rank={entry.rank}
                        title={entry.username}
                        value={entry.bestScore.toLocaleString()}
                        detail={formatRunStats(entry.distance, entry.credits)}
                        accentColor={MEDAL_COLORS[entry.rank] ?? MEDAL_COLORS[index + 1]}
                        raised={index === 0}
                        badge={
                            entry.isMe || entry.isGuest ? (
                                <span className="flex items-center gap-1">
                                    {entry.isGuest && <GuestTag />}
                                    {entry.isMe && <YouChip />}
                                </span>
                            ) : undefined
                        }
                        subtitle={
                            anyShip ? (
                                entry.ship ? (
                                    <ShipTag
                                        ship={entry.ship}
                                        portraitFor={portraitFor}
                                        className="justify-center"
                                    />
                                ) : null
                            ) : undefined
                        }
                    />
                );
            })}
        </div>
    );
};

const columnsFor = (portraitFor: PortraitFor): Column<LeaderboardViewRow>[] => [
    {
        key: 'rank',
        label: '#',
        render: (r) => (isGapRow(r) ? '\u2026' : <span className="tabular-nums">#{r.rank}</span>),
    },
    {
        key: 'username',
        label: 'Pilot',
        render: (r) => {
            if (isGapRow(r)) return '';
            return (
                <span className="flex min-w-0 max-w-full flex-col items-start gap-0.5">
                    <span className="inline-flex min-w-0 max-w-full items-center gap-2">
                        <span className={`truncate ${r.isMe ? 'font-semibold' : ''}`}>
                            {r.username}
                        </span>
                        {r.isGuest && <GuestTag />}
                        {r.isMe && <YouChip />}
                    </span>
                    {r.ship && <ShipTag ship={r.ship} portraitFor={portraitFor} />}
                </span>
            );
        },
    },
    {
        key: 'bestScore',
        label: 'Score',
        align: 'right',
        render: (r) =>
            isGapRow(r) ? (
                ''
            ) : (
                <span className="flex flex-col items-end">
                    <span className="tabular-nums">{r.bestScore.toLocaleString()}</span>
                    <span className="text-xs tabular-nums text-theme-text-secondary sm:hidden">
                        {formatRunStats(r.distance, r.credits)}
                    </span>
                </span>
            ),
    },
    {
        key: 'distance',
        label: 'Distance',
        align: 'right',
        className: 'hidden sm:table-cell',
        render: (r) =>
            isGapRow(r) ? '' : <span className="tabular-nums">{formatDistance(r.distance)}</span>,
    },
    {
        key: 'credits',
        label: 'Credits',
        align: 'right',
        className: 'hidden sm:table-cell',
        render: (r) =>
            isGapRow(r) ? '' : <span className="tabular-nums">{formatCredits(r.credits)}</span>,
    },
];

const OWN_ROW_CLASSES =
    'border-b-transparent [&>td]:bg-primary/15 [&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md';

const rowClassName = (r: LeaderboardViewRow): string => {
    if (isGapRow(r)) return 'text-theme-text-secondary hover:!bg-transparent';
    return r.isMe ? OWN_ROW_CLASSES : '';
};

interface Props {
    rows: ArcadeLeaderboardEntry[];
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
}

export const ArcadeLeaderboard: React.FC<Props> = ({ rows, loading, failed, onRetry }) => {
    const portraitFor = useShipPortraits();
    const columns = useMemo(() => columnsFor(portraitFor), [portraitFor]);

    const { podium, tableRows } = useMemo(() => {
        const split = splitPodium(rows);
        return {
            podium: split.podium,
            tableRows: withGapRows(split.rest, split.podium[split.podium.length - 1]?.rank),
        };
    }, [rows]);

    if (failed) {
        return (
            <div className="space-y-2">
                <p className="text-sm text-red-400">Could not load the leaderboard.</p>
                <Button variant="secondary" size="sm" onClick={onRetry}>
                    Retry
                </Button>
            </div>
        );
    }

    const table = (
        <DataTable
            data={tableRows}
            columns={columns}
            loading={loading && rows.length === 0}
            emptyMessage="No scores yet. Be the first."
            getRowKey={(r, i) => (isGapRow(r) ? `gap-${i}` : entryKey(r))}
            rowClassName={rowClassName}
        />
    );

    if (rows.length === 0) return table;

    return (
        <div className="space-y-3">
            <Podium entries={podium} portraitFor={portraitFor} />
            {tableRows.length > 0 && table}
        </div>
    );
};
