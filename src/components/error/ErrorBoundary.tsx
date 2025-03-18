import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
        };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return {
            hasError: true,
            error,
        };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error('Error caught by ErrorBoundary:', error);
        console.error('Component stack:', errorInfo.componentStack);
    }

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="p-4 bg-red-900 text-white rounded">
                    <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
                    <p className="mb-2">The component could not be displayed due to an error.</p>
                    <details className="bg-red-950 p-2 rounded">
                        <summary className="cursor-pointer">Error details</summary>
                        <pre className="mt-2 text-xs overflow-auto">
                            {this.state.error?.toString()}
                        </pre>
                    </details>
                    <button
                        className="mt-4 px-4 py-2 bg-red-700 hover:bg-red-600 rounded"
                        onClick={() => window.location.reload()}
                    >
                        Reload page
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
