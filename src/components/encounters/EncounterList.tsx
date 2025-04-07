import domtoimage from 'dom-to-image';
import { EncounterNote, SharedEncounterNote } from '../../types/encounters';
import { Button, CloseIcon, EditIcon, CopyIcon, ShareIcon } from '../ui';
import FormationGrid from './FormationGrid';
import { useNotification } from '../../hooks/useNotification';
import { useAuth } from '../../contexts/AuthProvider';
import { ChevronUpIcon, ChevronDownIcon } from '../ui/icons';

interface EncounterListProps {
    encounters: EncounterNote[];
    onEdit?: (encounter: EncounterNote) => void;
    onDelete?: (encounterId: string) => void;
    onShareToggle?: (encounter: EncounterNote) => void;
    onVote?: (encounterId: string, vote: number) => void;
    showVotes?: boolean;
    isReadOnly?: boolean;
}

export const EncounterList = ({
    encounters,
    onEdit,
    onDelete,
    onShareToggle,
    onVote,
    showVotes = false,
}: EncounterListProps) => {
    const { addNotification } = useNotification();
    const { user } = useAuth();

    const createAndCopyImage = async (encounterId: string) => {
        const encounterElement = document.getElementById(`encounter-${encounterId}`);
        if (!encounterElement) return;

        try {
            // Create canvas from the encounter div
            const canvas = await domtoimage.toBlob(encounterElement, {
                filter: (node: Node) => {
                    return node.textContent !== '';
                },
            });

            // Copy to clipboard
            await navigator.clipboard.write([
                new ClipboardItem({
                    'image/png': canvas,
                }),
            ]);
            addNotification('success', 'Copied to clipboard!');
        } catch (error) {
            console.error('Failed to copy image:', error);
            addNotification('error', 'Failed to copy image');
        }
    };

    const handleVote = (encounterId: string, vote: number) => {
        if (onVote) {
            onVote(encounterId, vote);
        }
    };

    const getVoteCount = (encounter: SharedEncounterNote) => {
        const count = encounter.votes || 0;
        return count;
    };

    const getUserVote = (encounter: SharedEncounterNote) => {
        if (!user) return 0;
        const vote = encounter.userVotes?.[user.uid] || 0;
        return vote;
    };

    if (encounters.length === 0) {
        return (
            <div className="text-center py-8 text-gray-400 bg-dark-lighter border-2 border-dashed">
                {encounters.length === 0 ? 'No encounters found' : 'No matching encounters found'}
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            <span className="text-sm text-gray-400 -mt-4">
                {encounters.length} {encounters.length === 1 ? 'encounter' : 'encounters'}
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-6">
                {encounters.map((encounter) => {
                    const isShared = 'votes' in encounter;

                    return (
                        <div
                            key={encounter.id}
                            id={`encounter-${encounter.id}`}
                            className="space-y-4 border border-dark-border bg-dark flex flex-col"
                            role="article"
                        >
                            <div className="flex justify-between items-start py-2 px-4 border-b border-dark-border">
                                <h3 className="text-lg font-medium text-white">{encounter.name}</h3>
                                <div className="flex gap-2">
                                    {showVotes && isShared && (
                                        <div className="flex items-center space-x-1">
                                            <div className="font-semibold text-white pe-3 text-center">
                                                {getVoteCount(encounter)}
                                            </div>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() =>
                                                    handleVote(
                                                        encounter.id,
                                                        getUserVote(encounter) === 1 ? 0 : 1
                                                    )
                                                }
                                                className={
                                                    getUserVote(encounter) === 1
                                                        ? 'text-green-500'
                                                        : ''
                                                }
                                            >
                                                <ChevronUpIcon />
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() =>
                                                    handleVote(
                                                        encounter.id,
                                                        getUserVote(encounter) === -1 ? 0 : -1
                                                    )
                                                }
                                                className={
                                                    getUserVote(encounter) === -1
                                                        ? 'text-red-500'
                                                        : ''
                                                }
                                            >
                                                <ChevronDownIcon />
                                            </Button>
                                        </div>
                                    )}
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => createAndCopyImage(encounter.id)}
                                        aria-label="Copy as Image"
                                    >
                                        <CopyIcon />
                                    </Button>
                                    {onEdit && (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => onEdit(encounter)}
                                            aria-label="Edit Encounter"
                                        >
                                            <EditIcon />
                                        </Button>
                                    )}
                                    {onShareToggle && (
                                        <Button
                                            variant={encounter.isPublic ? 'danger' : 'secondary'}
                                            size="sm"
                                            onClick={() => onShareToggle(encounter)}
                                        >
                                            <ShareIcon />
                                        </Button>
                                    )}
                                    {onDelete && (
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() => onDelete(encounter.id)}
                                        >
                                            <CloseIcon />
                                        </Button>
                                    )}
                                </div>
                            </div>
                            {encounter.description && (
                                <p className="text-white text-sm px-4">{encounter.description}</p>
                            )}
                            <FormationGrid formation={encounter.formation} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default EncounterList;
