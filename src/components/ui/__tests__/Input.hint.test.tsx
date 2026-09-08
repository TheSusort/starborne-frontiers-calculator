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

    // Feedback rendered as a sibling paragraph is only reachable to assistive tech if the
    // input points at it; both slots use the same mechanism.
    it('describes the input with the hint', () => {
        render(<Input label="Pattern" value="" onChange={() => {}} hint="shape: cone" />);

        expect(screen.getByLabelText('Pattern')).toHaveAccessibleDescription('shape: cone');
    });

    it('describes the input with the error when one is set', () => {
        render(
            <Input
                label="Pattern"
                value=""
                onChange={() => {}}
                hint="shape: cone"
                error="Unknown pattern shape"
            />
        );

        expect(screen.getByLabelText('Pattern')).toHaveAccessibleDescription(
            'Unknown pattern shape'
        );
    });

    it("merges a caller's own aria-describedby rather than replacing it", () => {
        render(
            <>
                <span id="outside">external note</span>
                <Input
                    label="Pattern"
                    value=""
                    onChange={() => {}}
                    hint="shape: cone"
                    aria-describedby="outside"
                />
            </>
        );

        expect(screen.getByLabelText('Pattern')).toHaveAccessibleDescription(
            'external note shape: cone'
        );
    });

    it('sets no description when there is neither hint nor error', () => {
        render(<Input label="Pattern" value="" onChange={() => {}} />);

        expect(screen.getByLabelText('Pattern')).not.toHaveAttribute('aria-describedby');
    });
});
