import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HealTargetPanel, HealTargetState } from '../HealTargetPanel';

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: () => undefined }),
}));

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const baseTarget: HealTargetState = {
    useHealerAsTarget: true,
    hp: 40000,
    defence: 5000,
    speed: 100,
    security: 0,
};

const noop = () => {};

describe('HealTargetPanel', () => {
    it('hides the target stat inputs when using the healer as the target', () => {
        render(
            <HealTargetPanel
                isOpen
                onToggle={noop}
                target={baseTarget}
                onUseHealerAsTargetChange={noop}
                onSelectShip={noop}
                onHpChange={noop}
                onDefenceChange={noop}
                onSpeedChange={noop}
                onSecurityChange={noop}
            />
        );
        expect(screen.getByLabelText('Use healer as target (heal self)')).toBeChecked();
        expect(screen.queryByLabelText('Target HP')).not.toBeInTheDocument();
    });

    it('shows the target stat inputs when a separate target is used', () => {
        render(
            <HealTargetPanel
                isOpen
                onToggle={noop}
                target={{ ...baseTarget, useHealerAsTarget: false }}
                onUseHealerAsTargetChange={noop}
                onSelectShip={noop}
                onHpChange={noop}
                onDefenceChange={noop}
                onSpeedChange={noop}
                onSecurityChange={noop}
            />
        );
        expect(screen.getByLabelText('Target HP')).toHaveValue(40000);
        expect(screen.getByLabelText('Target Defense')).toHaveValue(5000);
        expect(screen.getByLabelText('Target Security')).toHaveValue(0);
    });

    it('reports security edits via onSecurityChange', () => {
        const onSecurity = vi.fn();
        render(
            <HealTargetPanel
                isOpen
                onToggle={noop}
                target={{ ...baseTarget, useHealerAsTarget: false }}
                onUseHealerAsTargetChange={noop}
                onSelectShip={noop}
                onHpChange={noop}
                onDefenceChange={noop}
                onSpeedChange={noop}
                onSecurityChange={onSecurity}
            />
        );
        fireEvent.change(screen.getByLabelText('Target Security'), { target: { value: '75' } });
        expect(onSecurity).toHaveBeenCalledWith(75);
    });

    it('toggles target mode via the checkbox', () => {
        const onUse = vi.fn();
        render(
            <HealTargetPanel
                isOpen
                onToggle={noop}
                target={baseTarget}
                onUseHealerAsTargetChange={onUse}
                onSelectShip={noop}
                onHpChange={noop}
                onDefenceChange={noop}
                onSpeedChange={noop}
                onSecurityChange={noop}
            />
        );
        fireEvent.click(screen.getByLabelText('Use healer as target (heal self)'));
        expect(onUse).toHaveBeenCalledWith(false);
    });
});
