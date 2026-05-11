import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChangelogModal } from '../../../components/changelog/ChangelogModal';

// Sidebar imports /favicon.ico?url which is not available in test environment
vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    entries: [],
    lastSeenVersion: '0.0.0',
};

describe('ChangelogModal — unreleased section', () => {
    it('does not render Unreleased heading when unreleasedChanges is empty', () => {
        render(<ChangelogModal {...baseProps} unreleasedChanges={[]} />);
        expect(screen.queryByText('Unreleased')).toBeNull();
    });

    it('renders Unreleased heading when unreleasedChanges has entries', () => {
        render(
            <ChangelogModal
                {...baseProps}
                unreleasedChanges={['New feature alpha', 'Bug fix beta']}
            />
        );
        expect(screen.getByText('Unreleased')).not.toBeNull();
        expect(screen.getByText('New feature alpha')).not.toBeNull();
        expect(screen.getByText('Bug fix beta')).not.toBeNull();
    });

    it('renders Unreleased section before versioned entries', () => {
        render(
            <ChangelogModal
                {...baseProps}
                unreleasedChanges={['Upcoming thing']}
                entries={[{ version: '1.0.0', date: '2026-01-01', changes: ['Old feature'] }]}
                lastSeenVersion="0.9.0"
            />
        );
        // Check that Unreleased heading is rendered
        expect(screen.getByText('Unreleased')).not.toBeNull();
        // Check that version heading is rendered
        expect(screen.getByText(/1\.0\.0/)).not.toBeNull();
        // Check order: Unreleased should come before 1.0.0
        const unreleasedEl = screen.getByText('Unreleased');
        const versionEl = screen.getByText(/1\.0\.0/);
        expect(
            unreleasedEl.compareDocumentPosition(versionEl) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });
});
