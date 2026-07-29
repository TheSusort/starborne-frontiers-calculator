import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { AutogearTeamsModal } from '../AutogearTeamsModal';
import { AutogearTeam } from '../../../types/autogearTeam';
import { Ship } from '../../../types/ship';
import { LocalEncounterNote } from '../../../types/encounters';

// Modal → ui/index → Sidebar → /favicon.ico?url which Vitest cannot resolve
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const fleet: Record<string, Ship> = {
    '1': { id: '1', name: 'Lodolite' } as Ship,
    '2': { id: '2', name: 'Zeolite' } as Ship,
    '3': { id: '3', name: 'Hemlock' } as Ship,
};

const encounters: LocalEncounterNote[] = [
    {
        id: 'enc-1',
        name: 'Wave 3 Farm',
        createdAt: 0,
        formation: [
            { shipId: '3', position: 'B1' },
            { shipId: '1', position: 'T2', sortOrder: 1 },
        ],
    },
];

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ getShipById: (id: string) => fleet[id] }),
}));

vi.mock('../../../hooks/useEncounterNotes', () => ({
    useEncounterNotes: () => ({ encounters, loading: false }),
}));

const teams: AutogearTeam[] = [
    { id: 'team-1', name: 'Arena A', shipIds: ['1', '2'], createdAt: 0 },
];

const renderModal = (
    overrides: Partial<Parameters<typeof AutogearTeamsModal>[0]> = {},
    onLoadTeamResult = true
) => {
    const onLoadTeam = vi.fn().mockReturnValue(onLoadTeamResult);
    const onDeleteTeam = vi.fn();
    const onClose = vi.fn();

    render(
        <AutogearTeamsModal
            isOpen
            onClose={onClose}
            teams={teams}
            hasExistingSelection={false}
            onLoadTeam={onLoadTeam}
            onDeleteTeam={onDeleteTeam}
            {...overrides}
        />
    );

    return { onLoadTeam, onDeleteTeam, onClose };
};

describe('AutogearTeamsModal', () => {
    beforeEach(() => vi.clearAllMocks());

    it('lists saved teams with their ship names', () => {
        renderModal();

        expect(screen.getByText('Arena A')).toBeInTheDocument();
        expect(screen.getByText('Lodolite, Zeolite')).toBeInTheDocument();
    });

    it('loads a team and closes', () => {
        const { onLoadTeam, onClose } = renderModal();

        fireEvent.click(screen.getByRole('button', { name: 'Load team Arena A' }));

        expect(onLoadTeam).toHaveBeenCalledWith(['1', '2'], 'Arena A');
        expect(onClose).toHaveBeenCalled();
    });

    it('stays open when loading resolved nothing', () => {
        const { onClose } = renderModal({}, false);

        fireEvent.click(screen.getByRole('button', { name: 'Load team Arena A' }));

        expect(onClose).not.toHaveBeenCalled();
    });

    it('confirms before replacing an existing selection', () => {
        const { onLoadTeam } = renderModal({ hasExistingSelection: true });

        fireEvent.click(screen.getByRole('button', { name: 'Load team Arena A' }));
        expect(onLoadTeam).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
        expect(onLoadTeam).toHaveBeenCalledWith(['1', '2'], 'Arena A');
    });

    it('confirms before deleting a team', () => {
        const { onDeleteTeam } = renderModal();

        fireEvent.click(screen.getByRole('button', { name: 'Delete team Arena A' }));
        expect(onDeleteTeam).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(onDeleteTeam).toHaveBeenCalledWith('team-1');
    });

    it('loads an encounter formation in derived order with the encounter name', () => {
        const { onLoadTeam } = renderModal();

        fireEvent.click(screen.getByRole('button', { name: 'Load encounter Wave 3 Farm' }));

        expect(onLoadTeam).toHaveBeenCalledWith(['1', '3'], 'Wave 3 Farm');
    });
});
