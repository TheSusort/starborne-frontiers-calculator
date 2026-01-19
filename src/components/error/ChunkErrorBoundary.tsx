import React, { Component, ReactNode } from 'react';
import { Loader } from '../ui/Loader';

interface Props {
    children: ReactNode;
}

interface State {
    hasChunkError: boolean;
}

/**
 * Error boundary that catches chunk load failures (which happen when
 * the app is updated and old chunks no longer exist) and auto-refreshes.
 *
 * This provides a seamless experience for users after deployments.
 */
class ChunkErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasChunkError: false };
    }

    static getDerivedStateFromError(error: Error): State | null {
        // Check if this is a chunk load error
        if (ChunkErrorBoundary.isChunkLoadError(error)) {
            return { hasChunkError: true };
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
            // eslint-disable-next-line no-console
            console.log('Chunk load error detected, refreshing to get latest version...');

            // Small delay to show the message, then refresh
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            // Log non-chunk errors for debugging
            // eslint-disable-next-line no-console
            console.error('Application error:', error, errorInfo);
        }
    }

    render(): ReactNode {
        if (this.state.hasChunkError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[200px]">
                    <Loader size="sm" />
                    <p className="text-gray-400 mt-4">Updating to latest version...</p>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ChunkErrorBoundary;
