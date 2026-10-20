import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChunkErrorBoundary, {
    CHUNK_RELOAD_KEY,
    CHUNK_RELOAD_WINDOW_MS,
} from '../ChunkErrorBoundary';

const reload = vi.fn();
const originalLocation = window.location;

const Broken = (): React.ReactElement => {
    throw new Error('Failed to fetch dynamically imported module: /assets/Page-abc.js');
};

const renderBroken = () =>
    render(
        <ChunkErrorBoundary>
            <Broken />
        </ChunkErrorBoundary>
    );

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, reload },
    });
    sessionStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    reload.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('ChunkErrorBoundary', () => {
    it('reloads once on the first chunk load failure', () => {
        renderBroken();
        expect(screen.getByText('Updating to latest version...')).toBeTruthy();
        act(() => {
            vi.advanceTimersByTime(1500);
        });
        expect(reload).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
    });

    it('does not reload again when the chunk still fails right after a reload', () => {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        renderBroken();
        act(() => {
            vi.advanceTimersByTime(10_000);
        });
        expect(reload).not.toHaveBeenCalled();
        expect(screen.queryByText('Updating to latest version...')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reloads again once the previous automatic reload is old', () => {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now() - CHUNK_RELOAD_WINDOW_MS - 1));
        renderBroken();
        act(() => {
            vi.advanceTimersByTime(1500);
        });
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
