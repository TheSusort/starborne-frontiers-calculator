import { render, screen, fireEvent } from '../../../../test-utils/test-utils';
import { PageLayout } from '../PageLayout';
import { vi } from 'vitest';

describe('PageLayout Component', () => {
    const defaultProps = {
        title: 'Test Page',
        children: <div>Page content</div>,
    };

    test('renders title and content', () => {
        render(<PageLayout {...defaultProps} />);

        expect(screen.getByText('Test Page')).toBeInTheDocument();
        expect(screen.getByText('Page content')).toBeInTheDocument();
    });

    test('renders description when provided', () => {
        render(<PageLayout {...defaultProps} description="This is a test description" />);

        expect(screen.getByText('This is a test description')).toBeInTheDocument();
    });

    test('renders action button when provided', () => {
        const handleClick = vi.fn();
        render(
            <PageLayout
                {...defaultProps}
                action={{
                    label: 'Add Item',
                    onClick: handleClick,
                }}
            />
        );

        const button = screen.getByRole('button', { name: 'Add Item' });
        expect(button).toBeInTheDocument();

        fireEvent.click(button);
        expect(handleClick).toHaveBeenCalled();
    });

    test('applies correct variant to action button', () => {
        render(
            <PageLayout
                {...defaultProps}
                action={{
                    label: 'Secondary Action',
                    onClick: () => {},
                    variant: 'secondary',
                }}
            />
        );

        const button = screen.getByRole('button', { name: 'Secondary Action' });
        expect(button).toHaveClass('bg-dark'); // assuming secondary variant has this class
    });

    test('renders with correct layout structure', () => {
        render(
            <PageLayout
                {...defaultProps}
                description="Test description"
                action={{
                    label: 'Action',
                    onClick: () => {},
                }}
            />
        );

        // Check header section
        const header = screen.getByRole('heading', { level: 1 });
        expect(header).toHaveClass('text-2xl', 'font-bold', '');

        // Check description styling
        const description = screen.getByText('Test description');
        expect(description).toHaveClass('text-sm', 'text-gray-400');
    });

    test('renders nested content correctly', () => {
        render(
            <PageLayout {...defaultProps}>
                <div>Section 1</div>
                <div>Section 2</div>
            </PageLayout>
        );

        expect(screen.getByText('Section 1')).toBeInTheDocument();
        expect(screen.getByText('Section 2')).toBeInTheDocument();
    });

    test('renders header with correct flex layout', () => {
        render(
            <PageLayout
                {...defaultProps}
                action={{
                    label: 'Action',
                    onClick: () => {},
                }}
            />
        );

        const headerContainer = screen.getByText('Test Page').closest('div');
        expect(headerContainer).toHaveClass('flex', 'justify-between', 'items-center');
    });
});
