import React from 'react';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';

interface Props {
    playerLabels: readonly string[];
    enemyLabels: readonly string[];
    onEdit: () => void;
}

/** The one-row stand-in for the setup toolbar and boards once a result is on screen. */
const SetupStrip: React.FC<Props> = ({ playerLabels, enemyLabels, onEdit }) => (
    <div data-testid="setup-strip" className="card flex flex-wrap items-center gap-2">
        {playerLabels.map((label) => (
            <Chip key={`p:${label}`}>{label}</Chip>
        ))}
        <span className="text-xs font-semibold text-theme-text-secondary">VS</span>
        {enemyLabels.map((label) => (
            <Chip key={`e:${label}`}>{label}</Chip>
        ))}
        <div className="ml-auto">
            <Button variant="secondary" size="sm" onClick={onEdit}>
                Edit setup
            </Button>
        </div>
    </div>
);

export default SetupStrip;
