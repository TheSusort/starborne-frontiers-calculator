import React from 'react';
import type { Ship } from '../../types/ship';
import { type ShipTypeName, SHIP_TYPES } from '../../constants/shipTypes';
import {
    detectOffFormulaStats,
    type OffFormulaFinding,
} from '../../utils/autogear/simRerank/offFormulaStats';

export interface OffFormulaNoticeProps {
    ship: Ship;
    /** The CONFIGURED autogear role, which can differ from `ship.type`. Null means Custom mode,
     *  where the detector returns nothing. */
    configuredRole: ShipTypeName | null;
}

const PRODUCES_LABEL: Record<OffFormulaFinding['produces'], string> = {
    damage: 'damage',
    repair: 'repairs',
    shield: 'shields',
};

const STAT_LABEL: Record<string, string> = {
    hp: 'HP',
    defence: 'Defence',
    attack: 'Attack',
    security: 'Security',
    shield: 'its shield pool',
};

export const OffFormulaNotice: React.FC<OffFormulaNoticeProps> = ({ ship, configuredRole }) => {
    const findings = detectOffFormulaStats(ship, configuredRole);
    if (findings.length === 0) return null;

    const roleLabel = configuredRole ? SHIP_TYPES[configuredRole]?.name : '';

    return (
        <div className="card space-y-2">
            {findings.map((finding) => (
                <p key={`${finding.stat}-${finding.produces}`} className="text-xs text-amber-400">
                    {ship.name}&apos;s {PRODUCES_LABEL[finding.produces]} scale off{' '}
                    {STAT_LABEL[finding.stat] ?? finding.stat}.{' '}
                    {finding.severity === 'severe'
                        ? `The ${roleLabel} formula does not score it.`
                        : `The ${roleLabel} formula scores it only as part of a total it can trade away for another stat.`}
                </p>
            ))}
        </div>
    );
};
