import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { Select } from '../Select';
import { vi } from 'vitest';

describe('Select Component', () => {
  const options = [
    { value: 'option1', label: 'Option 1' },
    { value: 'option2', label: 'Option 2' },
    { value: 'option3', label: 'Option 3' },
  ];

  test('renders select with label', () => {
    render(<Select label="Test Select" options={options} value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Test Select')).toBeInTheDocument();
  });

  test('renders all options', () => {
    render(<Select label="Test Select" options={options} value="" onChange={() => {}} />);

    options.forEach((option) => {
      expect(screen.getByText(option.label)).toBeInTheDocument();
    });
  });

  test('handles change events', () => {
    const handleChange = vi.fn();
    render(<Select label="Test Select" options={options} value="" onChange={handleChange} />);

    const select = screen.getByRole('option', { name: 'Option 1' });
    fireEvent.click(select);

    expect(handleChange).toHaveBeenCalledWith('option1');
  });

  test('shows selected value', () => {
    render(<Select label="Test Select" options={options} value="option2" onChange={() => {}} />);

    const select = screen.getByRole('button') as HTMLSelectElement;
    expect(select.textContent).toBe('Option 2');
  });

  test('handles disabled state', () => {
    render(
      <Select label="Test Select" options={options} value="" onChange={() => {}} disabled={true} />
    );

    const select = screen.getByRole('button');
    expect(select).toBeDisabled();
  });

  test('displays error message when provided', () => {
    render(
      <Select
        label="Test Select"
        options={options}
        value=""
        onChange={() => {}}
        error="This is an error"
      />
    );

    expect(screen.getByText('This is an error')).toBeInTheDocument();
  });
});
