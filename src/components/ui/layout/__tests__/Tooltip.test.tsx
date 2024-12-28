import { render, screen, fireEvent, act } from '../../../../test-utils/test-utils';
import { Tooltip } from '../Tooltip';
import { vi } from 'vitest';
import React, { Dispatch, SetStateAction } from 'react';
describe('Tooltip Component', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    test('renders children', () => {
        render(
            <Tooltip isVisible={true}>
                <button>Hover me</button>
            </Tooltip>
        );
        expect(screen.getByText('Hover me')).toBeInTheDocument();
    });

    test('shows tooltip on hover', async () => {
        const setState = vi.fn() as Dispatch<SetStateAction<boolean>>;
        const useStateMock: typeof React.useState = () => [true, setState];
        vi.spyOn(React, 'useState').mockImplementation(useStateMock);
        const [isTooltipVisible, setIsTooltipVisible] = useStateMock(false);
        render(
            <>
                <Tooltip isVisible={isTooltipVisible as boolean}>
                    <button>Hovered</button>
                </Tooltip>
                <div>
                    <button onMouseEnter={() => setIsTooltipVisible}>Hover me</button>
                </div>
            </>
        );

        fireEvent.mouseEnter(screen.getByText('Hover me'));
        act(() => {
            vi.runAllTimers();
        });

        expect(screen.getByText('Hovered')).toBeInTheDocument();
    });

    test('hides tooltip on mouse leave', async () => {
        const setState = vi.fn() as Dispatch<SetStateAction<boolean>>;
        const useStateMock: typeof React.useState = () => [true, setState];
        vi.spyOn(React, 'useState').mockImplementation(useStateMock);
        const [isTooltipVisible, setIsTooltipVisible] = useStateMock(false);

        render(
            <>
                <Tooltip isVisible={isTooltipVisible as boolean}>
                    <button>Hovered</button>
                </Tooltip>
                <div>
                    <button onMouseEnter={() => setIsTooltipVisible}>Hover me</button>
                </div>
            </>
        );

        const trigger = screen.getByText('Hover me');

        fireEvent.mouseEnter(trigger);
        act(() => {
            vi.runAllTimers();
        });

        fireEvent.mouseLeave(trigger);
        act(() => {
            vi.runAllTimers();
        });

        expect(screen.queryByText('Tooltip text')).not.toBeInTheDocument();
    });

    test('applies custom className to tooltip', () => {
        const setState = vi.fn() as Dispatch<SetStateAction<boolean>>;
        const useStateMock: typeof React.useState = () => [true, setState];
        vi.spyOn(React, 'useState').mockImplementation(useStateMock);
        const [isTooltipVisible, setIsTooltipVisible] = useStateMock(false);
        render(
            <>
                <Tooltip isVisible={isTooltipVisible as boolean} className="custom-tooltip">
                    <button>Hovered</button>
                </Tooltip>
                <div>
                    <button onMouseEnter={() => setIsTooltipVisible}>Hover me</button>
                </div>
            </>
        );
        fireEvent.mouseEnter(screen.getByText('Hover me'));
        act(() => {
            vi.runAllTimers();
        });
        // expect text hovered to have a parent with the class custom-tooltip
        const hovered = screen.getByText('Hovered');
        const parent = hovered.parentElement;
        expect(parent).toHaveClass('custom-tooltip');
    });
});
