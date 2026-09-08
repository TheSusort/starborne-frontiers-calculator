import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { SLOT_MAIN_STATS, STATS } from '../../constants/stats';
import { GEAR_SETS } from '../../constants/gearSets';
import { GEAR_SLOTS } from '../../constants/gearTypes';
// Imported per-module, not from the `../ui` barrel: the barrel re-exports Sidebar, whose
// `/favicon.ico?url` import vitest refuses to resolve unless the test stubs Sidebar out.
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { GroupLabel } from '../ui/GroupLabel';
import { CollapsibleForm } from '../ui/layout/CollapsibleForm';
import type { Stat } from '../../types/stats';

/** A set with no `minPieces` pays out at 2. */
const piecesFor = (minPieces: number | undefined): number => minPieces ?? 2;

/** One set's bonus as a short line: its stats, then its special effect if it has one.
 *  `description` is `string | undefined` only — no entry in GEAR_SETS uses the
 *  `Record<string, string>` shape `GearSetBonus.description` still permits, so the caller
 *  filters that out before calling (same string-only guard GearPieceDisplay uses on the
 *  same field) rather than this function pretending to format an object. */
const setEffect = (stats: Stat[], description: string | undefined): string => {
    const statPart = stats
        .map((s) => `+${s.value}${s.type === 'percentage' ? '%' : ''} ${STATS[s.name].label}`)
        .join(', ');
    return [statPart, description].filter(Boolean).join(' — ');
};

/** `id="set-abyssal-assault"`, so a set can be linked to directly from chat or a guide. */
const slugify = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const SLOTS = Object.keys(SLOT_MAIN_STATS);
/** A slot that rolls exactly one primary stat is a fixed slot — derived, so adding a stat to
 *  `SLOT_MAIN_STATS` moves the slot between the two groups instead of leaving a stale list. */
const isFixed = (slot: string): boolean => SLOT_MAIN_STATS[slot].length === 1;

const SlotCard: React.FC<{ slot: string }> = ({ slot }) => (
    <div data-testid={`slot-row-${slot}`} className="card space-y-2">
        <h4 className="text-sm font-semibold text-primary">{GEAR_SLOTS[slot].label}</h4>
        <div className="flex flex-wrap gap-1.5">
            {SLOT_MAIN_STATS[slot].map((stat) => (
                <Chip key={stat}>{STATS[stat].label}</Chip>
            ))}
        </div>
    </div>
);

const GearBasicsSection: React.FC = () => {
    // A /basics#set-* deep link has to land on a visible row: CollapsibleForm renders a closed
    // panel at max-h-0, so scrollIntoView on a collapsed set finds nothing to show.
    const [showSets, setShowSets] = useState(
        () => typeof window !== 'undefined' && window.location.hash.startsWith('#set-')
    );
    const setCount = Object.keys(GEAR_SETS).length;

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <div>
                    <h3 className="text-base font-semibold mb-1">
                        Not every slot rolls every stat
                    </h3>
                    <p className="text-sm text-theme-text-secondary max-w-[68ch]">
                        The three fixed slots always roll the same primary stat. The other three are
                        where your build actually gets decided — a ship only gets hacking or
                        security from its software slot, and only gets speed from its thrusters.
                    </p>
                </div>

                {/* Both groups across one row from xl: six slots at a glance is the comparison
                    the section is about, and a wide screen should buy that rather than air. */}
                <div className="grid gap-4 xl:grid-cols-2">
                    <div>
                        <GroupLabel className="mb-2">Fixed slots</GroupLabel>
                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                            {SLOTS.filter(isFixed).map((slot) => (
                                <SlotCard key={slot} slot={slot} />
                            ))}
                        </div>
                    </div>

                    <div>
                        <GroupLabel className="mb-2">Flexible slots</GroupLabel>
                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                            {SLOTS.filter((slot) => !isFixed(slot)).map((slot) => (
                                <SlotCard key={slot} slot={slot} />
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="card">
                <h3 className="text-base font-semibold mb-1">Sets pay out at 2 or 4 pieces</h3>
                <p className="text-sm text-theme-text-secondary mb-3 max-w-[68ch]">
                    A set bonus only applies once you have enough matching pieces equipped, and most
                    two-piece sets pay out again for each further pair. Six pieces of a two-piece
                    set is three times the bonus.
                </p>
                <Button
                    variant="secondary"
                    size="sm"
                    aria-expanded={showSets}
                    aria-controls="gear-set-reference"
                    onClick={() => setShowSets((open) => !open)}
                    className="inline-flex items-center gap-2"
                >
                    All {setCount} set bonuses
                    {showSets ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </Button>
                <CollapsibleForm isVisible={showSets}>
                    <div id="gear-set-reference" className="overflow-x-auto mt-3">
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
                                        id={`set-${slugify(set.name)}`}
                                        data-testid={`set-row-${set.name}`}
                                        className="border-b border-dark-border last:border-0 align-top scroll-mt-24"
                                    >
                                        <td className="py-2 pr-4 font-medium text-primary whitespace-nowrap">
                                            {set.name}
                                        </td>
                                        <td className="py-2 pr-4 text-theme-text-secondary">
                                            {piecesFor(set.minPieces)}
                                        </td>
                                        <td className="py-2 text-theme-text">
                                            {setEffect(
                                                set.stats,
                                                typeof set.description === 'string'
                                                    ? set.description
                                                    : undefined
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CollapsibleForm>
            </div>
        </div>
    );
};

export default GearBasicsSection;
