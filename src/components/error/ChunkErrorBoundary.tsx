import React, { Component, ReactNode } from 'react';
import { Loader } from '../ui/Loader';
import { Button } from '../ui/Button';

/** sessionStorage key holding the time of the last automatic reload. */
export const CHUNK_RELOAD_KEY = 'chunkErrorReloadAt';
/** A chunk that still fails within this long of an automatic reload is not fixed by reloading,
 *  so the boundary stops and offers a manual reload instead of looping. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000;

/** Reads the last automatic reload time; storage that throws counts as "just reloaded", so a
 *  browser that blocks storage never loops. */
function reloadedRecently(): boolean {
    try {
        const at = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY));
        return at > 0 && Date.now() - at < CHUNK_RELOAD_WINDOW_MS;
    } catch {
        return true;
    }
}

function markReload(): void {
    try {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    } catch {
        // Storage that throws here also threw in reloadedRecently(), which blocks the reload.
    }
}

interface Props {
    children: ReactNode;
}

interface State {
    hasChunkError: boolean;
    /** The chunk failed again right after an automatic reload. */
    reloadBlocked: boolean;
}

/**
 * Error boundary that catches chunk load failures (which happen when
 * the app is updated and old chunks no longer exist) and auto-refreshes once.
 * If the chunk fails again within `CHUNK_RELOAD_WINDOW_MS`, it shows an error
 * with a manual reload button instead of reloading forever.
 */
class ChunkErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasChunkError: false, reloadBlocked: false };
    }

    static getDerivedStateFromError(error: Error): State | null {
        // Check if this is a chunk load error
        if (ChunkErrorBoundary.isChunkLoadError(error)) {
            return { hasChunkError: true, reloadBlocked: reloadedRecently() };
        }
        // Let other errors propagate
        return null;
    }

    static isChunkLoadError(error: Error): boolean {
        // Vite/Webpack chunk load errors typically contain these patterns
        const chunkErrorPatterns = [
            'Loading chunk',
            'ChunkLoadError',
            'Loading CSS chunk',
            'Failed to fetch dynamically imported module',
            'Importing a module script failed',
        ];

        const errorMessage = error.message || '';
        const errorName = error.name || '';

        return chunkErrorPatterns.some(
            (pattern) => errorMessage.includes(pattern) || errorName.includes(pattern)
        );
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        if (ChunkErrorBoundary.isChunkLoadError(error)) {
            if (this.state.reloadBlocked) {
                console.error('Chunk load error persists after a reload:', error);
                return;
            }
            markReload();
            // eslint-disable-next-line no-console
            console.log('Chunk load error detected, refreshing to get latest version...');

            // Small delay to show the message, then refresh
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            // Log non-chunk errors for debugging
            console.error('Application error:', error, errorInfo);
        }
    }

    render(): ReactNode {
        if (this.state.reloadBlocked) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
                    <p className="text-theme-text-secondary">
                        This page could not be loaded. Check your connection and try again.
                    </p>
                    <Button onClick={() => window.location.reload()}>Reload</Button>
                </div>
            );
        }

        if (this.state.hasChunkError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[200px]">
                    <Loader size="sm" />
                    <p className="text-theme-text-secondary mt-4">Updating to latest version...</p>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ChunkErrorBoundary;
