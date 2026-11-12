// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FloatingHits, type FloatingHit } from '../FloatingHits';

const number = (amount: number): FloatingHit => ({ kind: 'damage', amount, crit: false });
const status = (kind: 'buff' | 'debuff' | 'resisted', label?: string): FloatingHit => ({
    kind,
    label,
    amount: 0,
    crit: false,
});

describe('FloatingHits status text', () => {
    it('shows a buff, a debuff and a resist as small marked text', () => {
        render(
            <FloatingHits
                turn={1}
                small
                hits={[
                    status('buff', 'Attack Up II'),
                    status('debuff', 'Corrosion'),
                    status('resisted'),
                ]}
            />
        );
        expect(screen.getByText('▲ Attack Up II')).toHaveClass('text-green-400');
        expect(screen.getByText('▼ Corrosion')).toHaveClass('text-red-400');
        expect(screen.getByText('RESISTED')).toBeInTheDocument();
    });

    it('stacks status text in its own column, newest on top, three at most', () => {
        render(
            <FloatingHits
                turn={1}
                hits={[
                    status('buff', 'One'),
                    status('buff', 'Two'),
                    status('buff', 'Three'),
                    status('buff', 'Four'),
                ]}
            />
        );
        const texts = screen.getAllByTestId('status-float').map((el) => el.textContent);
        expect(texts).toEqual(['▲ Three', '▲ Two', '▲ One']);
    });

    it('caps numbers at four independently of the status text', () => {
        render(
            <FloatingHits
                turn={1}
                hits={[
                    ...[1, 2, 3, 4, 5].map(number),
                    status('debuff', 'A'),
                    status('debuff', 'B'),
                ]}
            />
        );
        expect(screen.getAllByTestId('duel-hit')).toHaveLength(4);
        expect(screen.getAllByTestId('status-float')).toHaveLength(2);
    });
});
