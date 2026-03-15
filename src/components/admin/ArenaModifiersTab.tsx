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
    // Convert ISO string to date input format (YYYY-MM-DD) in UTC
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

// ─── Multi-select checkbox group ─────────────────────────────────────────────

interface CheckboxGroupProps {
    label: string;
    options: { key: string; label: string }[];
    selected: string[];
    onChange: (selected: string[]) => void;
}

const CheckboxGroup: React.FC<CheckboxGroupProps> = ({ label, options, selected, onChange }) => {
    const toggle = (key: string) => {
        if (selected.includes(key)) {
            onChange(selected.filter((k) => k !== key));
        } else {
            onChange([...selected, key]);
        }
    };

    return (
        <div>
            <div className="text-xs font-medium text-gray-400 mb-1">{label}</div>
            <div className="flex flex-wrap gap-1">
                {options.map(({ key, label: optLabel }) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => toggle(key)}
                        className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                            selected.includes(key)
                                ? 'bg-primary text-white border-primary'
                                : 'bg-transparent text-gray-400 border-dark-lighter hover:border-gray-500'
                        }`}
                    >
                        {optLabel}
                    </button>
                ))}
            </div>
        </div>
    );
};

// ─── Add Rule Form ────────────────────────────────────────────────────────────

interface AddRuleFormProps {
    seasonId: string;
    onRuleAdded: () => void;
}

const AddRuleForm: React.FC<AddRuleFormProps> = ({ seasonId, onRuleAdded }) => {
    const { addNotification } = useNotification();
    const [factions, setFactions] = useState<string[]>([]);
    const [rarities, setRarities] = useState<string[]>([]);
    const [shipTypes, setShipTypes] = useState<string[]>([]);
    const [modifierPairs, setModifierPairs] = useState<ModifierPair[]>([{ stat: '', value: 0 }]);
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

    const updatePairStat = (index: number, stat: string) => {
        setModifierPairs((prev) =>
            prev.map((p, i) => (i === index ? { ...p, stat: stat as StatName } : p))
        );
    };

    const updatePairValue = (index: number, value: number) => {
        setModifierPairs((prev) => prev.map((p, i) => (i === index ? { ...p, value } : p)));
    };

    const removePair = (index: number) => {
        setModifierPairs((prev) => prev.filter((_, i) => i !== index));
    };

    const addPair = () => {
        setModifierPairs((prev) => [...prev, { stat: '', value: 0 }]);
    };

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
            await createRule(seasonId, {
                factions: factions.length > 0 ? factions : null,
                rarities: rarities.length > 0 ? rarities : null,
                ship_types: shipTypes.length > 0 ? shipTypes : null,
                modifiers,
            });
            addNotification('success', 'Rule added.');
            setFactions([]);
            setRarities([]);
            setShipTypes([]);
            setModifierPairs([{ stat: '', value: 0 }]);
            onRuleAdded();
        } catch (err) {
            addNotification('error', `Failed to add rule: ${(err as Error).message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-dark p-4 rounded border border-dark-lighter space-y-4">
            <div className="text-sm font-medium text-gray-300">Add Rule</div>

            <CheckboxGroup
                label="Factions (empty = all)"
                options={factionOptions}
                selected={factions}
                onChange={setFactions}
            />

            <CheckboxGroup
                label="Rarities (empty = all)"
                options={rarityOptions}
                selected={rarities}
                onChange={setRarities}
            />

            <CheckboxGroup
                label="Ship Types (empty = all)"
                options={shipTypeOptions}
                selected={shipTypes}
                onChange={setShipTypes}
            />

            <div>
                <div className="text-xs font-medium text-gray-400 mb-2">Modifiers (%)</div>
                <div className="space-y-2">
                    {modifierPairs.map((pair, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <div className="flex-1">
                                <Select
                                    value={pair.stat}
                                    onChange={(val) => updatePairStat(index, val)}
                                    options={[
                                        { value: '', label: 'Select stat...' },
                                        ...STAT_OPTIONS,
                                    ]}
                                />
                            </div>
                            <div className="w-28">
                                <Input
                                    type="number"
                                    value={pair.value}
                                    onChange={(e) => updatePairValue(index, Number(e.target.value))}
                                    placeholder="e.g. 150"
                                />
                            </div>
                            {modifierPairs.length > 1 && (
                                <button
                                    type="button"
                                    onClick={() => removePair(index)}
                                    className="text-gray-500 hover:text-red-400 transition-colors text-sm px-1"
                                    aria-label="Remove modifier"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={addPair}
                    className="mt-2 text-xs text-primary hover:text-primary/80 transition-colors"
                >
                    + Add modifier
                </button>
            </div>

            <div className="flex justify-end">
                <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Rule'}
                </Button>
            </div>
        </div>
    );
};

// ─── Season Detail ────────────────────────────────────────────────────────────

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
        // Server resets at 01:00 UTC, so always set end time to 01:00 UTC on the selected date
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
        <div className="space-y-6 pt-2">
            {/* Edit name */}
            <div>
                <div className="text-xs font-medium text-gray-400 mb-1">Season Name</div>
                <div className="flex gap-2">
                    <Input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Season name"
                    />
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleSaveName}
                        disabled={savingName || !editName.trim()}
                    >
                        {savingName ? 'Saving...' : 'Save'}
                    </Button>
                </div>
            </div>

            {/* Edit end date */}
            <div>
                <div className="text-xs font-medium text-gray-400 mb-1">End Date</div>
                <div className="flex gap-2 flex-wrap">
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
                        {savingEndDate ? 'Saving...' : 'Save'}
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

            {/* Rules */}
            <div>
                <div className="text-sm font-medium text-gray-300 mb-2">
                    Rules ({season.rules.length})
                </div>
                {season.rules.length === 0 ? (
                    <p className="text-gray-500 text-sm">No rules yet.</p>
                ) : (
                    <div className="space-y-2">
                        {season.rules.map((rule) => (
                            <div
                                key={rule.id}
                                className="flex items-start justify-between gap-4 bg-dark p-3 rounded border border-dark-lighter"
                            >
                                <div className="space-y-0.5 min-w-0">
                                    <div className="text-sm text-gray-300">
                                        {buildFilterSummary(rule)}
                                    </div>
                                    <div className="text-xs text-primary">
                                        {buildModifierSummary(rule.modifiers)}
                                    </div>
                                </div>
                                <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => handleDeleteRule(rule)}
                                >
                                    Delete
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Add rule form */}
            <AddRuleForm seasonId={season.id} onRuleAdded={onChanged} />
        </div>
    );
};

// ─── Main Tab ─────────────────────────────────────────────────────────────────

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
        if (season.active) {
            if (isExpired(season.ends_at)) {
                return (
                    <span className="px-2 py-0.5 rounded text-xs bg-red-700 text-white">
                        Expired
                    </span>
                );
            }
            return (
                <span className="px-2 py-0.5 rounded text-xs bg-green-600 text-white">Active</span>
            );
        }
        return (
            <span className="px-2 py-0.5 rounded text-xs bg-gray-600 text-gray-300">Inactive</span>
        );
    };

    return (
        <div className="space-y-6">
            {/* Create season form */}
            <div className="card">
                <h3 className="text-lg font-semibold mb-4">Arena Season Modifiers</h3>
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
                        {creating ? 'Creating...' : 'Create Season'}
                    </Button>
                </div>
            </div>

            {/* Deactivate all button */}
            {hasActive && (
                <div className="flex justify-end">
                    <Button variant="danger" size="sm" onClick={handleDeactivateAll}>
                        Deactivate All Seasons
                    </Button>
                </div>
            )}

            {/* Seasons list */}
            {seasons.length === 0 ? (
                <div className="card text-center">
                    <p className="text-gray-400">No arena seasons yet. Create one above.</p>
                </div>
            ) : (
                <div className="card">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-gray-400">
                                <th className="pb-2">Name</th>
                                <th className="pb-2">Status</th>
                                <th className="pb-2">Ends</th>
                                <th className="pb-2">Rules</th>
                                <th className="pb-2 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {seasons.map((season) => (
                                <React.Fragment key={season.id}>
                                    <tr className="border-t border-dark-lighter">
                                        <td className="py-2 pr-4">
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
                                                <span className="ml-1 text-gray-500 text-xs">
                                                    {expandedId === season.id ? '▲' : '▼'}
                                                </span>
                                            </button>
                                        </td>
                                        <td className="py-2 pr-4">{getStatusBadge(season)}</td>
                                        <td className="py-2 pr-4 text-gray-400 text-xs">
                                            {formatEndDate(season.ends_at)}
                                        </td>
                                        <td className="py-2 pr-4 text-gray-400">
                                            {season.rules.length}
                                        </td>
                                        <td className="py-2 text-right space-x-2">
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
                                        </td>
                                    </tr>
                                    {expandedId === season.id && (
                                        <tr>
                                            <td
                                                colSpan={5}
                                                className="pb-4 pt-2 px-2 bg-dark-lighter/30"
                                            >
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
