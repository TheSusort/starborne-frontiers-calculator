import React, { useMemo } from 'react';
import { PageLayout } from '../../components/ui';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { CheckboxGroup } from '../../components/ui/CheckboxGroup';
import { InlineNumberEdit } from '../../components/ui/InlineNumberEdit';
import { DataTable, Column } from '../../components/ui/tables/DataTable';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { RARITIES, RarityName } from '../../constants/rarities';
import { BOUNTIES, BountyId } from '../../constants/bounties';
import {
    availableLevels,
    bestLevels,
    evaluateLevel,
    metricValue,
    setsAtLevel,
    LevelResult,
    RankMetric,
} from '../../utils/bountyCredits';
import { usePersistedPreference } from '../../hooks/usePersistedPreference';

interface BountySettings {
    bountyId: BountyId;
    stars: number[];
    rarities: RarityName[];
    sets: string[];
    generalSellPct: number;
    extraCreditsPct: number;
    secondsPerFight: number | null;
    overheadSeconds: number;
    secondsOverrides: Record<string, number>;
    metric: RankMetric;
}

const DEFAULT_SETTINGS: BountySettings = {
    bountyId: 'fenri',
    stars: [],
    rarities: [],
    sets: [],
    generalSellPct: 0,
    extraCreditsPct: 0,
    secondsPerFight: null,
    overheadSeconds: 5,
    secondsOverrides: {},
    metric: 'energy',
};

const isSettings = (v: unknown): v is BountySettings => {
    if (!v || typeof v !== 'object') return false;
    const s = v as Record<string, unknown>;
    return (
        BOUNTIES.some((b) => b.id === s.bountyId) &&
        Array.isArray(s.stars) &&
        Array.isArray(s.rarities) &&
        Array.isArray(s.sets) &&
        typeof s.generalSellPct === 'number' &&
        typeof s.extraCreditsPct === 'number' &&
        (s.secondsPerFight === null || typeof s.secondsPerFight === 'number') &&
        typeof s.overheadSeconds === 'number' &&
        !!s.secondsOverrides &&
        typeof s.secondsOverrides === 'object' &&
        (s.metric === 'run' || s.metric === 'energy' || s.metric === 'minute')
    );
};

const METRIC_OPTIONS = [
    { value: 'run', label: 'Credits per run' },
    { value: 'energy', label: 'Credits per energy' },
    { value: 'minute', label: 'Credits per minute' },
];

const STAR_OPTIONS = [1, 2, 3, 4, 5, 6].map((s) => ({ value: String(s), label: `${s}★` }));
const RARITY_OPTIONS = Object.values(RARITIES).map((r) => ({ value: r.value, label: r.label }));

const fmt = (n: number) => Math.round(n).toLocaleString();
const clampPct = (n: number) => Math.min(100, Math.max(0, n));
const parseNum = (raw: string) => (raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw));

const BountyCreditsCalculatorPage: React.FC = () => {
    const [settings, setSettings] = usePersistedPreference<BountySettings>(
        'bountyCredits:settings',
        DEFAULT_SETTINGS,
        isSettings
    );
    const update = (patch: Partial<BountySettings>) => setSettings({ ...settings, ...patch });

    const bounty = BOUNTIES.find((b) => b.id === settings.bountyId) ?? BOUNTIES[0];
    const bountySets = setsAtLevel(bounty, bounty.abyssalAvailable ? 33 : 32);

    const results = useMemo<LevelResult[]>(
        () =>
            availableLevels(bounty)
                .map((lvl) =>
                    evaluateLevel(
                        lvl,
                        bounty,
                        {
                            stars: settings.stars,
                            rarities: settings.rarities,
                            sets: settings.sets,
                            generalSellPct: settings.generalSellPct,
                        },
                        settings.extraCreditsPct,
                        settings.secondsOverrides[lvl.level] ?? settings.secondsPerFight,
                        settings.overheadSeconds
                    )
                )
                .reverse(),
        [bounty, settings]
    );

    const ranked = bestLevels(results, settings.metric);
    const best = ranked[0];
    const runnerUp = ranked[1];

    const columns: Column<LevelResult>[] = [
        {
            key: 'level',
            label: 'Level',
            render: (r) => <span data-testid="bounty-level-row">{r.level}</span>,
        },
        { key: 'energy', label: 'Energy', align: 'right' },
        {
            key: 'fixed',
            label: 'Bounty credits',
            align: 'right',
            render: (r) => fmt(r.fixedCredits),
        },
        { key: 'sale', label: 'Gear sales', align: 'right', render: (r) => fmt(r.saleCredits) },
        { key: 'total', label: 'Per run', align: 'right', render: (r) => fmt(r.total) },
        { key: 'perEnergy', label: 'Per energy', align: 'right', render: (r) => fmt(r.perEnergy) },
        {
            key: 'seconds',
            label: 'Sec / fight',
            align: 'right',
            render: (r) => {
                const seconds = settings.secondsOverrides[r.level] ?? settings.secondsPerFight;
                return (
                    <InlineNumberEdit
                        value={seconds ?? undefined}
                        allowEmpty
                        min={1}
                        label={`Seconds per fight, level ${r.level}`}
                        onSave={(v) => {
                            const next = { ...settings.secondsOverrides };
                            if (v === undefined) delete next[r.level];
                            else next[r.level] = v;
                            update({ secondsOverrides: next });
                        }}
                    >
                        {seconds ?? '—'}
                    </InlineNumberEdit>
                );
            },
        },
        {
            key: 'perMinute',
            label: 'Per minute',
            align: 'right',
            render: (r) => (r.perMinute === null ? '—' : fmt(r.perMinute)),
        },
        {
            key: 'kept',
            label: 'Gear kept / run',
            align: 'right',
            render: (r) => r.keptGearPerRun.toFixed(2),
        },
    ];

    const metricLabel = METRIC_OPTIONS.find((m) => m.value === settings.metric)?.label ?? '';

    return (
        <>
            <Seo {...SEO_CONFIG.bountyCredits} />
            <PageLayout
                title="Bounty Credits"
                description="Find the bounty level that earns the most credits, counting the gear you sell."
            >
                <div className="space-y-4">
                    <div className="card grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Select
                            label="Bounty"
                            options={BOUNTIES.map((b) => ({ value: b.id, label: b.name }))}
                            value={bounty.id}
                            onChange={(v) => update({ bountyId: v as BountyId, sets: [] })}
                        />
                        <Select
                            label="Rank by"
                            options={METRIC_OPTIONS}
                            value={settings.metric}
                            onChange={(v) => update({ metric: v as RankMetric })}
                        />
                        <Input
                            label="Extra credits %"
                            helpLabel="Credit License, VIP and other credit bonuses added together. Applies to the bounty reward, not gear sales."
                            type="number"
                            min={0}
                            value={settings.extraCreditsPct}
                            onChange={(e) =>
                                update({
                                    extraCreditsPct: Math.max(0, parseNum(e.target.value) ?? 0),
                                })
                            }
                        />
                        <Input
                            label="Seconds per fight"
                            helpLabel="Default for every level. Override a single level in the table."
                            type="number"
                            min={1}
                            value={settings.secondsPerFight ?? ''}
                            onChange={(e) => update({ secondsPerFight: parseNum(e.target.value) })}
                        />
                        <Input
                            label="Seconds between fights"
                            type="number"
                            min={0}
                            value={settings.overheadSeconds}
                            onChange={(e) =>
                                update({
                                    overheadSeconds: Math.max(0, parseNum(e.target.value) ?? 0),
                                })
                            }
                        />
                        <Input
                            label="Sell % of remaining gear"
                            helpLabel="Share of the gear the auto-sell filter keeps that you still end up selling."
                            type="number"
                            min={0}
                            max={100}
                            value={settings.generalSellPct}
                            onChange={(e) =>
                                update({ generalSellPct: clampPct(parseNum(e.target.value) ?? 0) })
                            }
                        />
                    </div>

                    <div className="card grid grid-cols-1 md:grid-cols-3 gap-4">
                        <CheckboxGroup
                            label="Auto-sell star ranks"
                            helpLabel="Same as the in-game filter: a piece is sold if its star rank OR its rarity is ticked."
                            options={STAR_OPTIONS}
                            values={settings.stars.map(String)}
                            onChange={(v) => update({ stars: v.map(Number) })}
                        />
                        <CheckboxGroup
                            label="Auto-sell rarities"
                            options={RARITY_OPTIONS}
                            values={settings.rarities}
                            onChange={(v) => update({ rarities: v as RarityName[] })}
                        />
                        <CheckboxGroup
                            label="Always sell sets"
                            options={bountySets.map((s) => ({ value: s, label: s }))}
                            values={settings.sets}
                            onChange={(v) => update({ sets: v })}
                        />
                    </div>

                    {best && (
                        <div className="card" data-testid="bounty-best">
                            Best: <strong>Level {best.level}</strong> at{' '}
                            {fmt(metricValue(best, settings.metric) as number)}{' '}
                            {metricLabel.toLowerCase()}
                            {runnerUp && (
                                <>
                                    {' '}
                                    —{' '}
                                    {(
                                        ((metricValue(best, settings.metric) as number) /
                                            (metricValue(runnerUp, settings.metric) as number) -
                                            1) *
                                        100
                                    ).toFixed(1)}
                                    % ahead of level {runnerUp.level}.
                                </>
                            )}
                        </div>
                    )}
                    {!best && settings.metric === 'minute' && (
                        <div className="card">
                            Enter seconds per fight to rank by credits per minute.
                        </div>
                    )}

                    <DataTable
                        data={results}
                        columns={columns}
                        getRowKey={(r) => String(r.level)}
                        rowClassName={(r) =>
                            best && r.level === best.level ? 'bg-primary/10' : ''
                        }
                    />
                </div>
            </PageLayout>
        </>
    );
};

export default BountyCreditsCalculatorPage;
