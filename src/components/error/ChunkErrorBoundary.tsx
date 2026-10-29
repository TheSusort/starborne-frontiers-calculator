import React, { Component, ReactNode } from 'react';
import { Loader } from '../ui/Loader';
import { Button } from '../ui/Button';
import { isChunkLoadError, markReload, reloadedRecently } from './chunkLoadError';

export { CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS } from './chunkLoadError';

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
        return isChunkLoadError(error);
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
