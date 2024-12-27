import { render, screen } from './test-utils/test-utils';
import App from './App';

describe('App Component', () => {
  test('renders without crashing', () => {
    render(<App />);
    // Update this test based on what's actually in your App component
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  // Add more app-level tests here
});
