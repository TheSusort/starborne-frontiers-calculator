import React, { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FallbackErrorBoundary from '../FallbackErrorBoundary';

afterEach(() => vi.restoreAllMocks());

describe('FallbackErrorBoundary', () => {
    it('renders the fallback when a lazy chunk fails to load', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const Broken = React.lazy(() =>
            Promise.reject(new Error('Failed to fetch dynamically imported module'))
        );
        render(
            <div>
                <p>outside</p>
                <FallbackErrorBoundary fallback={<p>portrait</p>}>
                    <Suspense fallback={<p>loading</p>}>
                        <Broken />
                    </Suspense>
                </FallbackErrorBoundary>
            </div>
        );
        expect(await screen.findByText('portrait')).toBeTruthy();
        expect(screen.getByText('outside')).toBeTruthy();
    });

    it('renders its children when nothing throws', () => {
        render(
            <FallbackErrorBoundary fallback={<p>portrait</p>}>
                <p>model</p>
            </FallbackErrorBoundary>
        );
        expect(screen.getByText('model')).toBeTruthy();
    });
});
