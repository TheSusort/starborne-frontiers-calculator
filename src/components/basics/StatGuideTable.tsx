import React from 'react';
import { STATS } from '../../constants/stats';
import type { StatName } from '../../types/stats';
import { STAT_GUIDE, STAT_GROUPS } from './statGuideData';
import type { StatGroup } from './statGuideData';
// Re-export from the data module — see statGuideData.ts for the split rationale
export { STAT_GUIDE, NOT_A_GAME_STAT } from './statGuideData';

const STAT_NAMES = Object.keys(STAT_GUIDE) as StatName[];

const StatGuideTable: React.FC = () => (
    <div className="space-y-4">
        {(Object.keys(STAT_GROUPS) as StatGroup[]).map((group) => {
            const { title, accent, text } = STAT_GROUPS[group];
            const names = STAT_NAMES.filter((name) => STAT_GUIDE[name]!.group === group);
            return (
                <div key={group} className={`card border-l-4 ${accent}`}>
                    <h3
                        className={`text-sm font-semibold uppercase tracking-wide font-secondary mb-3 ${text}`}
                    >
                        {title}
                    </h3>
                    <dl className="divide-y divide-dark-border">
                        {names.map((name) => (
                            <div
                                key={name}
                                data-testid={`stat-row-${name}`}
                                className="grid md:grid-cols-[9rem_minmax(0,1fr)] gap-x-4 py-3 first:pt-0 last:pb-0"
                            >
                                <dt className="font-medium text-primary">{STATS[name].label}</dt>
                                <dd className="text-sm space-y-1">
                                    <p className="text-theme-text">{STAT_GUIDE[name]!.does}</p>
                                    <p className="text-theme-text-secondary">
                                        <span className="text-xs uppercase tracking-wide">
                                            Who wants it
                                        </span>{' '}
                                        — {STAT_GUIDE[name]!.wants}
                                    </p>
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            );
        })}
    </div>
);

export default StatGuideTable;
