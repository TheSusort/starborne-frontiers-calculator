import { render, screen, fireEvent } from '../../../../test-utils/test-utils';
import { Sidebar } from '../Sidebar';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { APP_NAME } from '../../../../constants/config';
import { CURRENT_VERSION } from '../../../../constants/changelog';

// Mock the router hooks
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useLocation: () => ({
      pathname: '/gear',
    }),
  };
});

describe('Sidebar Component', () => {
  const renderWithRouter = (component: React.ReactNode) => {
    return render(<MemoryRouter>{component}</MemoryRouter>);
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  test('renders app name and version', () => {
    renderWithRouter(<Sidebar />);

    // Desktop view
    expect(screen.getAllByText(APP_NAME)).toHaveLength(2); // Both mobile and desktop
    expect(screen.getAllByText(CURRENT_VERSION)).toHaveLength(2); // Both mobile and desktop
  });

  test('renders all navigation links', () => {
    renderWithRouter(<Sidebar />);

    const expectedLinks = ['Ships', 'Gear', 'Loadouts', 'Engineering', 'Simulation', 'Autogear'];

    expectedLinks.forEach((link) => {
      expect(screen.getAllByText(link)).toHaveLength(1);
    });
  });

  test('highlights active link', () => {
    renderWithRouter(<Sidebar />);

    // Since we mocked useLocation to return /gear
    const gearLinks = screen.getAllByText('Gear');
    gearLinks.forEach((link) => {
      expect(link).toHaveClass('bg-primary');
    });

    // Other links should not be highlighted
    const shipsLinks = screen.getAllByText('Ships');
    shipsLinks.forEach((link) => {
      expect(link).not.toHaveClass('bg-primary');
    });
  });

  test('toggles mobile menu', async () => {
    renderWithRouter(<Sidebar />);

    // Initially closed
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Open menu
    const menuButton = screen.getByRole('button', { name: /open mobile menu/i });
    fireEvent.click(menuButton);

    await vi.runAllTimersAsync();

    // Check if Offcanvas is rendered
    expect(screen.getByTestId('offcanvas-panel')).toBeInTheDocument();

    // Close menu
    fireEvent.click(menuButton);

    await vi.runAllTimersAsync();

    // Menu should be closed
    expect(screen.queryByTestId('offcanvas-panel')).not.toBeInTheDocument();
  });

  test('closes mobile menu when link is clicked', async () => {
    renderWithRouter(<Sidebar />);

    // Open menu
    const menuButton = screen.getByRole('button', { name: /open mobile menu/i });
    fireEvent.click(menuButton);

    await vi.runAllTimersAsync();

    // Click a link
    const links = screen.getAllByText('Ships');
    fireEvent.click(links[0]); // Click the first occurrence

    await vi.runAllTimersAsync();

    // Menu should be closed
    expect(screen.queryByTestId('offcanvas-panel')).not.toBeInTheDocument();
  });

  test('renders correct mobile header', () => {
    renderWithRouter(<Sidebar />);

    const mobileHeader = screen.getByRole('banner');
    expect(mobileHeader).toHaveClass('lg:hidden');
    expect(mobileHeader).toHaveClass('fixed', 'top-0', 'left-0', 'right-0');
  });

  test('renders correct desktop sidebar', () => {
    renderWithRouter(<Sidebar />);

    const desktopSidebar = screen.getByTestId('desktop-sidebar');
    expect(desktopSidebar).toHaveClass('hidden', 'lg:block');
    expect(desktopSidebar).toHaveClass('fixed', 'top-0', 'left-0', 'h-full');
  });

  test('applies hover effects to links', () => {
    renderWithRouter(<Sidebar />);

    const links = screen.getAllByRole('link');
    links.forEach((link) => {
      expect(link).toHaveClass('transition-all', 'duration-200', 'ease-in-out');
      expect(link).toHaveClass('transform', 'hover:scale-105');
    });
  });
});
