// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WishlistFilterChips } from '../WishlistFilterChips';

describe('WishlistFilterChips', () => {
    it('shows the capped substat requirement for five or more substats', () => {
        render(
            <WishlistFilterChips
                entry={{
                    id: 'e1',
                    name: 'Five',
                    filters: {
                        subStats: [
                            { name: 'attack', type: 'percentage' },
                            { name: 'hp', type: 'percentage' },
                            { name: 'crit', type: 'percentage' },
                            { name: 'critDamage', type: 'percentage' },
                            { name: 'speed', type: 'flat' },
                        ],
                    },
                }}
            />
        );
        expect(screen.getByText(/^Subs: 4 of /)).toBeTruthy();
    });
});
