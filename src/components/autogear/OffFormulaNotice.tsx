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

/** Split out so `openKey` can track which finding's panel is expanded without re-running
 *  `detectOffFormulaStats` on every keystroke inside that panel's own seed/run-count inputs. */
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
                const key = `${finding.stat}-${finding.produces}`;
                const isOpen = openKey === key;
                return (
                    <div key={key} className="space-y-2">
                        <p className="text-xs text-amber-400">
                            {ship.name}&apos;s {PRODUCES_LABEL[finding.produces]} off{' '}
                            {STAT_LABEL[finding.stat] ?? finding.stat}.{' '}
                            {finding.severity === 'severe'
                                ? `The ${roleLabel} formula does not score it.`
                                : `The ${roleLabel} formula scores it only as part of a total it can trade away for another stat.`}
                        </p>
                        {tuning && (
                            <Button
                                variant="link"
                                size="sm"
                                className="!p-0"
                                onClick={() => setOpenKey(isOpen ? null : key)}
                            >
                                {isOpen ? 'Hide measurement' : 'Measure it'}
                            </Button>
                        )}
                        {tuning && isOpen && (
                            <OffFormulaTuningPanel
                                ship={ship}
                                configuredRole={configuredRole}
                                finding={finding}
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
