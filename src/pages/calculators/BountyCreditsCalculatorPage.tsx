import React, { useMemo } from 'react';
import { PageLayout } from '../../components/ui';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { ToggleChipGroup } from '../../components/ui/ToggleChipGroup';
import { InlineNumberEdit } from '../../components/ui/InlineNumberEdit';
import { DataTable, Column } from '../../components/ui/tables/DataTable';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { RARITIES, RarityName } from '../../constants/rarities';
import { BACKGROUND_TIERS, BOUNTIES, BackgroundTierId, BountyId } from '../../constants/bounties';
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
import { BountySettings, DEFAULT_SETTINGS, isSettings } from './bountyCreditsSettings';

const METRIC_OPTIONS = [
    { value: 'run', label: 'Credits per run' },
    { value: 'energy', label: 'Credits per energy' },
    { value: 'minute', label: 'Credits per minute' },
];

const MODE_OPTIONS = [
    { value: 'normal', label: 'Normal' },
    { value: 'background', label: 'Background' },
];

const TIER_OPTIONS = BACKGROUND_TIERS.map((t) => ({
    value: t.id,
    label: `${t.label} (${t.minutes} min)`,
}));

const STAR_OPTIONS = [1, 2, 3, 4, 5, 6].map((s) => ({ value: String(s), label: `${s}★` }));
const RARITY_CHIP_CLASSES: Record<RarityName, { active: string; swatch: string }> = {
    common: {
        active: 'border-rarity-common bg-rarity-common/15 text-rarity-common',
        swatch: 'bg-rarity-common',
    },
    uncommon: {
        active: 'border-rarity-uncommon bg-rarity-uncommon/15 text-rarity-uncommon',
        swatch: 'bg-rarity-uncommon',
    },
    rare: {
        active: 'border-rarity-rare bg-rarity-rare/20 text-rarity-rare',
        swatch: 'bg-rarity-rare',
    },
    epic: {
        active: 'border-rarity-epic bg-rarity-epic/20 text-rarity-epic',
        swatch: 'bg-rarity-epic',
    },
    legendary: {
        active: 'border-rarity-legendary bg-rarity-legendary/20 text-rarity-legendary',
        swatch: 'bg-rarity-legendary',
    },
};
const RARITY_OPTIONS = Object.values(RARITIES).map((r) => ({
    value: r.value,
    label: r.label,
    activeClassName: RARITY_CHIP_CLASSES[r.value as RarityName].active,
    swatchClassName: RARITY_CHIP_CLASSES[r.value as RarityName].swatch,
}));

const fmt = (n: number) => Math.round(n).toLocaleString();
const fmtEnergy = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const clampPct = (n: number) => Math.min(100, Math.max(0, n));
const parseNum = (raw: string) => (raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw));

const positiveOrNull = (n: number | null) => (n !== null && n > 0 ? n : null);

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
                        settings.mode === 'background'
                            ? {
                                  mode: 'background',
                                  tier: settings.tierOverrides[lvl.level] ?? settings.defaultTier,
                              }
                            : {
                                  mode: 'normal',
                                  secondsPerFight:
                                      settings.secondsOverrides[lvl.level] ??
                                      settings.secondsPerFight,
                                  overheadSeconds: settings.overheadSeconds,
                              }
                    )
                )
                .reverse(),
        [bounty, settings]
    );

    const ranked = bestLevels(results, settings.metric);
    const best = ranked[0];
    const runnerUp = ranked[1];
    const bestValue = best ? (metricValue(best, settings.metric) as number) : 0;

    /** The ranked metric's cell: its value over a bar scaled to the best level's value. */
    const rankedCell = (r: LevelResult) => {
        const value = metricValue(r, settings.metric);
        if (value === null) return '—';
        const isBest = best?.level === r.level;
        const share = bestValue > 0 ? Math.max(0, Math.min(1, value / bestValue)) : 0;
        return (
            <div className="relative ml-3 min-w-[7rem] px-2 py-1">
                <div
                    aria-hidden="true"
                    className={`absolute inset-y-0 right-0 transition-[width] duration-500 ease-out motion-reduce:transition-none ${
                        isBest ? 'bg-primary/40' : 'bg-primary/15'
                    }`}
                    style={{ width: `${share * 100}%` }}
                />
                <span className={`relative ${isBest ? 'font-semibold text-primary' : ''}`}>
                    {fmt(value)}
                </span>
            </div>
        );
    };
    const rankedKey = { run: 'total', energy: 'perEnergy', minute: 'perMinute' }[settings.metric];
    // DataTable applies a column's className to its header and body cells; the `th` variant
    // limits the highlight to the header.
    const rankedHeader = (key: string) => (key === rankedKey ? '[th&]:text-primary' : '');

    const columns: Column<LevelResult>[] = [
        {
            key: 'level',
            label: 'Level',
            render: (r) => (
                <span
                    data-testid="bounty-level-row"
                    className={best?.level === r.level ? 'font-semibold text-primary' : ''}
                >
                    {r.level}
                </span>
            ),
        },
        {
            key: 'energy',
            label: 'Energy',
            align: 'right',
            render: (r) => fmtEnergy(r.energy),
        },
        {
            key: 'fixed',
            label: 'Bounty credits',
            align: 'right',
            render: (r) => fmt(r.fixedCredits),
        },
        { key: 'sale', label: 'Gear sales', align: 'right', render: (r) => fmt(r.saleCredits) },
        {
            key: 'total',
            label: 'Per run',
            align: 'right',
            className: rankedHeader('total'),
            render: (r) => (rankedKey === 'total' ? rankedCell(r) : fmt(r.total)),
        },
        {
            key: 'perEnergy',
            label: 'Per energy',
            align: 'right',
            className: rankedHeader('perEnergy'),
            render: (r) => (rankedKey === 'perEnergy' ? rankedCell(r) : fmt(r.perEnergy)),
        },
        settings.mode === 'background'
            ? {
                  key: 'tier',
                  label: 'Tier',
                  align: 'center',
                  render: (r) => {
                      const overridden = settings.tierOverrides[r.level] !== undefined;
                      return (
                          <Select
                              aria-label={`Tier, level ${r.level}`}
                              className={overridden ? 'text-primary' : ''}
                              options={TIER_OPTIONS}
                              value={settings.tierOverrides[r.level] ?? settings.defaultTier}
                              onChange={(v) => {
                                  const next = { ...settings.tierOverrides };
                                  // Choosing the default tier clears the row's override.
                                  if (v === settings.defaultTier) {
                                      delete next[r.level];
                                  } else {
                                      next[r.level] = v as BackgroundTierId;
                                  }
                                  update({ tierOverrides: next });
                              }}
                          />
                      );
                  },
              }
            : {
                  key: 'seconds',
                  label: 'Sec / fight',
                  align: 'right',
                  render: (r) => {
                      const seconds =
                          settings.secondsOverrides[r.level] ?? settings.secondsPerFight;
                      return (
                          <InlineNumberEdit
                              value={seconds ?? undefined}
                              allowEmpty
                              min={1}
                              className={
                                  settings.secondsOverrides[r.level] !== undefined
                                      ? 'text-primary'
                                      : ''
                              }
                              label={`Seconds per fight, level ${r.level}`}
                              onSave={(v) => {
                                  const next = { ...settings.secondsOverrides };
                                  // An unchanged, cleared or non-positive value falls back to the default.
                                  if (v === undefined || v <= 0 || v === settings.secondsPerFight) {
                                      delete next[r.level];
                                  } else {
                                      next[r.level] = v;
                                  }
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
            className: rankedHeader('perMinute'),
            render: (r) =>
                rankedKey === 'perMinute'
                    ? rankedCell(r)
                    : r.perMinute === null
                      ? '—'
                      : fmt(r.perMinute),
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
                    <section className="card grid grid-cols-1 md:grid-cols-3 gap-4">
                        <h2 className="md:col-span-3 text-lg text-theme-text">Run setup</h2>
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
                        <Select
                            label="Battle mode"
                            helpLabel="Background battles cost 10% less energy; their time comes from the tier you earned on each level."
                            options={MODE_OPTIONS}
                            value={settings.mode}
                            onChange={(v) => update({ mode: v as BountySettings['mode'] })}
                        />
                        {settings.mode === 'background' ? (
                            <Select
                                label="Default tier"
                                helpLabel="Default for every level. Override a single level in the table."
                                options={TIER_OPTIONS}
                                value={settings.defaultTier}
                                onChange={(v) => {
                                    const tier = v as BackgroundTierId;
                                    // Rows already on the new default no longer differ from it.
                                    const next = Object.fromEntries(
                                        Object.entries(settings.tierOverrides).filter(
                                            ([, t]) => t !== tier
                                        )
                                    );
                                    update({ defaultTier: tier, tierOverrides: next });
                                }}
                            />
                        ) : (
                            <>
                                <Input
                                    label="Seconds per fight"
                                    helpLabel="Default for every level. Override a single level in the table."
                                    type="number"
                                    min={1}
                                    value={settings.secondsPerFight ?? ''}
                                    onChange={(e) =>
                                        update({
                                            secondsPerFight: positiveOrNull(
                                                parseNum(e.target.value)
                                            ),
                                        })
                                    }
                                />
                                <Input
                                    label="Seconds between fights"
                                    type="number"
                                    min={0}
                                    value={settings.overheadSeconds}
                                    onChange={(e) =>
                                        update({
                                            overheadSeconds: Math.max(
                                                0,
                                                parseNum(e.target.value) ?? 0
                                            ),
                                        })
                                    }
                                />
                            </>
                        )}
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
                    </section>

                    <section className="card grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-5">
                        <div className="lg:col-span-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <h2 className="text-lg text-theme-text">Auto-sell</h2>
                            <p className="text-sm text-theme-text-secondary">
                                A piece is sold if its star rank OR its rarity is picked, like the
                                in-game filter.
                            </p>
                        </div>
                        <ToggleChipGroup
                            label="Star ranks"
                            options={STAR_OPTIONS}
                            values={settings.stars.map(String)}
                            onChange={(v) => update({ stars: v.map(Number) })}
                        />
                        <ToggleChipGroup
                            label="Rarities"
                            options={RARITY_OPTIONS}
                            values={settings.rarities}
                            onChange={(v) => update({ rarities: v as RarityName[] })}
                        />
                        <ToggleChipGroup
                            label="Always sell sets"
                            helpLabel="Sets you dump whatever their rank. Every set a level drops is equally likely; the abyssal set only drops on level 33."
                            options={bountySets.map((s) => ({
                                value: s,
                                label: s === bounty.abyssalSet ? `${s} (L33)` : s,
                            }))}
                            values={settings.sets}
                            onChange={(v) => update({ sets: v })}
                        />
                    </section>

                    {best && (
                        <section
                            className="card clip-1-corner relative border-primary/50 bg-gradient-to-br from-primary/15 via-dark to-dark flex flex-wrap items-center gap-x-10 gap-y-5 tabular-nums"
                            data-testid="bounty-best"
                            aria-live="polite"
                        >
                            {/* Draws the border along clip-1-corner's 10px diagonal cut. */}
                            <span
                                aria-hidden="true"
                                className="absolute left-0 top-[10px] h-px w-[15px] origin-top-left -rotate-45 bg-primary/50"
                            />
                            <h2 className="flex items-baseline gap-3 leading-none">
                                <span className="text-xl text-theme-text-secondary">Level</span>{' '}
                                <span className="text-7xl font-bold text-primary">
                                    {best.level}
                                </span>
                            </h2>
                            <div className="flex-1 min-w-[16rem] space-y-3">
                                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                    <span className="text-3xl font-semibold text-theme-text">
                                        {fmt(bestValue)}
                                    </span>
                                    <span className="text-theme-text-secondary">
                                        {metricLabel.toLowerCase()}
                                    </span>
                                    {runnerUp && (
                                        <span className="text-primary">
                                            +
                                            {(
                                                (bestValue /
                                                    (metricValue(
                                                        runnerUp,
                                                        settings.metric
                                                    ) as number) -
                                                    1) *
                                                100
                                            ).toFixed(1)}
                                            % ahead of level {runnerUp.level}
                                        </span>
                                    )}
                                </p>
                                <div
                                    aria-hidden="true"
                                    className="flex h-2.5 w-full max-w-xl overflow-hidden bg-dark-border"
                                >
                                    <div
                                        className="bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
                                        style={{
                                            width: `${(best.fixedCredits / best.total) * 100}%`,
                                        }}
                                    />
                                    <div
                                        className="bg-primary-hover/50 transition-[width] duration-500 ease-out motion-reduce:transition-none"
                                        style={{
                                            width: `${(best.saleCredits / best.total) * 100}%`,
                                        }}
                                    />
                                </div>
                                <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-theme-text-secondary">
                                    <span>
                                        <span className="mr-1.5 inline-block h-2.5 w-2.5 bg-primary align-middle" />
                                        Bounty reward {fmt(best.fixedCredits)}
                                    </span>
                                    <span>
                                        <span className="mr-1.5 inline-block h-2.5 w-2.5 bg-primary-hover/50 align-middle" />
                                        Gear sales {fmt(best.saleCredits)}
                                    </span>
                                    <span>
                                        {fmtEnergy(best.energy)} energy ·{' '}
                                        {best.keptGearPerRun.toFixed(2)} gear kept per run
                                    </span>
                                </p>
                            </div>
                        </section>
                    )}
                    {!best && settings.metric === 'minute' && (
                        <div className="card">
                            Enter seconds per fight to rank by credits per minute.
                        </div>
                    )}

                    <DataTable
                        className="tabular-nums"
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
