import React, { useEffect, useMemo, useState } from 'react';
import { Button, CollapsibleAccordion, Select, StatCard } from '../ui';
import { DataTable, type Column } from '../ui/tables';
import { Loader } from '../ui/Loader';
import {
    averageDailyVisitors,
    formatDuration,
    getTrafficSummary,
    type TrafficSummary,
} from '../../services/trafficService';
import { TrafficChart } from './TrafficChart';

type PageRow = TrafficSummary['pages'][number];
type ReferrerRow = TrafficSummary['referrers'][number];
type ClickRow = TrafficSummary['clicks'][number];
type ErrorRow = TrafficSummary['errors'][number];

const pct = (part: number, whole: number) =>
    whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';

interface TrafficTabProps {
    daysBack: number;
}

export const TrafficTab: React.FC<TrafficTabProps> = ({ daysBack }) => {
    const [summary, setSummary] = useState<TrafficSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [clickPath, setClickPath] = useState('');
    const [openStack, setOpenStack] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        void getTrafficSummary(daysBack).then((result) => {
            if (cancelled) return;
            setSummary(result);
            setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [daysBack]);

    const clickPaths = useMemo(
        () => [...new Set((summary?.clicks ?? []).map((c) => c.path))].sort(),
        [summary]
    );
    const visibleClicks = (summary?.clicks ?? []).filter((c) => !clickPath || c.path === clickPath);

    if (loading) return <Loader />;
    if (!summary) {
        return (
            <div className="card text-theme-text-secondary">Traffic data could not be loaded.</div>
        );
    }

    const totalViews = summary.daily.reduce((s, d) => s + d.views, 0);
    const totalSessions = summary.daily.reduce((s, d) => s + d.sessions, 0);
    const avgDailyVisitors = averageDailyVisitors(summary.daily, daysBack, new Date());
    const totalActive = summary.pages.reduce((s, p) => s + p.avg_active_ms * p.views, 0);
    const deviceTotal = summary.devices.mobile + summary.devices.tablet + summary.devices.desktop;

    const pageColumns: Column<PageRow>[] = [
        { key: 'path', label: 'Page' },
        { key: 'views', label: 'Views', align: 'right' },
        {
            key: 'avg_active_ms',
            label: 'Avg active time',
            align: 'right',
            render: (p) => formatDuration(p.avg_active_ms),
        },
        {
            key: 'entries',
            label: 'Entry rate',
            align: 'right',
            render: (p) => pct(p.entries, p.views),
        },
        { key: 'exits', label: 'Exit rate', align: 'right', render: (p) => pct(p.exits, p.views) },
    ];
    const referrerColumns: Column<ReferrerRow>[] = [
        { key: 'referrer_host', label: 'Referrer' },
        { key: 'entries', label: 'Sessions', align: 'right' },
    ];
    const clickColumns: Column<ClickRow>[] = [
        { key: 'track_id', label: 'Element' },
        { key: 'path', label: 'Page' },
        { key: 'clicks', label: 'Clicks', align: 'right' },
    ];
    const errorColumns: Column<ErrorRow>[] = [
        {
            key: 'sample_message',
            label: 'Error',
            render: (e) => {
                const key = `${e.fingerprint}-${e.app_version}`;
                return (
                    <div className="max-w-xl">
                        <div className="break-words">{e.sample_message}</div>
                        <Button
                            variant="link"
                            size="xs"
                            onClick={() => setOpenStack(openStack === key ? null : key)}
                        >
                            {openStack === key ? 'Hide stack' : 'Show stack'}
                        </Button>
                        <CollapsibleAccordion isOpen={openStack === key}>
                            <pre className="text-xs whitespace-pre-wrap text-theme-text-secondary mt-2">
                                {e.sample_stack || '(no stack)'}
                            </pre>
                        </CollapsibleAccordion>
                    </div>
                );
            },
        },
        { key: 'sample_path', label: 'Page' },
        { key: 'app_version', label: 'Version' },
        { key: 'count', label: 'Count', align: 'right' },
        { key: 'visitors', label: 'Visitor-days', align: 'right' },
        { key: 'last_seen', label: 'Last seen', align: 'right' },
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard title={`Page Views (${daysBack}d)`} value={totalViews.toLocaleString()} />
                <StatCard title="Avg Daily Visitors" value={avgDailyVisitors.toLocaleString()} />
                <StatCard
                    title={`Sessions (${daysBack}d)`}
                    value={totalSessions.toLocaleString()}
                />
                <StatCard
                    title="Avg Active Time per View"
                    value={formatDuration(totalViews > 0 ? totalActive / totalViews : 0)}
                />
            </div>

            <TrafficChart data={summary.daily} title={`Traffic (Last ${daysBack} Days)`} />

            <div className="card">
                <h3 className="text-xl font-semibold mb-4">Pages</h3>
                <DataTable
                    data={summary.pages}
                    columns={pageColumns}
                    getRowKey={(p) => p.path}
                    emptyMessage="No page views yet"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card">
                    <h3 className="text-xl font-semibold mb-4">Referrers</h3>
                    <DataTable
                        data={summary.referrers}
                        columns={referrerColumns}
                        getRowKey={(r) => r.referrer_host}
                        emptyMessage="No sessions yet"
                    />
                </div>
                <div className="card">
                    <h3 className="text-xl font-semibold mb-4">Devices (visitor-days)</h3>
                    <div className="grid grid-cols-3 gap-4">
                        <StatCard
                            title="Desktop"
                            value={pct(summary.devices.desktop, deviceTotal)}
                            subtitle={summary.devices.desktop.toLocaleString()}
                        />
                        <StatCard
                            title="Tablet"
                            value={pct(summary.devices.tablet, deviceTotal)}
                            subtitle={summary.devices.tablet.toLocaleString()}
                        />
                        <StatCard
                            title="Mobile"
                            value={pct(summary.devices.mobile, deviceTotal)}
                            subtitle={summary.devices.mobile.toLocaleString()}
                        />
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="flex items-center justify-between gap-4 mb-4">
                    <h3 className="text-xl font-semibold">Clicks</h3>
                    <Select
                        value={clickPath}
                        onChange={setClickPath}
                        options={[
                            { value: '', label: 'All pages' },
                            ...clickPaths.map((p) => ({ value: p, label: p })),
                        ]}
                    />
                </div>
                <DataTable
                    data={visibleClicks}
                    columns={clickColumns}
                    getRowKey={(c) => `${c.path}|${c.track_id}`}
                    emptyMessage="No tracked clicks yet"
                />
            </div>

            <div className="card">
                <h3 className="text-xl font-semibold mb-4">Errors</h3>
                <DataTable
                    data={summary.errors}
                    columns={errorColumns}
                    getRowKey={(e) => `${e.fingerprint}-${e.app_version}`}
                    emptyMessage="No errors recorded"
                />
            </div>
        </div>
    );
};
