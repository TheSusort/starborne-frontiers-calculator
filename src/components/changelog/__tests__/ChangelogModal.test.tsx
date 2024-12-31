import { render, screen } from '../../../test-utils/test-utils';
import { ChangelogModal } from '../ChangelogModal';
import { ChangelogEntry } from '../../../types/changelog';
import { vi } from 'vitest';

describe('ChangelogModal Component', () => {
    const mockEntries: ChangelogEntry[] = [
        {
            version: '1.2.0',
            date: '2024-03-15',
            changes: ['Added new feature A', 'Fixed bug in system B', 'Improved performance of C'],
        },
        {
            version: '1.1.0',
            date: '2024-03-01',
            changes: ['Initial release of feature D', 'Updated UI components'],
        },
    ];

    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        entries: mockEntries,
        lastSeenVersion: '1.1.0',
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('renders modal title', () => {
        render(<ChangelogModal {...defaultProps} />);
        expect(screen.getByText("What's New")).toBeInTheDocument();
    });

    test('shows new version badge for unseen versions', () => {
        render(<ChangelogModal {...defaultProps} />);

        // Should show NEW badge for version 1.2.0
        expect(screen.getByText('New')).toBeInTheDocument();

        // Version headers should be visible
        expect(screen.getByText(/Version 1.2.0/)).toBeInTheDocument();
    });

    test('renders version dates', () => {
        render(<ChangelogModal {...defaultProps} />);
        expect(screen.getByText(/2024-03-15/)).toBeInTheDocument();
    });

    test('renders change list items', () => {
        render(<ChangelogModal {...defaultProps} />);

        mockEntries[0].changes.forEach((change) => {
            expect(screen.getByText(change)).toBeInTheDocument();
        });
    });

    test('only shows versions newer than lastSeenVersion', () => {
        render(<ChangelogModal {...defaultProps} />);

        // Should show version 1.2.0 (newer than lastSeenVersion 1.1.0)
        expect(screen.getByText(/Version 1.2.0/)).toBeInTheDocument();

        // Should not show version 1.1.0 (equal to lastSeenVersion)
        expect(screen.queryByText(/Version 1.1.0/)).not.toBeInTheDocument();
    });

    test('shows all versions when lastSeenVersion is old', () => {
        render(<ChangelogModal {...defaultProps} lastSeenVersion="1.0.0" />);

        // Should show both versions
        expect(screen.getByText(/Version 1.2.0/)).toBeInTheDocument();
        expect(screen.getByText(/Version 1.1.0/)).toBeInTheDocument();
    });

    test('handles empty entries array', () => {
        render(<ChangelogModal {...defaultProps} entries={[]} />);
        expect(screen.getByText("What's New")).toBeInTheDocument();
        // Should not crash and should render empty content
    });

    test('handles version comparison correctly', () => {
        const entries: ChangelogEntry[] = [
            {
                version: '2.0.0',
                date: '2024-03-20',
                changes: ['Major update'],
            },
            {
                version: '1.11.0',
                date: '2024-03-10',
                changes: ['Minor update'],
            },
        ];

        render(<ChangelogModal {...defaultProps} entries={entries} lastSeenVersion="1.11.0" />);

        // Should show 2.0.0 but not 1.11.0
        expect(screen.getByText(/Version 2.0.0/)).toBeInTheDocument();
        expect(screen.queryByText(/Version 1.11.0/)).not.toBeInTheDocument();
    });

    test('modal can be closed', () => {
        render(<ChangelogModal {...defaultProps} />);

        // Find and click the close button (assuming it exists in the Modal component)
        const closeButton = screen.getByRole('button', { name: /close/i });
        closeButton.click();

        expect(defaultProps.onClose).toHaveBeenCalled();
    });
});
