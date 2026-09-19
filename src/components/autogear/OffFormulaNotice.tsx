import React, { useState } from 'react';
import type { Ship } from '../../types/ship';
import { type ShipTypeName, SHIP_TYPES } from '../../constants/shipTypes';
import type { LimitableStat } from '../../types/stats';
import type { GearSuggestion, StatPriority } from '../../types/autogear';
import type { CombatStatsDeps } from '../../utils/ship/combatStats';
import {
    detectOffFormulaStats,
    type OffFormulaFinding,
} from '../../utils/autogear/simRerank/offFormulaStats';
import { Button } from '../ui';
import { OffFormulaTuningPanel } from './OffFormulaTuningPanel';

export interface OffFormulaTuningDeps {
    deps: CombatStatsDeps;
    runOptimizer: (
        stat: LimitableStat,
        priorities: StatPriority[]
    ) => Promise<{ suggestions: GearSuggestion[]; landed: number }>;
}

export interface OffFormulaNoticeProps {
    ship: Ship;
    /** The CONFIGURED autogear role, which can differ from `ship.type`. Null means Custom mode,
     *  where the detector returns nothing. */
    configuredRole: ShipTypeName | null;
    /** Wires the "Measure it" control. Omitted where a caller has no tuning support to offer —
     *  the notice still renders findings, just without the control. */
    tuning?: OffFormulaTuningDeps;
}

// Carries its own verb so subject-verb agreement is correct per entry ("damage scales" is
// singular, "repairs"/"shields" are plural).
const PRODUCES_LABEL: Record<OffFormulaFinding['produces'], string> = {
    damage: 'damage scales',
    repair: 'repairs scale',
    shield: 'shields scale',
};

const STAT_LABEL: Record<string, string> = {
    hp: 'HP',
    defence: 'Defence',
    attack: 'Attack',
    security: 'Security',
    shield: 'its shield pool',
};

const statLabel = (stat: string): string => STAT_LABEL[stat] ?? stat;

export const OffFormulaNotice: React.FC<OffFormulaNoticeProps> = ({
    ship,
    configuredRole,
    tuning,
}) => {
    const findings = detectOffFormulaStats(ship, configuredRole);
    if (findings.length === 0 || !configuredRole) return null;

    const roleLabel = SHIP_TYPES[configuredRole]?.name;

    return (
        <FindingsList
            ship={ship}
            configuredRole={configuredRole}
            roleLabel={roleLabel}
            findings={findings}
            tuning={tuning}
        />
    );
};

interface FindingsListProps {
    ship: Ship;
    configuredRole: ShipTypeName;
    roleLabel: string | undefined;
    findings: OffFormulaFinding[];
    tuning: OffFormulaTuningDeps | undefined;
}

/** Split out because `OffFormulaNotice` returns early (`findings.length === 0`) before any
 *  hook call — React forbids a hook after a conditional return, so `openKey`'s `useState` needs
 *  its own component that only mounts once there is something to show. */
const FindingsList: React.FC<FindingsListProps> = ({
    ship,
    configuredRole,
    roleLabel,
    findings,
    tuning,
}) => {
    const [openKey, setOpenKey] = useState<string | null>(null);

    return (
        <div className="card space-y-2">
            {findings.map((finding) => {
                const lever = finding.tunableStat;
                const key = `${finding.stat}-${finding.produces}-${lever ?? 'none'}`;
                const isOpen = openKey === key;
                // A collapsed finding names the lever explicitly, because the sentence has
                // already named a different stat as what the effect reads.
                const scored = lever && lever !== finding.stat ? statLabel(lever) : 'it';
                return (
                    <div key={key} className="space-y-2">
                        <p className="text-xs text-amber-400">
                            {ship.name}&apos;s {PRODUCES_LABEL[finding.produces]} off{' '}
                            {statLabel(finding.stat)}
                            {lever && lever !== finding.stat
                                ? `, which ${statLabel(lever)} drives`
                                : ''}
                            .{' '}
                            {finding.severity === 'severe'
                                ? `The ${roleLabel} formula does not score ${scored}.`
                                : `The ${roleLabel} formula scores ${scored} only as part of a total it can trade away for another stat.`}
                            {!lever && ' No gear stat moves it, so there is nothing to measure.'}
                        </p>
                        {tuning && lever && (
                            <Button
                                variant="link"
                                size="sm"
                                className="!p-0"
                                onClick={() => setOpenKey(isOpen ? null : key)}
                            >
                                {isOpen ? 'Hide measurement' : 'Measure it'}
                            </Button>
                        )}
                        {tuning && lever && isOpen && (
                            <OffFormulaTuningPanel
                                ship={ship}
                                configuredRole={configuredRole}
                                finding={{ ...finding, tunableStat: lever }}
                                deps={tuning.deps}
                                runOptimizer={tuning.runOptimizer}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
};
