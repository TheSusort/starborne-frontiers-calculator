import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeamPanel } from '../TeamPanel';

vi.mock('../../../contexts/ShipsContext', () => ({
    useShips: () => ({ ships: [], getShipById: () => undefined }),
}));

vi.mock('../../ui/layout/Sidebar', () => ({ Sidebar: () => null }));

const noop = () => {};

const baseProps = {
    isOpen: true,
    onToggle: noop,
    enemyAffinity: 'antimatter' as const,
    teamShips: [],
    onAddTeamShip: noop,
    onRemoveTeamShip: noop,
    onSelectTeamShip: noop,
    onTeamShipStartChargedChange: noop,
    onTeamShipSpeedChange: noop,
    onTeamShipChargeCountChange: noop,
    onTeamShipBuffsChange: noop,
    onTeamShipEnemyDebuffsChange: noop,
    onTeamShipStatsChange: noop,
    onTeamShipAffinityChange: noop,
    onTeamShipShipSkillsChange: noop,
};

describe('TeamPanel', () => {
    it('renders the shared attacker buffs picker by default', () => {
        render(<TeamPanel {...baseProps} attackerBuffs={[]} onAttackerBuffsChange={noop} />);
        // GameBuffPicker renders the label inside the trigger button text "Select <label>…"
        expect(screen.getByText(/Select Attacker Buffs \/ Debuffs/)).toBeInTheDocument();
        expect(
            screen.getByText('Shared attacker buffs applied to all ship configurations')
        ).toBeInTheDocument();
    });

    it('hides the shared attacker buffs picker when showSharedBuffs={false}', () => {
        render(<TeamPanel {...baseProps} showSharedBuffs={false} />);
        expect(screen.queryByText(/Select Attacker Buffs \/ Debuffs/)).not.toBeInTheDocument();
        expect(
            screen.queryByText('Shared attacker buffs applied to all ship configurations')
        ).not.toBeInTheDocument();
    });
});
