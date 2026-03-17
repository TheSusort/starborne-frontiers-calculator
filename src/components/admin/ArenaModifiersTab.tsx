import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ArenaSeason, ArenaSeasonRule } from '../../types/arena';
import {
    createSeason,
    deleteSeason,
    activateSeason,
    deactivateAllSeasons,
    updateSeason,
    updateSeasonEndDate,
    createRule,
    updateRule,
    deleteRule,
} from '../../services/arenaModifierService';
import { useNotification } from '../../hooks/useNotification';
import { FACTIONS } from '../../constants/factions';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { RARITIES } from '../../constants/rarities';
import { STATS } from '../../constants/stats';
import { StatName } from '../../types/stats';

interface ArenaModifiersTabProps {
    seasons: ArenaSeason[];
    onSeasonsChange: () => void;
}

interface ModifierPair {
    stat: StatName | '';
    value: number;
}

const STAT_OPTIONS = (Object.keys(STATS) as StatName[]).map((key) => ({
    value: key,
    label: STATS[key].label,
}));

function formatEndDate(endsAt: string | null): string {
    if (!endsAt) return 'No expiry';
    return new Date(endsAt).toLocaleDateString();
}

function isExpired(endsAt: string | null): boolean {
    if (!endsAt) return false;
    return new Date(endsAt) < new Date();
}

function toDateValue(isoString: string | null): string {
    if (!isoString) return '';
    return isoString.slice(0, 10);
}

function buildFilterSummary(rule: ArenaSeasonRule): string {
    const parts: string[] = [];

    if (rule.rarities && rule.rarities.length > 0) {
        parts.push(rule.rarities.map((r) => RARITIES[r]?.label ?? r).join('/'));
    }
    if (rule.ship_types && rule.ship_types.length > 0) {
        parts.push(rule.ship_types.map((t) => SHIP_TYPES[t]?.name ?? t).join('/'));
    }
    if (rule.factions && rule.factions.length > 0) {
        parts.push(`from ${rule.factions.map((f) => FACTIONS[f]?.name ?? f).join('/')}`);
    }

    return parts.length > 0 ? parts.join(' ') : 'All units';
}

function buildModifierSummary(modifiers: Record<string, number>): string {
    return Object.entries(modifiers)
        .map(([stat, val]) => {
            const label = STATS[stat as StatName]?.shortLabel ?? stat.toUpperCase();
            return `${label} ${val > 0 ? '+' : ''}${val}%`;
        })
        .join(', ');
}

// ─── Chip Select ─────────────────────────────────────────────────────────────

interface ChipSelectProps {
    label: string;
    options: { key: string; label: string }[];
    selected: string[];
    onChange: (selected: string[]) => void;
}

const ChipSelect: React.FC<ChipSelectProps> = ({ label, options, selected, onChange }) => {
    const toggle = (key: string) => {
        if (selected.includes(key)) {
            onChange(selected.filter((k) => k !== key));
        } else {
            onChange([...selected, key]);
        }
    };

    return (
        <div>
            <div className="text-xs text-gray-500 mb-1">{label}</div>
            <div className="flex flex-wrap gap-1">
                {options.map(({ key, label: optLabel }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => toggle(key)}
                        className={`px-2 py-0.5 rounded text-xs transition-colors ${
                            selected.includes(key)
                                ? 'bg-primary/20 text-primary border border-primary/40'
                                : 'text-gray-500 border border-dark-lighter hover:border-gray-500 hover:text-gray-400'
                        }`}
                    >
                        {optLabel}
                    </button>
                ))}
            </div>
        </div>
    );
};

// ─── Rule Form (Add / Edit) ──────────────────────────────────────────────────

interface RuleFormProps {
    seasonId: string;
    existingRule?: ArenaSeasonRule;
    onSaved: () => void;
    onCancel: () => void;
}

const RuleForm: React.FC<RuleFormProps> = ({ seasonId, existingRule, onSaved, onCancel }) => {
    const { addNotification } = useNotification();
    const isEdit = !!existingRule;

    const [factions, setFactions] = useState<string[]>(existingRule?.factions ?? []);
    const [rarities, setRarities] = useState<string[]>(existingRule?.rarities ?? []);
    const [shipTypes, setShipTypes] = useState<string[]>(existingRule?.ship_types ?? []);
    const [modifierPairs, setModifierPairs] = useState<ModifierPair[]>(
        existingRule
            ? Object.entries(existingRule.modifiers).map(([stat, value]) => ({
                  stat: stat as StatName,
                  value,
              }))
            : [{ stat: '', value: 0 }]
    );
    const [saving, setSaving] = useState(false);

    const factionOptions = Object.keys(FACTIONS).map((key) => ({
        key,
        label: FACTIONS[key].name,
    }));
    const rarityOptions = Object.keys(RARITIES).map((key) => ({
        key,
        label: RARITIES[key].label,
    }));
    const shipTypeOptions = Object.keys(SHIP_TYPES).map((key) => ({
        key,
        label: SHIP_TYPES[key].name,
    }));

    const handleSave = async () => {
        const validPairs = modifierPairs.filter((p) => p.stat !== '');
        if (validPairs.length === 0) {
            addNotification('error', 'At least one modifier stat is required.');
            return;
        }

        const modifiers: Record<string, number> = {};
        for (const pair of validPairs) {
            modifiers[pair.stat] = pair.value;
        }

        setSaving(true);
        try {
            if (isEdit) {
                await updateRule(existingRule.id, {
                    factions: factions.length > 0 ? factions : null,
                    rarities: rarities.length > 0 ? rarities : null,
                    ship_types: shipTypes.length > 0 ? shipTypes : null,
                    modifiers,
                });
                addNotification('success', 'Rule updated.');
            } else {
                await createRule(seasonId, {
                    factions: factions.length > 0 ? factions : null,
                    rarities: rarities.length > 0 ? rarities : null,
                    ship_types: shipTypes.length > 0 ? shipTypes : null,
                    modifiers,
                });
                addNotification('success', 'Rule added.');
            }
            onSaved();
        } catch (err) {
            addNotification(
                'error',
                `Failed to ${isEdit ? 'update' : 'add'} rule: ${(err as Error).message}`
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border border-dark-lighter rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-300">
                    {isEdit ? 'Edit Rule' : 'New Rule'}
                </span>
                <Button variant="link" size="xs" onClick={onCancel}>
                    Cancel
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <ChipSelect
                    label="Factions (empty = all)"
                    options={factionOptions}
                    selected={factions}
                    onChange={setFactions}
                />
                <ChipSelect
                    label="Rarities (empty = all)"
                    options={rarityOptions}
                    selected={rarities}
                    onChange={setRarities}
                />
                <ChipSelect
                    label="Ship Types (empty = all)"
                    options={shipTypeOptions}
                    selected={shipTypes}
                    onChange={setShipTypes}
                />
            </div>

            <div>
                <div className="text-xs text-gray-500 mb-1">Modifiers (%)</div>
                <div className="space-y-1">
                    {modifierPairs.map((pair, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <Select
                                value={pair.stat}
                                onChange={(val) =>
                                    setModifierPairs((prev) =>
                                        prev.map((p, i) =>
                                            i === index ? { ...p, stat: val as StatName } : p
                                        )
                                    )
                                }
                                options={[{ value: '', label: 'Select stat...' }, ...STAT_OPTIONS]}
                                className="w-48"
                            />
                            <Input
                                type="number"
                                value={pair.value}
                                onChange={(e) =>
                                    setModifierPairs((prev) =>
                                        prev.map((p, i) =>
                                            i === index
                                                ? { ...p, value: Number(e.target.value) }
                                                : p
                                        )
                                    )
                                }
                                placeholder="e.g. 150"
                                className="w-24"
                            />
                            {modifierPairs.length > 1 && (
                                <Button
                                    variant="link"
                                    size="xs"
                                    onClick={() =>
                                        setModifierPairs((prev) =>
                                            prev.filter((_, i) => i !== index)
                                        )
                                    }
                                    className="text-gray-500 hover:text-red-400"
                                >
                                    ✕
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
                <Button
                    variant="link"
                    size="xs"
                    onClick={() => setModifierPairs((prev) => [...prev, { stat: '', value: 0 }])}
                    className="mt-1 text-primary hover:text-primary/80"
                >
                    + Add modifier
                </Button>
            </div>

            <div className="flex justify-end">
                <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : isEdit ? 'Update Rule' : 'Save Rule'}
                </Button>
            </div>
        </div>
    );
};

// ─── Season Detail ───────────────────────────────────────────────────────────

interface SeasonDetailProps {
    season: ArenaSeason;
    onChanged: () => void;
}

const SeasonDetail: React.FC<SeasonDetailProps> = ({ season, onChanged }) => {
    const { addNotification } = useNotification();
    const [editName, setEditName] = useState(season.name);
    const [savingName, setSavingName] = useState(false);
    const [editEndDate, setEditEndDate] = useState(toDateValue(season.ends_at));
    const [savingEndDate, setSavingEndDate] = useState(false);
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [showAddRule, setShowAddRule] = useState(false);

    const handleSaveName = async () => {
        if (!editName.trim()) return;
        setSavingName(true);
        try {
            await updateSeason(season.id, editName.trim());
            addNotification('success', 'Season name updated.');
            onChanged();
        } catch (err) {
            addNotification('error', `Failed to update name: ${(err as Error).message}`);
        } finally {
            setSavingName(false);
        }
    };

    const handleSaveEndDate = async () => {
        const iso = editEndDate ? `${editEndDate}T01:00:00Z` : null;
        setSavingEndDate(true);
        try {
            await updateSeasonEndDate(season.id, iso);
            addNotification('success', 'End date updated.');
            onChanged();
        } catch (err) {
            addNotification('error', `Failed to update end date: ${(err as Error).message}`);
        } finally {
            setSavingEndDate(false);
        }
    };

    const handleClearEndDate = async () => {
        setSavingEndDate(true);
        try {
            await updateSeasonEndDate(season.id, null);
            setEditEndDate('');
            addNotification('success', 'End date cleared.');
            onChanged();
        } catch (err) {
            addNotification('error', `Failed to clear end date: ${(err as Error).message}`);
        } finally {
            setSavingEndDate(false);
        }
    };

    const handleDeleteRule = async (rule: ArenaSeasonRule) => {
        if (!window.confirm('Delete this rule?')) return;
        try {
            await deleteRule(rule.id);
            addNotification('success', 'Rule deleted.');
            onChanged();
        } catch (err) {
            addNotification('error', `Failed to delete rule: ${(err as Error).message}`);
        }
    };

    return (
        <div className="space-y-4 pt-2">
            {/* Season settings - compact inline */}
            <div className="flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                    <div className="text-xs text-gray-500 mb-1">Season Name</div>
                    <div className="flex gap-2">
                        <Input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                        />
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleSaveName}
                            disabled={savingName || !editName.trim()}
                        >
                            {savingName ? '...' : 'Save'}
                        </Button>
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-500 mb-1">End Date (01:00 UTC)</div>
                    <div className="flex gap-2">
                        <Input
                            type="date"
                            value={editEndDate}
                            onChange={(e) => setEditEndDate(e.target.value)}
                        />
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleSaveEndDate}
                            disabled={savingEndDate}
                        >
                            {savingEndDate ? '...' : 'Save'}
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={handleClearEndDate}
                            disabled={savingEndDate}
                        >
                            Clear
                        </Button>
                    </div>
                </div>
            </div>

            {/* Rules */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-300">
                        Rules ({season.rules.length})
                    </span>
                    {!showAddRule && (
                        <Button variant="primary" size="sm" onClick={() => setShowAddRule(true)}>
                            + Add Rule
                        </Button>
                    )}
                </div>

                {season.rules.length === 0 && !showAddRule ? (
                    <p className="text-gray-500 text-sm">No rules yet.</p>
                ) : (
                    <div className="space-y-2">
                        {season.rules.map((rule) =>
                            editingRuleId === rule.id ? (
                                <RuleForm
                                    key={rule.id}
                                    seasonId={season.id}
                                    existingRule={rule}
                                    onSaved={() => {
                                        setEditingRuleId(null);
                                        onChanged();
                                    }}
                                    onCancel={() => setEditingRuleId(null)}
                                />
                            ) : (
                                <div
                                    key={rule.id}
                                    className="flex items-center justify-between gap-4 p-2 rounded border border-dark-lighter hover:border-gray-600 transition-colors"
                                >
                                    <div className="min-w-0">
                                        <span className="text-sm text-gray-300">
                                            {buildFilterSummary(rule)}
                                        </span>
                                        <span className="text-gray-600 mx-2">|</span>
                                        <span className="text-sm text-primary">
                                            {buildModifierSummary(rule.modifiers)}
                                        </span>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => setEditingRuleId(rule.id)}
                                        >
                                            Edit
                                        </Button>
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() => handleDeleteRule(rule)}
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                )}

                {showAddRule && (
                    <div className="mt-2">
                        <RuleForm
                            seasonId={season.id}
                            onSaved={() => {
                                setShowAddRule(false);
                                onChanged();
                            }}
                            onCancel={() => setShowAddRule(false)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Main Tab ────────────────────────────────────────────────────────────────

export const ArenaModifiersTab: React.FC<ArenaModifiersTabProps> = ({
    seasons,
    onSeasonsChange,
}) => {
    const { addNotification } = useNotification();
    const [newSeasonName, setNewSeasonName] = useState('');
    const [creating, setCreating] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const hasActive = seasons.some((s) => s.active);

    const handleCreateSeason = async () => {
        if (!newSeasonName.trim()) return;
        setCreating(true);
        try {
            await createSeason(newSeasonName.trim());
            addNotification('success', `Season "${newSeasonName.trim()}" created.`);
            setNewSeasonName('');
            onSeasonsChange();
        } catch (err) {
            addNotification('error', `Failed to create season: ${(err as Error).message}`);
        } finally {
            setCreating(false);
        }
    };

    const handleDeactivateAll = async () => {
        if (!window.confirm('Deactivate all seasons?')) return;
        try {
            await deactivateAllSeasons();
            addNotification('success', 'All seasons deactivated.');
            onSeasonsChange();
        } catch (err) {
            addNotification('error', `Failed to deactivate seasons: ${(err as Error).message}`);
        }
    };

    const handleActivate = async (season: ArenaSeason) => {
        setActionLoading(season.id);
        try {
            await activateSeason(season.id);
            addNotification('success', `Season "${season.name}" activated.`);
            onSeasonsChange();
        } catch (err) {
            addNotification('error', `Failed to activate season: ${(err as Error).message}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDeactivate = async (season: ArenaSeason) => {
        setActionLoading(season.id);
        try {
            await deactivateAllSeasons();
            addNotification('success', `Season "${season.name}" deactivated.`);
            onSeasonsChange();
        } catch (err) {
            addNotification('error', `Failed to deactivate season: ${(err as Error).message}`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDelete = async (season: ArenaSeason) => {
        if (!window.confirm(`Delete season "${season.name}"? This will also delete all its rules.`))
            return;
        try {
            await deleteSeason(season.id);
            addNotification('success', `Season "${season.name}" deleted.`);
            if (expandedId === season.id) setExpandedId(null);
            onSeasonsChange();
        } catch (err) {
            addNotification('error', `Failed to delete season: ${(err as Error).message}`);
        }
    };

    const getStatusBadge = (season: ArenaSeason) => {
        if (season.active && isExpired(season.ends_at)) {
            return (
                <span className="px-2 py-0.5 rounded text-xs bg-red-700/30 text-red-400 border border-red-700/50">
                    Expired
                </span>
            );
        }
        if (season.active) {
            return (
                <span className="px-2 py-0.5 rounded text-xs bg-green-600/20 text-green-400 border border-green-600/40">
                    Active
                </span>
            );
        }
        return (
            <span className="px-2 py-0.5 rounded text-xs bg-gray-700/30 text-gray-500 border border-gray-700/50">
                Inactive
            </span>
        );
    };

    return (
        <div className="space-y-6">
            {/* Create + deactivate row */}
            <div className="card">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Arena Season Modifiers</h3>
                    {hasActive && (
                        <Button variant="danger" size="sm" onClick={handleDeactivateAll}>
                            Deactivate All
                        </Button>
                    )}
                </div>
                <div className="flex gap-2">
                    <Input
                        type="text"
                        value={newSeasonName}
                        onChange={(e) => setNewSeasonName(e.target.value)}
                        placeholder="New season name..."
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreateSeason();
                        }}
                    />
                    <Button
                        variant="primary"
                        onClick={handleCreateSeason}
                        disabled={creating || !newSeasonName.trim()}
                    >
                        {creating ? 'Creating...' : 'Create'}
                    </Button>
                </div>
            </div>

            {/* Seasons list */}
            {seasons.length === 0 ? (
                <div className="card text-center">
                    <p className="text-gray-400">No arena seasons yet. Create one above.</p>
                </div>
            ) : (
                <div className="card">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-dark-border">
                                <th className="text-left p-3 text-gray-400">Name</th>
                                <th className="text-left p-3 text-gray-400">Status</th>
                                <th className="text-left p-3 text-gray-400">Ends</th>
                                <th className="text-left p-3 text-gray-400">Rules</th>
                                <th className="text-right p-3 text-gray-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {seasons.map((season) => (
                                <React.Fragment key={season.id}>
                                    <tr className="border-b border-gray-800 hover:bg-dark transition-colors">
                                        <td className="p-3">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setExpandedId(
                                                        expandedId === season.id ? null : season.id
                                                    )
                                                }
                                                className="text-left hover:text-primary transition-colors font-medium"
                                            >
                                                {season.name}
                                                <span className="ml-1 text-gray-600 text-xs">
                                                    {expandedId === season.id ? '▲' : '▼'}
                                                </span>
                                            </button>
                                        </td>
                                        <td className="p-3">{getStatusBadge(season)}</td>
                                        <td className="p-3 text-gray-400 text-xs">
                                            {formatEndDate(season.ends_at)}
                                        </td>
                                        <td className="p-3 text-gray-400">{season.rules.length}</td>
                                        <td className="p-3 text-right">
                                            <div className="flex justify-end gap-2">
                                                {season.active ? (
                                                    <Button
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => handleDeactivate(season)}
                                                        disabled={actionLoading === season.id}
                                                    >
                                                        Deactivate
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        variant="primary"
                                                        size="sm"
                                                        onClick={() => handleActivate(season)}
                                                        disabled={actionLoading === season.id}
                                                    >
                                                        Activate
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="danger"
                                                    size="sm"
                                                    onClick={() => handleDelete(season)}
                                                    disabled={actionLoading === season.id}
                                                >
                                                    Delete
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                    {expandedId === season.id && (
                                        <tr>
                                            <td colSpan={5} className="p-4 bg-dark-lighter/20">
                                                <SeasonDetail
                                                    season={season}
                                                    onChanged={onSeasonsChange}
                                                />
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
