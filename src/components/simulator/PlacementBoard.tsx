import React, { useState } from 'react';
import { Position, ShipPosition } from '../../types/encounters';
import { Ship } from '../../types/ship';
import FormationGrid from '../encounters/FormationGrid';
import { ShipSelector } from '../ship/ShipSelector';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { Modal } from '../ui/layout/Modal';
import { Input } from '../ui/Input';
import { useEncounterNotes } from '../../hooks/useEncounterNotes';
import { useShips } from '../../contexts/ShipsContext';

/** One placement board's state: a Position → Ship map (shared shape with SimulatorPage). */
export type BoardState = Partial<Record<Position, Ship>>;

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
    /** Replace this board with a BoardState built from a saved encounter's formation. */
    onLoadEncounter: (board: BoardState) => void;
    /** Mirror the column order (enemy board): col 4 = front renders leftmost, facing the player. */
    mirrored?: boolean;
}

/** One placement board: a side heading, an optional "load encounter" dropdown, a FormationGrid,
 *  and a cell-selection-driven ship picker. Rendered once per side (player + enemy) from SimulatorPage. */
const PlacementBoard: React.FC<PlacementBoardProps> = ({
    title,
    formation,
    selectedPosition,
    onSelectPosition,
    onRemoveShip,
    onPickShip,
    onCloseSelector,
    onLoadEncounter,
    mirrored = false,
}) => {
    const { encounters, addEncounter } = useEncounterNotes();
    const { getShipById } = useShips();

    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [encounterName, setEncounterName] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const handleSaveEncounter = async () => {
        const trimmedName = encounterName.trim();
        if (!trimmedName || formation.length === 0) return;
        setIsSaving(true);
        try {
            await addEncounter({ name: trimmedName, formation });
            setIsSaveModalOpen(false);
            setEncounterName('');
        } finally {
            setIsSaving(false);
        }
    };

    const handleLoadEncounter = (encounterId: string) => {
        if (!encounterId) return;
        const encounter = encounters.find((e) => e.id === encounterId);
        if (!encounter) return;
        // Build the board from the encounter's formation. Skip cells whose ship the user no
        // longer owns (getShipById undefined) so we never place a missing ship.
        const board: BoardState = {};
        for (const { shipId, position } of encounter.formation) {
            const ship = getShipById(shipId);
            if (ship) board[position] = ship;
        }
        onLoadEncounter(board);
    };

    return (
        <div className="card">
            <h2 className="text-lg font-semibold mb-2">{title}</h2>
            {encounters.length > 0 && (
                <div className="mb-3">
                    <Select
                        label="Load encounter"
                        searchable
                        searchPlaceholder="Search encounters..."
                        noDefaultSelection
                        // Action, not persistent state: leave empty so it always reads as a prompt.
                        value=""
                        options={encounters.map((enc) => ({ value: enc.id, label: enc.name }))}
                        onChange={handleLoadEncounter}
                    />
                </div>
            )}
            <div className="mb-3">
                <Button
                    variant="secondary"
                    size="sm"
                    disabled={formation.length === 0}
                    onClick={() => setIsSaveModalOpen(true)}
                >
                    Save as encounter
                </Button>
            </div>
            <FormationGrid
                formation={formation}
                selectedPosition={selectedPosition}
                onPositionSelect={onSelectPosition}
                onRemoveShip={onRemoveShip}
                mirrored={mirrored}
                showFacingCue
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
            <Modal
                isOpen={isSaveModalOpen}
                onClose={() => setIsSaveModalOpen(false)}
                title="Save as encounter"
                maxWidth="max-w-md"
            >
                <div className="space-y-4">
                    <Input
                        label="Encounter name"
                        value={encounterName}
                        placeholder="Simulator team"
                        autoFocus
                        onChange={(e) => setEncounterName(e.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => setIsSaveModalOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            disabled={!encounterName.trim() || isSaving}
                            onClick={() => void handleSaveEncounter()}
                        >
                            Save
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default PlacementBoard;
