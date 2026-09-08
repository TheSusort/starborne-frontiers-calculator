import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Callout } from '../Callout';
import { Chip } from '../Chip';

describe('Callout', () => {
    it('labels itself from the variant when no title is given', () => {
        render(
            <Callout variant="mistake">Hacking on a ship with no debuffs does nothing.</Callout>
        );
        expect(screen.getByText('Common mistake')).toBeInTheDocument();
        expect(
            screen.getByText('Hacking on a ship with no debuffs does nothing.')
        ).toBeInTheDocument();
    });

    it('prefers an explicit title over the variant label', () => {
        render(<Callout title="Position 4 is the front">body</Callout>);
        expect(screen.getByText('Position 4 is the front')).toBeInTheDocument();
        expect(screen.queryByText('Rule')).not.toBeInTheDocument();
    });

    it('exposes its variant so a page can be checked for which callouts it uses', () => {
        const { container } = render(<Callout variant="tip">body</Callout>);
        expect(container.querySelector('[data-callout="tip"]')).not.toBeNull();
    });
});

describe('Chip', () => {
    it('renders its content', () => {
        render(<Chip>Crit Rate</Chip>);
        expect(screen.getByText('Crit Rate')).toBeInTheDocument();
    });
});
