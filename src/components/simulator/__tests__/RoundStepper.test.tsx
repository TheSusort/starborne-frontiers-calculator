import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import RoundStepper from '../RoundStepper';

describe('RoundStepper', () => {
    it('Next calls onChange with round + 1', () => {
        const onChange = vi.fn();
        render(<RoundStepper round={2} total={10} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        expect(onChange).toHaveBeenCalledWith(3);
    });

    it('Prev calls onChange with round - 1', () => {
        const onChange = vi.fn();
        render(<RoundStepper round={5} total={10} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /prev/i }));
        expect(onChange).toHaveBeenCalledWith(4);
    });

    it('Prev and First are disabled at round 1 (no call)', () => {
        const onChange = vi.fn();
        render(<RoundStepper round={1} total={10} onChange={onChange} />);
        const prev = screen.getByRole('button', { name: /prev/i });
        const first = screen.getByRole('button', { name: /first/i });
        expect(prev).toBeDisabled();
        expect(first).toBeDisabled();
        fireEvent.click(prev);
        fireEvent.click(first);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('Next and Last are disabled at total (no call)', () => {
        const onChange = vi.fn();
        render(<RoundStepper round={10} total={10} onChange={onChange} />);
        const next = screen.getByRole('button', { name: /next/i });
        const last = screen.getByRole('button', { name: /last/i });
        expect(next).toBeDisabled();
        expect(last).toBeDisabled();
        fireEvent.click(next);
        fireEvent.click(last);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('First calls onChange with 1', () => {
        const onChange = vi.fn();
        render(<RoundStepper round={5} total={10} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /first/i }));
        expect(onChange).toHaveBeenCalledWith(1);
    });

    it('Last calls onChange with total', () => {
        const onChange = vi.fn();
        render(<RoundStepper round={3} total={10} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /last/i }));
        expect(onChange).toHaveBeenCalledWith(10);
    });

    it('slider change to 5 calls onChange with 5', () => {
        const onChange = vi.fn();
        render(<RoundStepper round={1} total={10} onChange={onChange} />);
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '5' } });
        expect(onChange).toHaveBeenCalledWith(5);
    });

    it('renders "Round N / total" label', () => {
        render(<RoundStepper round={4} total={9} onChange={vi.fn()} />);
        expect(screen.getByText(/round 4 \/ 9/i)).toBeInTheDocument();
    });

    describe('play/pause auto-advance', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it('Play auto-advances across ticks via a controlled wrapper', () => {
            const onChange = vi.fn();
            // Stateful wrapper feeds the new round back so play advances across ticks.
            const Wrapper = () => {
                const [round, setRound] = useState(1);
                return (
                    <RoundStepper
                        round={round}
                        total={4}
                        onChange={(r) => {
                            onChange(r);
                            setRound(r);
                        }}
                    />
                );
            };
            render(<Wrapper />);
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /play/i }));
            });
            act(() => {
                vi.advanceTimersByTime(900);
            });
            expect(onChange).toHaveBeenLastCalledWith(2);
            act(() => {
                vi.advanceTimersByTime(900);
            });
            expect(onChange).toHaveBeenLastCalledWith(3);
        });

        it('Play stops at total (no advance past total)', () => {
            const onChange = vi.fn();
            render(<RoundStepper round={4} total={4} onChange={onChange} />);
            act(() => {
                fireEvent.click(screen.getByRole('button', { name: /play/i }));
            });
            act(() => {
                vi.advanceTimersByTime(5000);
            });
            expect(onChange).not.toHaveBeenCalled();
        });
    });
});
