import React from 'react';
import { Position, ShipPosition } from '../../types/encounters';
import { Ship } from '../../types/ship';
import FormationGrid from '../encounters/FormationGrid';
import { ShipSelector } from '../ship/ShipSelector';

interface PlacementBoardProps {
    /** Heading for this side (e.g. "Your Team", "Enemy Team"); count suffix is included by the caller. */
    title: string;
    /** Placed ships as ShipPosition[] for FormationGrid (it resolves the full ship by id via useShips). */
    formation: ShipPosition[];
    /** Currently selected cell on this board, or undefined when none is selected. */
    selectedPosition: Position | undefined;
    /** Select a grid cell (opens the picker by mounting the ShipSelector). */
    onSelectPosition: (position: Position) => void;
    /** Remove the ship at a cell. */
    onRemoveShip: (position: Position) => void;
    /** Pick a ship for the currently selected cell. */
    onPickShip: (ship: Ship) => void;
    /** Clear the current cell selection (fires when the picker modal closes). */
    onCloseSelector: () => void;
}

/** One placement board: a side heading, a FormationGrid, and a cell-selection-driven ship picker.
 *  Rendered once per side (player + enemy) from SimulatorPage. */
const PlacementBoard: React.FC<PlacementBoardProps> = ({
    title,
    formation,
    selectedPosition,
    onSelectPosition,
    onRemoveShip,
    onPickShip,
    onCloseSelector,
}) => {
    return (
        <div className="card">
            <h2 className="text-lg font-semibold mb-2">{title}</h2>
            <FormationGrid
                formation={formation}
                selectedPosition={selectedPosition}
                onPositionSelect={onSelectPosition}
                onRemoveShip={onRemoveShip}
            />
            {/* ShipSelector contract: mounted ONLY while a cell is selected. Mount/unmount drives the
                modal — autoOpen fires the picker open on mount; onClose clears the selection, which
                unmounts this and closes the modal. Do not render it unconditionally. */}
            {selectedPosition && (
                <ShipSelector
                    selected={null}
                    onSelect={onPickShip}
                    autoOpen
                    onClose={onCloseSelector}
                    hidden
                />
            )}
        </div>
    );
};

export default PlacementBoard;
