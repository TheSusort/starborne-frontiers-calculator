import { render, screen, fireEvent, act } from '../../../../test-utils/test-utils';
import { Offcanvas } from '../Offcanvas';
import { vi } from 'vitest';

describe('Offcanvas Component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: () => {},
    title: 'Test Offcanvas',
    children: <div>Offcanvas content</div>,
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    // Reset body styles
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
  });

  test('renders when open', async () => {
    render(<Offcanvas {...defaultProps} />);

    // Wait for animation frame callbacks
    await act(async () => {
      vi.runAllTimers();
    });

    expect(screen.getByText('Test Offcanvas')).toBeInTheDocument();
    expect(screen.getByText('Offcanvas content')).toBeInTheDocument();
  });

  test('does not render when closed', () => {
    render(<Offcanvas {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Test Offcanvas')).not.toBeInTheDocument();
    expect(screen.queryByText('Offcanvas content')).not.toBeInTheDocument();
  });

  test('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(<Offcanvas {...defaultProps} onClose={onClose} />);

    await act(async () => {
      vi.runAllTimers();
    });

    const backdrop = screen.getByTestId('offcanvas-backdrop');
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  test('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<Offcanvas {...defaultProps} onClose={onClose} />);

    await act(async () => {
      vi.runAllTimers();
    });

    const closeButton = screen.getByRole('button', { name: /close offcanvas/i });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  test('does not show close button when hideCloseButton is true', async () => {
    render(<Offcanvas {...defaultProps} hideCloseButton={true} />);

    await act(async () => {
      vi.runAllTimers();
    });

    expect(screen.queryByRole('button', { name: /close offcanvas/i })).not.toBeInTheDocument();
  });

  test('renders with correct position classes', async () => {
    const { rerender } = render(<Offcanvas {...defaultProps} position="left" />);

    await act(async () => {
      vi.runAllTimers();
    });

    let panel = screen.getByTestId('offcanvas-panel');
    expect(panel).toHaveClass('left-0');

    rerender(<Offcanvas {...defaultProps} position="right" />);

    await act(async () => {
      vi.runAllTimers();
    });

    panel = screen.getByTestId('offcanvas-panel');
    expect(panel).toHaveClass('right-0');
  });

  test('applies custom width class', async () => {
    render(<Offcanvas {...defaultProps} width="w-96" />);

    await act(async () => {
      vi.runAllTimers();
    });

    const panel = screen.getByTestId('offcanvas-panel');
    expect(panel).toHaveClass('w-96');
  });

  test('handles scroll locking', async () => {
    window.scrollY = 100; // Mock scroll position

    render(<Offcanvas {...defaultProps} />);

    await act(async () => {
      vi.runAllTimers();
    });

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-100px');
    expect(document.body.style.width).toBe('100%');
    expect(document.body.style.overflow).toBe('hidden');

    // Test cleanup when closing
    render(<Offcanvas {...defaultProps} isOpen={false} />);

    await act(async () => {
      vi.runAllTimers();
    });

    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(document.body.style.width).toBe('');
    expect(document.body.style.overflow).toBe('');
  });

  test('animates correctly', async () => {
    const { rerender } = render(<Offcanvas {...defaultProps} />);

    const panel = screen.getByTestId('offcanvas-panel');
    expect(panel).not.toHaveClass('translate-x-0');

    await act(async () => {
      vi.runAllTimers(); // Run initial animation frame
    });

    expect(panel).toHaveClass('translate-x-0');

    // Test closing animation
    rerender(<Offcanvas {...defaultProps} isOpen={false} />);

    await act(async () => {
      vi.runAllTimers();
    });

    expect(panel).not.toHaveClass('translate-x-0');
  });
});
