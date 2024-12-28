import { render, screen, fireEvent } from '../../../../test-utils/test-utils';
import { Tabs } from '../Tabs';
import { vi } from 'vitest';

describe('Tabs Component', () => {
    const mockTabs = [
        { id: 'tab1', label: 'First Tab' },
        { id: 'tab2', label: 'Second Tab' },
        { id: 'tab3', label: 'Third Tab' },
    ];

    const defaultProps = {
        tabs: mockTabs,
        activeTab: 'tab1',
        onChange: () => {},
    };

    test('renders all tabs', () => {
        render(<Tabs {...defaultProps} />);

        mockTabs.forEach((tab) => {
            expect(screen.getByRole('button', { name: tab.label })).toBeInTheDocument();
        });
    });

    test('applies active styles to current tab', () => {
        render(<Tabs {...defaultProps} />);

        const activeTab = screen.getByRole('button', { name: 'First Tab' });
        expect(activeTab).toHaveClass('border-primary', 'text-primary');
        expect(activeTab).toHaveAttribute('aria-current', 'page');

        const inactiveTab = screen.getByRole('button', { name: 'Second Tab' });
        expect(inactiveTab).toHaveClass('border-transparent', 'text-gray-400');
        expect(inactiveTab).not.toHaveAttribute('aria-current');
    });

    test('calls onChange when clicking a tab', () => {
        const handleChange = vi.fn();
        render(<Tabs {...defaultProps} onChange={handleChange} />);

        const secondTab = screen.getByRole('button', { name: 'Second Tab' });
        fireEvent.click(secondTab);

        expect(handleChange).toHaveBeenCalledWith('tab2');
    });

    test('renders with correct navigation structure', () => {
        render(<Tabs {...defaultProps} />);

        const nav = screen.getByRole('navigation');
        expect(nav).toHaveAttribute('aria-label', 'Tabs');
        expect(nav).toHaveClass('-mb-px', 'flex', 'space-x-4');
    });

    test('applies hover styles to inactive tabs', () => {
        render(<Tabs {...defaultProps} />);

        const inactiveTab = screen.getByRole('button', { name: 'Second Tab' });
        expect(inactiveTab).toHaveClass('hover:text-gray-300', 'hover:border-gray-300');
    });

    test('applies consistent base styles to all tabs', () => {
        render(<Tabs {...defaultProps} />);

        const tabs = screen.getAllByRole('button');
        tabs.forEach((tab) => {
            expect(tab).toHaveClass(
                'whitespace-nowrap',
                'py-3',
                'px-4',
                'border-b-2',
                'font-medium',
                'text-sm'
            );
        });
    });

    test('renders border below tabs', () => {
        render(<Tabs {...defaultProps} />);

        const tabsContainer = screen.getByRole('navigation').parentElement;
        expect(tabsContainer).toHaveClass('border-b', 'border-gray-700');
    });

    test('maintains tab order', () => {
        render(<Tabs {...defaultProps} />);

        const tabs = screen.getAllByRole('button');
        expect(tabs[0]).toHaveTextContent('First Tab');
        expect(tabs[1]).toHaveTextContent('Second Tab');
        expect(tabs[2]).toHaveTextContent('Third Tab');
    });
});
