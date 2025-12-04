import React from 'react';
import { DiffResult } from '../../types/diff';
import { DiffSummaryComponent } from './DiffSummary';
import { DiffGroupComponent } from './DiffGroup';
import { groupResults, getDiffSummary } from '../../utils/diff/groupingUtils';

interface DiffResultsProps {
    diffResults: DiffResult[];
}

export const DiffResults: React.FC<DiffResultsProps> = ({ diffResults }) => {
    if (diffResults.length === 0) {
        return null;
    }

    const summary = getDiffSummary(diffResults);
    const groupedResults = groupResults(diffResults);

    return (
        <div className="space-y-6">
            <DiffSummaryComponent summary={summary} />

            <div className="card">
                <h3 className="text-lg font-bold mb-4">Detailed Changes</h3>
                <div className="space-y-4">
                    {groupedResults.map((group, groupIndex) => (
                        <DiffGroupComponent
                            key={`${group.type}-${groupIndex}`}
                            group={group}
                            groupIndex={groupIndex}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};
