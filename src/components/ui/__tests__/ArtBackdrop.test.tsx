import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtBackdrop } from '../ArtBackdrop';

let theme: 'dark' | 'synthwave' = 'dark';
vi.mock('../../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme }),
}));

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;
let trigger: ObserverCallback | null = null;

class FakeObserver {
    constructor(cb: ObserverCallback) {
        trigger = cb;
    }
    observe = vi.fn();
    disconnect = vi.fn();
}

describe('ArtBackdrop', () => {
    beforeEach(() => {
        theme = 'dark';
        trigger = null;
        vi.stubGlobal('IntersectionObserver', FakeObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('does not set the background before the section nears the viewport', () => {
        render(
            <ArtBackdrop src="/images/x.webp">
                <p>content</p>
            </ArtBackdrop>
        );
        expect(screen.getByText('content')).toBeTruthy();
        const art = screen.getByTestId<HTMLElement>('art-backdrop-image');
        expect(art.style.backgroundImage).toBe('');
        expect(art.className).toContain('art-backdrop-image');
    });

    it('sets the background once the section intersects', () => {
        render(
            <ArtBackdrop src="/images/x.webp">
                <p>content</p>
            </ArtBackdrop>
        );
        act(() => trigger?.([{ isIntersecting: true }]));
        const art = screen.getByTestId<HTMLElement>('art-backdrop-image');
        expect(art.style.backgroundImage).toContain('/images/x.webp');
    });

    it('renders no art in the synthwave theme but keeps the children', () => {
        theme = 'synthwave';
        render(
            <ArtBackdrop src="/images/x.webp">
                <p>content</p>
            </ArtBackdrop>
        );
        expect(screen.getByText('content')).toBeTruthy();
        expect(screen.queryByTestId('art-backdrop-image')).toBeNull();
    });

    it('applies the image immediately when IntersectionObserver is unavailable', () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        render(
            <ArtBackdrop src="/images/x.webp">
                <p>content</p>
            </ArtBackdrop>
        );
        const art = screen.getByTestId<HTMLElement>('art-backdrop-image');
        expect(art.style.backgroundImage).toContain('/images/x.webp');
    });
});
