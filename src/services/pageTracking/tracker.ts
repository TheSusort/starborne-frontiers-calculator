import { ActiveTimer } from './activeTimer';
import { addClick, type ClickMap } from './clicks';
import type { Device, Identity } from './environment';
import { errorFingerprint, isIgnoredError } from './errorFingerprint';

export const MAX_VISITS_PER_FLUSH = 20;
export const MAX_ERRORS_PER_FLUSH = 10;
export const MAX_MESSAGE_LENGTH = 300;
export const MAX_STACK_LENGTH = 1000;

/** One page view. The server UPSERTs by `id`, so every snapshot of a visit replaces the last. */
export interface VisitRecord {
    id: string;
    visitor_id: string;
    session_id: string;
    path: string;
    entered_at: string;
    active_ms: number;
    clicks: ClickMap;
    is_entry: boolean;
    referrer_host: string | null;
    device: Device;
    app_version: string;
}

export interface ErrorRecord {
    fingerprint: string;
    message: string;
    stack: string;
    path: string;
    app_version: string;
    visitor_id: string;
    session_id: string;
}

export interface TrackerDeps {
    now: () => number;
    newId: () => string;
    identity: Identity;
    referrerHost: string | null;
    device: Device;
    appVersion: string;
    isEnabled: () => boolean;
    send: (visits: VisitRecord[], errors: ErrorRecord[]) => void;
}

interface OpenVisit {
    id: string;
    pathname: string;
    pattern: string;
    enteredAt: number;
    timer: ActiveTimer;
    clicks: ClickMap;
    isEntry: boolean;
}

export class PageTracker {
    private open: OpenVisit | null = null;
    private readonly pendingVisits = new Map<string, VisitRecord>();
    private pendingErrors: ErrorRecord[] = [];
    private readonly seenFingerprints = new Set<string>();
    private entryClaimed: boolean;

    constructor(private readonly deps: TrackerDeps) {
        this.entryClaimed = !deps.identity.isNewSession;
    }

    /** Ends the open visit (queuing its final snapshot) and opens one for `pathname`. */
    startVisit(pathname: string, pattern: string, visible: boolean): void {
        if (this.open?.pathname === pathname) return;
        this.snapshot();
        const isEntry = !this.entryClaimed;
        this.entryClaimed = true;
        const now = this.deps.now();
        this.open = {
            id: this.deps.newId(),
            pathname,
            pattern,
            enteredAt: now,
            timer: new ActiveTimer(now, visible),
            clicks: {},
            isEntry,
        };
    }

    recordClick(trackId: string): void {
        if (!this.deps.isEnabled()) return;
        if (this.open) this.open.clicks = addClick(this.open.clicks, trackId);
    }

    recordError(message: string, stack: string | undefined): void {
        if (!this.deps.isEnabled() || isIgnoredError(message)) return;
        const fingerprint = errorFingerprint(message, stack);
        if (this.seenFingerprints.has(fingerprint)) return;
        this.seenFingerprints.add(fingerprint);
        this.pendingErrors.push({
            fingerprint,
            message: message.slice(0, MAX_MESSAGE_LENGTH),
            stack: (stack ?? '').slice(0, MAX_STACK_LENGTH),
            path: this.open?.pattern ?? '*',
            app_version: this.deps.appVersion,
            visitor_id: this.deps.identity.visitorId,
            session_id: this.deps.identity.sessionId,
        });
    }

    /** A hidden tab may never come back, so hiding queues a snapshot of the open visit and flushes. */
    setVisible(visible: boolean): void {
        this.open?.timer.setVisible(visible, this.deps.now());
        if (!visible) {
            this.snapshot();
            this.flush();
        }
    }

    flush(): void {
        if (!this.deps.isEnabled()) {
            this.pendingVisits.clear();
            this.pendingErrors = [];
            return;
        }
        while (this.pendingVisits.size > 0 || this.pendingErrors.length > 0) {
            const visits = [...this.pendingVisits.values()].slice(0, MAX_VISITS_PER_FLUSH);
            visits.forEach((v) => this.pendingVisits.delete(v.id));
            const errors = this.pendingErrors.splice(0, MAX_ERRORS_PER_FLUSH);
            try {
                this.deps.send(visits, errors);
            } catch {
                // A failing transport drops this batch; tracking never breaks the app.
            }
        }
    }

    private snapshot(): void {
        const visit = this.open;
        if (!visit || !this.deps.isEnabled()) return;
        this.pendingVisits.set(visit.id, {
            id: visit.id,
            visitor_id: this.deps.identity.visitorId,
            session_id: this.deps.identity.sessionId,
            path: visit.pattern,
            entered_at: new Date(visit.enteredAt).toISOString(),
            active_ms: visit.timer.total(this.deps.now()),
            clicks: visit.clicks,
            is_entry: visit.isEntry,
            referrer_host: visit.isEntry ? this.deps.referrerHost : null,
            device: this.deps.device,
            app_version: this.deps.appVersion,
        });
    }
}
