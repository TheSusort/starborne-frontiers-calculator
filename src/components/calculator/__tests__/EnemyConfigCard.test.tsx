import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnemyConfigCard } from '../EnemyConfigCard';
import { buildDefaultShipSkills } from '../../../utils/abilities/configToSimInputs';
import type { EnemyShipConfig } from '../../../types/calculator';

// ShipSelector pulls in ShipDisplay (many context providers) and Sidebar imports
// '/favicon.ico?url', which Vitest cannot resolve. Same workaround as EnemyAttackersPanel.test.
// `vi.mock` is hoisted above these imports, so declaration order here is cosmetic.
vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('../../ship/ShipSelector', () => ({ ShipSelector: () => null }));

const config = (): EnemyShipConfig => ({
    name: 'Enemy',
    hp: 500000,
    defense: 10000,
    security: 100,
    attack: 8000,
    crit: 0,
    critDamage: 150,
    speed: 40,
    shipSkills: buildDefaultShipSkills(),
});

describe('EnemyConfigCard', () => {
    it('reports an edited stat as a NUMBER through onUpdate', () => {
        const onUpdate = vi.fn();
        render(<EnemyConfigCard config={config()} onUpdate={onUpdate} onSelectShip={vi.fn()} />);

        fireEvent.change(screen.getByLabelText(/^attack$/i), { target: { value: '9000' } });

        // A raw string here would silently corrupt the engine's stat maths.
        expect(onUpdate).toHaveBeenCalledWith('attack', 9000);
    });

    it('renders every editable stat', () => {
        render(<EnemyConfigCard config={config()} onUpdate={vi.fn()} onSelectShip={vi.fn()} />);

        ['HP', 'Defense', 'Security', 'Attack', 'Crit', 'Crit Damage', 'Speed'].forEach((label) => {
            expect(screen.getByLabelText(new RegExp(`^${label}$`, 'i'))).toBeInTheDocument();
        });
    });

    it('coerces a cleared input to 0 rather than NaN', () => {
        const onUpdate = vi.fn();
        render(<EnemyConfigCard config={config()} onUpdate={onUpdate} onSelectShip={vi.fn()} />);

        fireEvent.change(screen.getByLabelText(/^speed$/i), { target: { value: '' } });

        expect(onUpdate).toHaveBeenCalledWith('speed', 0);
    });
});
