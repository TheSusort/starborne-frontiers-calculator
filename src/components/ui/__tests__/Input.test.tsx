import { vi } from 'vitest'
import { render, screen, fireEvent } from '../../../test-utils/test-utils'
import { Input } from '../Input'

describe('Input Component', () => {
  test('renders input element', () => {
    render(<Input label="Test Input" name="test" />)
    expect(screen.getByLabelText('Test Input')).toBeInTheDocument()
  })

  test('handles value changes', () => {
    const handleChange = vi.fn()
    render(<Input label="Test Input" name="test" onChange={handleChange} />)

    const input = screen.getByLabelText('Test Input')
    fireEvent.change(input, { target: { value: 'new value' } })

    expect(handleChange).toHaveBeenCalled()
  })

  test('displays error message when provided', () => {
    render(<Input label="Test Input" name="test" error="This is an error" />)
    expect(screen.getByText('This is an error')).toBeInTheDocument()
  })
})