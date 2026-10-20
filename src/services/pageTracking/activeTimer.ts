export const MAX_ACTIVE_MS = 30 * 60 * 1000;

/** Accumulates time only while the tab is visible; a visit never reports more than MAX_ACTIVE_MS. */
export class ActiveTimer {
    private accumulated = 0;
    private visibleSince: number | null;

    constructor(now: number, visible: boolean) {
        this.visibleSince = visible ? now : null;
    }

    setVisible(visible: boolean, now: number): void {
        if (visible && this.visibleSince === null) {
            this.visibleSince = now;
        } else if (!visible && this.visibleSince !== null) {
            this.accumulated += now - this.visibleSince;
            this.visibleSince = null;
        }
    }

    total(now: number): number {
        const running = this.visibleSince === null ? 0 : now - this.visibleSince;
        return Math.min(MAX_ACTIVE_MS, this.accumulated + running);
    }
}
