import { render, screen, fireEvent } from '../../../test-utils/test-utils';
import { Checkbox } from '../Checkbox';
import { vi } from 'vitest';

describe('Checkbox Component', () => {
  test('renders checkbox with label', () => {
    render(<Checkbox label="Test Checkbox" checked={false} onChange={() => {}} />);
    expect(screen.getByLabelText('Test Checkbox')).toBeInTheDocument();
  });

  test('handles change events', () => {
    const handleChange = vi.fn();
    render(<Checkbox label="Test Checkbox" checked={false} onChange={handleChange} />);

    const checkbox = screen.getByLabelText('Test Checkbox');
    fireEvent.click(checkbox);

    expect(handleChange).toHaveBeenCalledWith(true);
  });

  test('reflects checked state', () => {
    render(<Checkbox label="Test Checkbox" checked={true} onChange={() => {}} />);

    const checkbox = screen.getByLabelText('Test Checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  test('handles disabled state', () => {
    const handleChange = vi.fn();
    render(
      <Checkbox label="Test Checkbox" checked={false} onChange={handleChange} disabled={true} />
    );

    const checkbox = screen.getByLabelText('Test Checkbox');
    fireEvent.click(checkbox);

    expect(handleChange).not.toHaveBeenCalled();
    expect(checkbox).toBeDisabled();
  });

  test('uses provided id', () => {
    render(<Checkbox label="Test Checkbox" checked={false} onChange={() => {}} id="custom-id" />);

    const checkbox = screen.getByLabelText('Test Checkbox');
    expect(checkbox.id).toBe('custom-id');
  });

  test('generates consistent id from label when not provided', () => {
    render(<Checkbox label="Test Checkbox" checked={false} onChange={() => {}} />);

    const checkbox = screen.getByLabelText('Test Checkbox');
    expect(checkbox.id).toBe('checkbox-test-checkbox');
  });
});
