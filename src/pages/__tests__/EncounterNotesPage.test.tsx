import { render, screen, fireEvent, waitFor } from '../../test-utils/test-utils';
import EncounterNotesPage from '../EncounterNotesPage';
import { EncounterNote, ShipPosition } from '../../types/encounters';
import { vi } from 'vitest';

// Mock hooks
const mockAddEncounter = vi.fn();
const mockUpdateEncounter = vi.fn();
const mockDeleteEncounter = vi.fn();
const mockAddNotification = vi.fn();

// Mock UI components
vi.mock('../../components/ui', () => ({
    PageLayout: ({
        children,
        title,
        description,
        action,
    }: {
        children: React.ReactNode;
        title: string;
        description: string;
        action: { onClick: () => void; label: string };
    }) => (
        <div>
            <h1>{title}</h1>
            <p>{description}</p>
            <button onClick={action?.onClick}>{action?.label}</button>
            {children}
        </div>
    ),
    CollapsibleForm: ({
        children,
        isVisible,
    }: {
        children: React.ReactNode;
        isVisible: boolean;
    }) => <div className={isVisible ? '' : 'max-h-0'}>{children}</div>,
    ConfirmModal: ({
        isOpen,
        onClose,
        onConfirm,
        title,
        message,
    }: {
        isOpen: boolean;
        onClose: () => void;
        onConfirm: () => void;
        title: string;
        message: string;
    }) =>
        isOpen ? (
            <div role="dialog">
                <h2>{title}</h2>
                <p>{message}</p>
                <button onClick={onConfirm}>Delete</button>
                <button onClick={onClose}>Cancel</button>
            </div>
        ) : null,
    Button: ({
        children,
        onClick,
        ...props
    }: {
        children: React.ReactNode;
        onClick: () => void;
    }) => (
        <button onClick={onClick} {...props}>
            {children}
        </button>
    ),
    Input: ({ label, ...props }: { label: string }) => (
        <div>
            <label>{label}</label>
            <input {...props} aria-label={label} />
        </div>
    ),
    EditIcon: () => 'Edit',
    CloseIcon: () => 'Delete',
}));

// Mock FormationGrid
vi.mock('../../components/encounters/FormationGrid', () => ({
    default: ({ formation }: { formation: ShipPosition[] }) => (
        <div data-testid="formation-grid">
            {formation.map((pos: ShipPosition) => (
                <div key={pos.position}>{pos.position}</div>
            ))}
        </div>
    ),
}));

vi.mock('../../hooks/useEncounterNotes', () => ({
    useEncounterNotes: () => ({
        encounters: mockEncounters,
        addEncounter: mockAddEncounter,
        updateEncounter: mockUpdateEncounter,
        deleteEncounter: mockDeleteEncounter,
    }),
}));

vi.mock('../../hooks/useNotification', () => ({
    useNotification: () => ({
        addNotification: mockAddNotification,
    }),
}));

const mockEncounters: EncounterNote[] = [
    {
        id: 'encounter1',
        name: 'Test Encounter',
        formation: [
            { shipId: 'ship1', position: 'T1' },
            { shipId: 'ship2', position: 'M2' },
        ],
        createdAt: Date.now(),
    },
];

describe('EncounterNotesPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders page title and description', () => {
        render(<EncounterNotesPage />);
        expect(screen.getByText('Encounter Notes')).toBeInTheDocument();
        expect(
            screen.getByText(/Save and manage your successful fleet formations/i)
        ).toBeInTheDocument();
    });

    test('toggles form visibility', () => {
        render(<EncounterNotesPage />);
        const form = screen.getByText('Add New Encounter')?.closest('.max-h-0');
        expect(form).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /add encounter/i }));
        expect(form).not.toHaveClass('max-h-0');

        fireEvent.click(screen.getByRole('button', { name: /hide form/i }));
        expect(form).toHaveClass('max-h-0');
    });

    test('handles encounter addition with formation', async () => {
        render(<EncounterNotesPage />);

        fireEvent.click(screen.getByRole('button', { name: /add encounter/i }));

        const nameInput = screen.getByLabelText(/encounter name/i);
        fireEvent.change(nameInput, { target: { value: 'New Encounter' } });

        fireEvent.click(screen.getByRole('button', { name: /save encounter/i }));

        await waitFor(() => {
            expect(mockAddEncounter).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'New Encounter',
                    formation: expect.any(Array),
                })
            );
            expect(mockAddNotification).toHaveBeenCalledWith('success', 'Encounter Added');
        });
    });

    // Rest of the tests remain the same...
});
