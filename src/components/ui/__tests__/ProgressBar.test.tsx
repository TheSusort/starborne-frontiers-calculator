import { render, screen } from '../../../test-utils/test-utils'
import { ProgressBar } from '../ProgressBar'

describe('ProgressBar Component', () => {
    test('renders with correct value', () => {
        render(<ProgressBar current={50} total={100} />)
        const progressBar = screen.getByRole('progressbar')
        expect(progressBar).toHaveAttribute('aria-valuenow', '50')
        expect(progressBar).toHaveAttribute('aria-valuemax', '100')
    })

    test('displays correct percentage width', () => {
        render(<ProgressBar current={75} total={100} />)
        const progressFill = screen.getByTestId('progress-fill')
        expect(progressFill).toHaveStyle({ width: '75%' })
    })

    test('clamps value between 0 and max', () => {
        const { rerender } = render(<ProgressBar current={150} total={100} />)
        expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '100%' })

        rerender(<ProgressBar current={-10} total={100} />)
        expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '0%' })
    })

    test('applies custom className', () => {
        render(<ProgressBar current={50} total={100} className="custom-class" />)
        expect(screen.getByRole('progressbar')).toHaveClass('custom-class')
    })

    test('shows label when provided', () => {
        render(<ProgressBar current={50} total={100} label="Loading..." />)
        expect(screen.getByText('Loading...')).toBeInTheDocument()
    })
})