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
    mode: 'normal' | 'background';
    defaultTier: BackgroundTierId;
    tierOverrides: Record<string, BackgroundTierId>;
}

export const DEFAULT_SETTINGS: BountySettings = {
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
    mode: 'normal',
    defaultTier: 'win',
    tierOverrides: {},
};

const isTierId = (v: unknown): v is BackgroundTierId => BACKGROUND_TIERS.some((t) => t.id === v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isSettings = (v: unknown): v is BountySettings => {
    if (!v || typeof v !== 'object') return false;
    const s = v as Record<string, unknown>;
    const overrides = s.secondsOverrides;
    const tierOverrides = s.tierOverrides;
    return (
        BOUNTIES.some((b) => b.id === s.bountyId) &&
        Array.isArray(s.stars) &&
        s.stars.every((x) => Number.isInteger(x) && x >= 1 && x <= 6) &&
        Array.isArray(s.rarities) &&
        s.rarities.every((x) => typeof x === 'string' && Object.hasOwn(RARITIES, x)) &&
        Array.isArray(s.sets) &&
        s.sets.every((x) => typeof x === 'string') &&
        isFiniteNumber(s.generalSellPct) &&
        isFiniteNumber(s.extraCreditsPct) &&
        (s.secondsPerFight === null || isFiniteNumber(s.secondsPerFight)) &&
        isFiniteNumber(s.overheadSeconds) &&
        !!overrides &&
        typeof overrides === 'object' &&
        !Array.isArray(overrides) &&
        Object.values(overrides).every(isFiniteNumber) &&
        (s.metric === 'run' || s.metric === 'energy' || s.metric === 'minute') &&
        (s.mode === 'normal' || s.mode === 'background') &&
        isTierId(s.defaultTier) &&
        !!tierOverrides &&
        typeof tierOverrides === 'object' &&
        !Array.isArray(tierOverrides) &&
        Object.values(tierOverrides).every(isTierId)
    );
};

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
const RARITY_OPTIONS = Object.values(RARITIES).map((r) => ({ value: r.value, label: r.label }));

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

    const columns: Column<LevelResult>[] = [
        {
            key: 'level',
            label: 'Level',
            render: (r) => <span data-testid="bounty-level-row">{r.level}</span>,
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
        { key: 'total', label: 'Per run', align: 'right', render: (r) => fmt(r.total) },
        { key: 'perEnergy', label: 'Per energy', align: 'right', render: (r) => fmt(r.perEnergy) },
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
