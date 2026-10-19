import { Component, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    /** Rendered in place of the children once any of them throws, including a failed lazy chunk. */
    fallback: ReactNode;
}

interface State {
    failed: boolean;
}

/** Contains a failure to its own subtree. A `React.lazy` chunk that failed stays failed until
 *  the page reloads, so a remount shows the fallback again. */
class FallbackErrorBoundary extends Component<Props, State> {
    state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    render(): ReactNode {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

export default FallbackErrorBoundary;
