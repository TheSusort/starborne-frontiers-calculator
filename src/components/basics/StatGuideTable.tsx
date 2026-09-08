import React from 'react';
import { STATS } from '../../constants/stats';
import type { StatName } from '../../types/stats';
import { STAT_GUIDE } from './statGuideData';
// Re-export from the data module — see statGuideData.ts for the split rationale
export { STAT_GUIDE, NOT_A_GAME_STAT } from './statGuideData';

const StatGuideTable: React.FC = () => (
    <div className="card overflow-x-auto">
        <table className="w-full text-sm text-left">
            <thead>
                <tr className="border-b border-dark-border">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                        Stat
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                        What it does
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                        Who wants it
                    </th>
                </tr>
            </thead>
            <tbody>
                {(Object.keys(STAT_GUIDE) as StatName[]).map((name) => (
                    <tr key={name} className="border-b border-dark-border last:border-0 align-top">
                        <td className="py-2 pr-4 font-medium text-primary whitespace-nowrap">
                            {STATS[name].label}
                        </td>
                        <td className="py-2 pr-4 text-theme-text">{STAT_GUIDE[name]!.does}</td>
                        <td className="py-2 text-theme-text-secondary">
                            {STAT_GUIDE[name]!.wants}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

export default StatGuideTable;
