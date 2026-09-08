import React from 'react';
import { STATS } from '../../constants/stats';
import type { StatName } from '../../types/stats';
import { STAT_GUIDE, STAT_GROUPS } from './statGuideData';
import type { StatGroup } from './statGuideData';
// Re-export from the data module — see statGuideData.ts for the split rationale
export { STAT_GUIDE, NOT_A_GAME_STAT } from './statGuideData';

const STAT_NAMES = Object.keys(STAT_GUIDE) as StatName[];
const GROUPS = Object.keys(STAT_GROUPS) as StatGroup[];

/** Every row carries `id="stat-<name>"` so /basics#stat-security lands on the one stat, which is
 *  what a returning player pasting a link into chat actually wants. `data-testid` stays as the
 *  tripwire's hook. */
const StatGuideTable: React.FC = () => (
    <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm text-left">
            <thead className="hidden md:table-header-group">
                <tr className="border-b border-dark-border">
                    <th
                        scope="col"
                        className="w-40 py-2 px-4 font-medium text-theme-text-secondary"
                    >
                        Stat
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium text-theme-text-secondary">
                        What it does
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium text-theme-text-secondary">
                        Who wants it
                    </th>
                </tr>
            </thead>
            {GROUPS.map((group) => (
                <tbody key={group}>
                    <tr>
                        <th
                            scope="colgroup"
                            colSpan={3}
                            className={`bg-dark-lighter border-y border-dark-border border-l-4 py-1.5 px-4 text-left text-xs font-medium uppercase tracking-widest ${STAT_GROUPS[group].accent} ${STAT_GROUPS[group].text}`}
                        >
                            {STAT_GROUPS[group].title}
                        </th>
                    </tr>
                    {STAT_NAMES.filter((name) => STAT_GUIDE[name]!.group === group).map((name) => (
                        <tr
                            key={name}
                            id={`stat-${name}`}
                            data-testid={`stat-row-${name}`}
                            className="block md:table-row border-b border-dark-border last:border-0 align-top scroll-mt-24"
                        >
                            <th
                                scope="row"
                                className="block md:table-cell py-2 px-4 md:pb-3 md:pt-3 text-left font-medium text-primary"
                            >
                                {STATS[name].label}
                            </th>
                            <td className="block md:table-cell px-4 pb-1 md:py-3 md:pl-0 md:pr-4 text-theme-text">
                                {STAT_GUIDE[name]!.does}
                            </td>
                            <td className="block md:table-cell px-4 pb-3 md:py-3 md:pr-4 text-theme-text-secondary">
                                {/* Stacked on a phone the two columns lose their header row, so
                                    the second one names itself. */}
                                <span className="md:hidden text-xs uppercase tracking-wide">
                                    Who wants it —{' '}
                                </span>
                                {STAT_GUIDE[name]!.wants}
                            </td>
                        </tr>
                    ))}
                </tbody>
            ))}
        </table>
    </div>
);

export default StatGuideTable;
