import React, { useState } from 'react';
import { Button, ConfirmModal, Modal } from '../ui';
import { CloseIcon } from '../ui/icons';
import { AutogearTeam } from '../../types/autogearTeam';
import { LocalEncounterNote } from '../../types/encounters';
import { useShips } from '../../contexts/ShipsContext';
import { useEncounterNotes } from '../../hooks/useEncounterNotes';
import { formationToShipIds } from '../../utils/encounters/formationToShipIds';

interface AutogearTeamsModalProps {
    isOpen: boolean;
    onClose: () => void;
    teams: AutogearTeam[];
    /** True when a real (non-placeholder) ship is already selected. */
    hasExistingSelection: boolean;
    /** Returns false when nothing could be loaded, which keeps this modal open. */
    onLoadTeam: (shipIds: string[], suggestedName: string) => boolean;
    onDeleteTeam: (id: string) => void;
}

interface PendingLoad {
    shipIds: string[];
    name: string;
}

export const AutogearTeamsModal: React.FC<AutogearTeamsModalProps> = ({
    isOpen,
    onClose,
    teams,
    hasExistingSelection,
    onLoadTeam,
    onDeleteTeam,
}) => {
    const { getShipById } = useShips();
    const { encounters } = useEncounterNotes();
    const [pendingLoad, setPendingLoad] = useState<PendingLoad | null>(null);
    const [pendingDelete, setPendingDelete] = useState<AutogearTeam | null>(null);

    const shipNames = (shipIds: string[]): string =>
        shipIds
            .map((id) => getShipById(id)?.name)
            .filter((name): name is string => !!name)
            .join(', ');

    const load = (shipIds: string[], name: string) => {
        if (onLoadTeam(shipIds, name)) {
            onClose();
        }
    };

    const requestLoad = (shipIds: string[], name: string) => {
        if (hasExistingSelection) {
            setPendingLoad({ shipIds, name });
            return;
        }
        load(shipIds, name);
    };

    const encounterShipIds = (encounter: LocalEncounterNote): string[] =>
        formationToShipIds(encounter.formation);

    return (
        <>
            <Modal isOpen={isOpen} onClose={onClose} title="Teams" maxWidth="max-w-2xl">
                <div className="space-y-6">
                    <div className="space-y-2">
                        <h4 className="text-lg font-semibold">Saved teams</h4>
                        {teams.length === 0 ? (
                            <p className="text-sm text-theme-text-secondary">
                                No saved teams yet. Select at least two ships, then use Save Team.
                            </p>
                        ) : (
                            teams.map((team) => (
                                <div
                                    key={team.id}
                                    className="card flex justify-between items-center gap-4"
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium truncate">{team.name}</p>
                                        <p className="text-sm text-theme-text-secondary truncate">
                                            {shipNames(team.shipIds)}
                                        </p>
                                        <p className="text-xs text-theme-text-secondary">
                                            {team.shipIds.length}{' '}
                                            {team.shipIds.length === 1 ? 'ship' : 'ships'}
                                        </p>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            aria-label={`Load team ${team.name}`}
                                            onClick={() => requestLoad(team.shipIds, team.name)}
                                        >
                                            Load
                                        </Button>
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            aria-label={`Delete team ${team.name}`}
                                            onClick={() => setPendingDelete(team)}
                                        >
                                            <CloseIcon className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="space-y-2">
                        <h4 className="text-lg font-semibold">From encounter</h4>
                        <p className="text-sm text-theme-text-secondary">
                            Loads an encounter&apos;s ships in turn order. Nothing is saved until
                            you use Save Team.
                        </p>
                        {encounters.length === 0 ? (
                            <p className="text-sm text-theme-text-secondary">
                                No encounters saved yet.
                            </p>
                        ) : (
                            encounters.map((encounter) => {
                                const shipIds = encounterShipIds(encounter);

                                return (
                                    <div
                                        key={encounter.id}
                                        className="card flex justify-between items-center gap-4"
                                    >
                                        <div className="min-w-0">
                                            <p className="font-medium truncate">{encounter.name}</p>
                                            <p className="text-sm text-theme-text-secondary truncate">
                                                {shipNames(shipIds)}
                                            </p>
                                        </div>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            aria-label={`Load encounter ${encounter.name}`}
                                            onClick={() => requestLoad(shipIds, encounter.name)}
                                            disabled={shipIds.length === 0}
                                        >
                                            Load
                                        </Button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </Modal>

            <ConfirmModal
                isOpen={!!pendingLoad}
                onClose={() => setPendingLoad(null)}
                onConfirm={() => {
                    if (pendingLoad) load(pendingLoad.shipIds, pendingLoad.name);
                }}
                title="Replace current selection?"
                message="The ships currently selected will be replaced by this team."
                confirmLabel="Replace"
                highZIndex
            />

            <ConfirmModal
                isOpen={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                onConfirm={() => {
                    if (pendingDelete) onDeleteTeam(pendingDelete.id);
                }}
                title="Delete team"
                message={`Delete "${pendingDelete?.name ?? ''}"? This cannot be undone.`}
                confirmLabel="Delete"
                highZIndex
            />
        </>
    );
};
