import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TurnOrderStrip from '../TurnOrderStrip';
import type { BattleResult } from '../../../utils/calculators/battleSimulator';

const roster: BattleResult['roster'] = [
    { actorId: 'attacker', side: 'player', name: 'Nova', position: 'M4' },
    { actorId: 'p:s2:1', side: 'player', name: 'Lyra', position: 'M3' },
    { actorId: 'e:s3:0', side: 'enemy', name: 'Hexa', position: 'M4' },
];

describe('TurnOrderStrip', () => {
    it('renders entries in order with positions and enemy labeling', () => {
        render(<TurnOrderStrip order={['e:s3:0', 'attacker', 'p:s2:1']} roster={roster} />);
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(3);
        expect(within(items[0]).getByText('Enemy Hexa')).toBeInTheDocument();
        expect(within(items[1]).getByText('Nova')).toBeInTheDocument();
        expect(within(items[2]).getByText('Lyra')).toBeInTheDocument();
        // sequence index labels
        expect(within(items[0]).getByText('1')).toBeInTheDocument();
        expect(within(items[2]).getByText('3')).toBeInTheDocument();
    });

    it('skips actorIds not present in the roster', () => {
        render(<TurnOrderStrip order={['attacker', 'ghost', 'e:s3:0']} roster={roster} />);
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByText('Nova')).toBeInTheDocument();
        expect(screen.getByText('Enemy Hexa')).toBeInTheDocument();
    });

    it('renders nothing when no entries resolve', () => {
        const { container } = render(<TurnOrderStrip order={[]} roster={roster} />);
        expect(container).toBeEmptyDOMElement();
    });
});
