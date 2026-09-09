import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoleSelector } from '../../ui/RoleSelector';
import { render as renderWithProviders } from '../../../test-utils/test-utils';
import { AutogearSettings } from '../AutogearSettings';
import { makeSettingsProps } from './autogearSettingsProps';

// The `ui` barrel transitively pulls ui/layout/Sidebar, which imports
// '/favicon.ico?url' — unresolvable under Vitest. Same workaround as the other
// component tests in this project.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));
// useTutorialTrigger calls useTutorial(), which throws without a TutorialProvider;
// TestProviders does not supply one.
vi.mock('../../../hooks/useTutorialTrigger', () => ({ useTutorialTrigger: () => undefined }));
// CommunityRecommendations fetches and ShipSelector opens a modal; neither is under test here.
vi.mock('../CommunityRecommendations', () => ({ CommunityRecommendations: () => null }));
vi.mock('../../ship/ShipSelector', () => ({ ShipSelector: () => null }));

describe('RoleSelector default option', () => {
    it('reports null-shaped emptiness when the Custom option is chosen', async () => {
        const onChange = vi.fn();
        render(
            <RoleSelector
                value="ATTACKER"
                onChange={onChange}
                noDefaultSelection
                defaultOption="Custom"
            />
        );
        await userEvent.click(screen.getByText('Attacker'));
        await userEvent.click(screen.getByText('Custom'));
        expect(onChange).toHaveBeenCalledWith('');
    });
});

describe('AutogearSettings role selection', () => {
    it('hands the page a null, not an empty string', async () => {
        // SavedAutogearConfig declares shipRole as ShipTypeName | null and every consumer
        // tests for null. Writing '' works only by being falsy.
        const onRoleSelect = vi.fn();
        renderWithProviders(
            <AutogearSettings
                {...makeSettingsProps({ selectedShipRole: 'ATTACKER', onRoleSelect })}
            />
        );
        await userEvent.click(screen.getByText('Attacker'));
        await userEvent.click(screen.getByText('Custom'));
        expect(onRoleSelect).toHaveBeenCalledWith(null);
    });
});
