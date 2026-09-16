import React, { useMemo, useState } from 'react';
import { Button, Checkbox, ChevronDownIcon, Input, Select } from '../ui';
import { randomSeed } from '../simulator/SeedRunControls';
import { clampRunCount, clampSeed } from '../../utils/simulator/seedRunInputs';
import type { Ship } from '../../types/ship';
import type { LocalEncounterNote } from '../../types/encounters';
import type { SimulatorSetup } from '../../utils/simulator/simulatorSetup';
import type { CombatStatsDeps } from '../../utils/ship/combatStats';
import type { FightSource } from '../../utils/autogear/simRerank/fightSources';
import type { AutogearResult } from '../../utils/autogear/AutogearStrategy';
import { type ShipTypeName } from '../../constants';
import { defaultComparedRoles } from '../../utils/autogear/simRerank/comparedRoles';
import { suggestedPrimary, type SimMetric } from '../../utils/autogear/simRerank/metricTable';
import { useSimRerank, type SimRerankRow } from '../../hooks/useSimRerank';
import {
    metricSortScore,
    roleRankLabel,
    SimRerankTable,
    type SimRerankTableRow,
} from './SimRerankTable';

const DEFAULT_RUN_COUNT = 20;

interface SourceOption {
    key: string;
    label: string;
    source: FightSource;
}

/** Every source whose player side names this ship: the practice fight always, plus any encounter
 *  or saved setup the ship actually appears in — offering one it is not part of would let the
 *  comparison run against a board the ship never fights on. */
function buildSourceOptions(
    ship: Ship,
    encounters: LocalEncounterNote[],
    savedSetups: SimulatorSetup[]
): SourceOption[] {
    const options: SourceOption[] = [
        { key: 'practice', label: 'Practice fight', source: { kind: 'practice' } },
    ];
    for (const note of encounters) {
        if (note.formation.some((entry) => entry.shipId === ship.id)) {
            options.push({
                key: `encounter:${note.id}`,
                label: note.name,
                source: { kind: 'encounter', note },
            });
        }
    }
    savedSetups.forEach((setup, index) => {
        const hasShip = Object.values(setup.playerBoard).some(
            (placement) => placement?.shipId === ship.id
        );
        if (hasShip) {
            options.push({
                key: `setup:${index}`,
                label: setup.name,
                source: { kind: 'setup', setup },
            });
        }
    });
    return options;
}

export interface SimRerankSectionProps {
    ship: Ship;
    encounters: LocalEncounterNote[];
    savedSetups: SimulatorSetup[];
    deps: CombatStatsDeps;
    getShipById: (id: string) => Ship | undefined;
    gearToShipMap: Map<string, string>;
    resolveShip: (shipId: string) => Ship | null;
    /** Runs the configured autogear strategy under one role. Injected by the page, which already
     *  owns the inventory, priorities and settings this needs. */
    runAutogearFor: (role: ShipTypeName) => Promise<AutogearResult>;
    /** Equips a row's build onto the ship, via the same path as applying autogear's own
     *  suggestion today. */
    onApply: (row: SimRerankRow) => void;
}

/**
 * A collapsed, opt-in section that compares candidate gear builds — the ship's own role plus a
 * handful of others — by running each through the combat simulator against one fixed fight and
 * showing every metric as a paired delta against the equipped baseline. Off by default: the run
 * costs real compute (an optimizer pass per compared role, then a seed set per surviving build).
 */
export const SimRerankSection: React.FC<SimRerankSectionProps> = ({
    ship,
    encounters,
    savedSetups,
    deps,
    getShipById,
    gearToShipMap,
    resolveShip,
    runAutogearFor,
    onApply,
}) => {
    const [open, setOpen] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [seed, setSeed] = useState(() => randomSeed());
    const [runCount, setRunCount] = useState(DEFAULT_RUN_COUNT);
    const [sort, setSort] = useState<{ metric: SimMetric; direction: 'asc' | 'desc' }>(() => ({
        metric: suggestedPrimary(ship.type),
        direction: 'desc',
    }));

    const sourceOptions = useMemo(
        () => buildSourceOptions(ship, encounters, savedSetups),
        [ship, encounters, savedSetups]
    );
    const [sourceKey, setSourceKey] = useState('practice');
    const selectedSource =
        sourceOptions.find((option) => option.key === sourceKey) ?? sourceOptions[0];

    const availableRoles = useMemo(() => defaultComparedRoles(ship.type), [ship.type]);
    const [excludedRoles, setExcludedRoles] = useState<Set<ShipTypeName>>(new Set());
    const toggleRole = (role: ShipTypeName, checked: boolean) => {
        setExcludedRoles((prev) => {
            const next = new Set(prev);
            if (checked) next.delete(role);
            else next.add(role);
            return next;
        });
    };

    const { state, run, cancel } = useSimRerank();
    const isRunning = state.status === 'gearing' || state.status === 'simulating';

    const handleRun = () => {
        void run({
            focus: ship,
            source: selectedSource.source,
            comparedRoles: availableRoles.filter((role) => !excludedRoles.has(role)),
            seed,
            runCount,
            deps,
            getShipById,
            gearToShipMap,
            resolveShip,
            runAutogearFor,
        });
    };

    const tableRows = useMemo<SimRerankTableRow[]>(() => {
        const rowsById = new Map(state.rows.map((row) => [row.id, row]));
        const merged: SimRerankTableRow[] = [];
        for (const entry of state.table) {
            const row = rowsById.get(entry.id);
            if (row) merged.push({ row, cells: entry.cells });
        }
        return [...merged].sort((a, b) => {
            const diff =
                metricSortScore(a.cells[sort.metric]) - metricSortScore(b.cells[sort.metric]);
            return sort.direction === 'desc' ? -diff : diff;
        });
    }, [state.table, state.rows, sort]);

    const handleSort = (metric: SimMetric) => {
        setSort((prev) =>
            prev.metric === metric
                ? { metric, direction: prev.direction === 'desc' ? 'asc' : 'desc' }
                : { metric, direction: 'desc' }
        );
    };

    return (
        <div className="card space-y-3">
            <Button
                variant="link"
                onClick={() => setOpen(!open)}
                className="w-full flex justify-between items-center"
            >
                <span className="flex items-center gap-2">
                    <ChevronDownIcon
                        className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${
                            open ? 'rotate-180' : ''
                        }`}
                    />
                    Simulate candidates
                </span>
            </Button>

            {open && (
                <div className="space-y-4">
                    <p className="text-xs text-theme-text-secondary">
                        Runs this ship&apos;s build, plus a handful of other roles, through the
                        combat simulator against one fight and compares every metric to what is
                        equipped now. Off by default because it costs real compute.
                    </p>

                    <Select
                        label="Fight source"
                        value={sourceKey}
                        onChange={setSourceKey}
                        options={sourceOptions.map((option) => ({
                            value: option.key,
                            label: option.label,
                        }))}
                    />
                    {selectedSource.source.kind !== 'setup' && (
                        <p className="text-xs text-amber-400">
                            This is not a real team fight — the practice enemy stands in for a real
                            opponent, so the result won&apos;t reflect the board you actually face.
                        </p>
                    )}

                    <div className="space-y-2">
                        <span className="text-xs uppercase tracking-wide text-theme-text-secondary">
                            Compare against
                        </span>
                        <div className="flex flex-wrap gap-4">
                            {availableRoles.map((role) => (
                                <Checkbox
                                    key={role}
                                    label={roleRankLabel(undefined, role, 'best')}
                                    checked={!excludedRoles.has(role)}
                                    onChange={(checked) => toggleRole(role, checked)}
                                />
                            ))}
                        </div>
                    </div>

                    <div>
                        <Button
                            variant="link"
                            size="sm"
                            className="!p-0"
                            onClick={() => setAdvancedOpen(!advancedOpen)}
                        >
                            Advanced
                        </Button>
                        {advancedOpen && (
                            <div className="flex gap-3 items-end mt-2">
                                <Input
                                    label="Seed"
                                    type="number"
                                    value={seed}
                                    onChange={(e) => setSeed(clampSeed(Number(e.target.value)))}
                                    className="max-w-[10rem]"
                                    disabled={isRunning}
                                />
                                <Input
                                    label="Runs"
                                    type="number"
                                    value={runCount}
                                    onChange={(e) =>
                                        setRunCount(clampRunCount(Number(e.target.value)))
                                    }
                                    className="max-w-[6rem]"
                                    disabled={isRunning}
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        {isRunning ? (
                            <Button variant="secondary" onClick={cancel}>
                                Cancel
                            </Button>
                        ) : (
                            <Button variant="primary" onClick={handleRun}>
                                Run
                            </Button>
                        )}
                        {isRunning && (
                            <span aria-live="polite" className="text-sm text-theme-text-secondary">
                                {state.status === 'gearing' ? 'Gearing' : 'Simulating'}{' '}
                                {Math.round(state.progress.completed)} / {state.progress.total}
                            </span>
                        )}
                        {state.status === 'cancelled' && (
                            <span className="text-sm text-theme-text-secondary">Cancelled.</span>
                        )}
                        {state.error && <span className="text-sm text-red-400">{state.error}</span>}
                    </div>

                    {state.dropped.length > 0 && (
                        <p className="text-sm text-amber-400">
                            {state.dropped.length} ship{state.dropped.length === 1 ? '' : 's'} in
                            this setup no longer exist — the fight ran without them.
                        </p>
                    )}

                    {state.ownBestExcluded && (
                        <p className="text-sm text-amber-400">
                            This ship&apos;s own suggested build was not evaluated: it needs gear
                            worn by another ship already in this fight.
                        </p>
                    )}

                    {state.excluded.length > 0 && (
                        <div className="text-sm text-theme-text-secondary space-y-1">
                            <p>
                                {state.excluded.length} candidate build
                                {state.excluded.length === 1 ? '' : 's'} could not be evaluated —
                                each needs gear worn by a ship already in this fight:
                            </p>
                            <ul className="list-disc list-inside">
                                {state.excluded.map((excluded, index) => (
                                    <li key={index}>
                                        {roleRankLabel(ship.type, excluded.role, excluded.rank)}{' '}
                                        needs{' '}
                                        {Array.from(
                                            new Set(
                                                excluded.stripped.map((piece) => piece.fromShipName)
                                            )
                                        ).join(', ')}
                                        &apos;s gear.
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {state.status === 'done' && (
                        <SimRerankTable
                            ownRole={ship.type}
                            rows={tableRows}
                            suggestedPrimary={suggestedPrimary(ship.type)}
                            sortMetric={sort.metric}
                            sortDirection={sort.direction}
                            onSort={handleSort}
                            onApply={onApply}
                        />
                    )}
                </div>
            )}
        </div>
    );
};
