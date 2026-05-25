import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AutogearConfigList } from '../../../components/autogear/AutogearConfigList';

vi.mock('../../../components/ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const baseProps = {
    shipRole: null,
    statPriorities: [],
    setPriorities: [],
    statBonuses: [],
    ignoreEquipped: false,
    ignoreUnleveled: false,
    useUpgradedStats: false,
    tryToCompleteSets: false,
    optimizeImplants: false,
};

describe('AutogearConfigList', () => {
    it('shows "No configuration set" when nothing is configured', () => {
        render(<AutogearConfigList {...baseProps} />);
        expect(screen.getByText('No configuration set')).toBeInTheDocument();
    });

    it('does NOT show "No configuration set" when excludedImplantTypes is non-empty', () => {
        render(<AutogearConfigList {...baseProps} excludedImplantTypes={['HASTE']} />);
        expect(screen.queryByText('No configuration set')).not.toBeInTheDocument();
    });

    it('displays excluded implant types in the chip row', () => {
        render(<AutogearConfigList {...baseProps} excludedImplantTypes={['HASTE']} />);
        expect(screen.getByText(/Excl\./)).toBeInTheDocument();
    });
});
