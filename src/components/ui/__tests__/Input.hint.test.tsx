import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input';

describe('Input — hint', () => {
    it('renders a hint under the field', () => {
        render(<Input label="Pattern" value="" onChange={() => {}} hint="shape: cone" />);

        expect(screen.getByText('shape: cone')).toBeInTheDocument();
    });

    // error and hint share one slot; the failure is the more useful of the pair, so a
    // stale hint must not sit beside the message explaining why the value is rejected.
    it('suppresses the hint while an error is set', () => {
        render(
            <Input
                label="Pattern"
                value=""
                onChange={() => {}}
                hint="shape: cone"
                error="Unknown pattern shape"
            />
        );

        expect(screen.getByText('Unknown pattern shape')).toBeInTheDocument();
        expect(screen.queryByText('shape: cone')).not.toBeInTheDocument();
    });
});
