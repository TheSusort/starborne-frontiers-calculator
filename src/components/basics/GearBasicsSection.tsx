import React from 'react';
import { SLOT_MAIN_STATS, STATS } from '../../constants/stats';
import { GEAR_SETS } from '../../constants/gearSets';
import { GEAR_SLOTS } from '../../constants/gearTypes';
import type { Stat } from '../../types/stats';

/** A set with no `minPieces` pays out at 2. */
const piecesFor = (minPieces: number | undefined): number => minPieces ?? 2;

/** One set's bonus as a short line: its stats, then its special effect if it has one. */
const setEffect = (
    stats: Stat[],
    description: string | Record<string, string> | undefined
): string => {
    const statPart = stats
        .map((s) => `+${s.value}${s.type === 'percentage' ? '%' : ''} ${STATS[s.name].label}`)
        .join(', ');
    const descPart = typeof description === 'string' ? description : '';
    return [statPart, descPart].filter(Boolean).join(' — ');
};

const GearBasicsSection: React.FC = () => (
    <div className="space-y-6">
        <div className="card overflow-x-auto">
            <h3 className="font-semibold mb-3">Not every slot rolls every stat</h3>
            <p className="text-sm text-theme-text-secondary mb-3">
                The three fixed slots always roll the same primary stat. The other three are where
                your build actually gets decided — a ship only gets hacking or security from its
                software slot, and only gets speed from its thrusters.
            </p>
            <table className="w-full text-sm text-left">
                <thead>
                    <tr className="border-b border-dark-border">
                        <th scope="col" className="py-2 pr-4 font-semibold">
                            Slot
                        </th>
                        <th scope="col" className="py-2 font-semibold">
                            Possible primary stats
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {Object.keys(SLOT_MAIN_STATS).map((slot) => (
                        <tr
                            key={slot}
                            data-testid={`slot-row-${slot}`}
                            className="border-b border-dark-border last:border-0"
                        >
                            <td className="py-2 pr-4 font-medium text-primary whitespace-nowrap">
                                {GEAR_SLOTS[slot].label}
                            </td>
                            <td className="py-2 text-theme-text">
                                {SLOT_MAIN_STATS[slot].map((s) => STATS[s].label).join(', ')}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        <div className="card overflow-x-auto">
            <h3 className="font-semibold mb-3">Sets pay out at 2 or 4 pieces</h3>
            <p className="text-sm text-theme-text-secondary mb-3">
                A set bonus only applies once you have enough matching pieces equipped, and most
                two-piece sets pay out again for each further pair. Six pieces of a two-piece set is
                three times the bonus.
            </p>
            <table className="w-full text-sm text-left">
                <thead>
                    <tr className="border-b border-dark-border">
                        <th scope="col" className="py-2 pr-4 font-semibold">
                            Set
                        </th>
                        <th scope="col" className="py-2 pr-4 font-semibold">
                            Pieces
                        </th>
                        <th scope="col" className="py-2 font-semibold">
                            Bonus
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {Object.values(GEAR_SETS).map((set) => (
                        <tr
                            key={set.name}
                            data-testid={`set-row-${set.name}`}
                            className="border-b border-dark-border last:border-0 align-top"
                        >
                            <td className="py-2 pr-4 font-medium text-primary whitespace-nowrap">
                                {set.name}
                            </td>
                            <td className="py-2 pr-4 text-theme-text-secondary">
                                {piecesFor(set.minPieces)}
                            </td>
                            <td className="py-2 text-theme-text">
                                {setEffect(set.stats, set.description)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

export default GearBasicsSection;
