import { render, screen, fireEvent } from '../../../test-utils/test-utils'
import { CheckboxGroup } from '../CheckboxGroup'
import { vi } from 'vitest'

describe('CheckboxGroup Component', () => {
    const options = [
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2' },
        { value: 'option3', label: 'Option 3' },
    ]

    test('renders group label and all options', () => {
        render(
            <CheckboxGroup
                label="Test Group"
                options={options}
                values={[]}
                onChange={() => {}}
            />
        )

        expect(screen.getByText('Test Group')).toBeInTheDocument()
        options.forEach(option => {
            expect(screen.getByLabelText(option.label)).toBeInTheDocument()
        })
    })

    test('handles option selection', () => {
        const handleChange = vi.fn()
        render(
            <CheckboxGroup
                label="Test Group"
                options={options}
                values={[]}
                onChange={handleChange}
            />
        )

        const firstOption = screen.getByLabelText('Option 1')
        fireEvent.click(firstOption)

        expect(handleChange).toHaveBeenCalledWith(['option1'])
    })

    test('handles multiple selections', () => {
        const handleChange = vi.fn()
        render(
            <CheckboxGroup
                label="Test Group"
                options={options}
                values={['option1']}
                onChange={handleChange}
            />
        )

        const secondOption = screen.getByLabelText('Option 2')
        fireEvent.click(secondOption)

        expect(handleChange).toHaveBeenCalledWith(['option1', 'option2'])
    })

    test('handles deselection', () => {
        const handleChange = vi.fn()
        render(
            <CheckboxGroup
                label="Test Group"
                options={options}
                values={['option1', 'option2']}
                onChange={handleChange}
            />
        )

        const firstOption = screen.getByLabelText('Option 1')
        fireEvent.click(firstOption)

        expect(handleChange).toHaveBeenCalledWith(['option2'])
    })

    test('reflects initial values correctly', () => {
        render(
            <CheckboxGroup
                label="Test Group"
                options={options}
                values={['option1', 'option3']}
                onChange={() => {}}
            />
        )

        const option1 = screen.getByLabelText('Option 1') as HTMLInputElement
        const option2 = screen.getByLabelText('Option 2') as HTMLInputElement
        const option3 = screen.getByLabelText('Option 3') as HTMLInputElement

        expect(option1.checked).toBe(true)
        expect(option2.checked).toBe(false)
        expect(option3.checked).toBe(true)
    })

    test('handles disabled state', () => {
        const handleChange = vi.fn()
        render(
            <CheckboxGroup
                label="Test Group"
                options={options}
                values={[]}
                onChange={handleChange}
                disabled
            />
        )

        const option = screen.getByLabelText('Option 1')
        fireEvent.click(option)

        expect(handleChange).not.toHaveBeenCalled()
        expect(option).toBeDisabled()
    })
})