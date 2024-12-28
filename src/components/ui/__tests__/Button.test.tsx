import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { Button } from '../Button';
import { vi } from 'vitest';

describe('Button Component', () => {
    test('renders button with text', () => {
        render(<Button>Click me</Button>);
        expect(screen.getByText('Click me')).toBeInTheDocument();
    });

    test('handles click events', () => {
        const handleClick = vi.fn();
        render(<Button onClick={handleClick}>Click me</Button>);

        fireEvent.click(screen.getByText('Click me'));
        expect(handleClick).toHaveBeenCalled();
    });

    test('can be disabled', () => {
        const handleClick = vi.fn();
        render(
            <Button disabled onClick={handleClick}>
                Click me
            </Button>
        );

        const button = screen.getByText('Click me');
        fireEvent.click(button);

        expect(handleClick).not.toHaveBeenCalled();
        expect(button).toBeDisabled();
    });

    test('renders different variants', () => {
        const { rerender } = render(<Button variant="primary">Primary</Button>);
        expect(screen.getByText('Primary')).toHaveClass('bg-gradient-to-r from-primary');

        rerender(<Button variant="secondary">Secondary</Button>);
        expect(screen.getByText('Secondary')).toHaveClass('bg-dark');

        rerender(<Button variant="danger">Danger</Button>);
        expect(screen.getByText('Danger')).toHaveClass('bg-gradient-to-r from-red-600 to-red-500');
    });

    test('applies custom className', () => {
        render(<Button className="custom-class">Click me</Button>);
        expect(screen.getByText('Click me')).toHaveClass('custom-class');
    });
});
