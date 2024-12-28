import { render, screen } from '../../../../test-utils/test-utils';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, EditIcon, FilterIcon } from '../';

describe('Icon Components', () => {
    const icons = [
        { Component: CheckIcon, name: 'check' },
        { Component: ChevronDownIcon, name: 'chevron down' },
        { Component: ChevronUpIcon, name: 'chevron up' },
        { Component: CloseIcon, name: 'close' },
        { Component: EditIcon, name: 'edit' },
        { Component: FilterIcon, name: 'filter' },
    ];

    test.each(icons)('renders $name icon with correct attributes', ({ Component }) => {
        render(<Component />);

        const svg = screen.getByRole('img', { hidden: true });
        expect(svg).toBeInTheDocument();
        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('viewBox');
    });
});
