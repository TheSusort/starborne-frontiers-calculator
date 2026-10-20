import { describe, it, expect } from 'vitest';
import { PageTracker, type ErrorRecord, type TrackerDeps, type VisitRecord } from '../tracker';

function setup(overrides: Partial<TrackerDeps> = {}) {
    let clock = 0;
    let ids = 0;
    const sent: { visits: VisitRecord[]; errors: ErrorRecord[] }[] = [];
    const tracker = new PageTracker({
        now: () => clock,
        newId: () => `visit-${++ids}`,
        identity: { visitorId: 'v', sessionId: 's', isNewSession: true },
        referrerHost: 'www.reddit.com',
        device: 'desktop',
        appVersion: '1.81.0',
        isEnabled: () => true,
        send: (visits, errors) => sent.push({ visits, errors }),
        ...overrides,
    });
    return {
        tracker,
        sent,
        advance: (ms: number) => {
            clock += ms;
        },
    };
}

describe('PageTracker', () => {
    it('sends a finished visit with its active time and clicks on the next route', () => {
        const { tracker, sent, advance } = setup();
        tracker.startVisit('/gear', '/gear', true);
        tracker.recordClick('gear.simulate-upgrades');
        advance(4000);
        tracker.startVisit('/ships', '/ships', true);
        tracker.flush();
        expect(sent).toHaveLength(1);
        expect(sent[0].visits).toEqual([
            {
                id: 'visit-1',
                visitor_id: 'v',
                session_id: 's',
                path: '/gear',
                entered_at: new Date(0).toISOString(),
                active_ms: 4000,
                clicks: { 'gear.simulate-upgrades': 1 },
                is_entry: true,
                referrer_host: 'www.reddit.com',
                device: 'desktop',
                app_version: '1.81.0',
            },
        ]);
    });

    it('marks only the first visit of a new session as the entry, with the referrer', () => {
        const { tracker, sent } = setup();
        tracker.startVisit('/', '/', true);
        tracker.startVisit('/gear', '/gear', true);
        tracker.startVisit('/ships', '/ships', true);
        tracker.flush();
        const [first, second] = sent[0].visits;
        expect(first.is_entry).toBe(true);
        expect(second).toMatchObject({ is_entry: false, referrer_host: null });
    });

    it('never marks an entry when the session already existed', () => {
        const { tracker, sent } = setup({
            identity: { visitorId: 'v', sessionId: 's', isNewSession: false },
        });
        tracker.startVisit('/', '/', true);
        tracker.startVisit('/gear', '/gear', true);
        tracker.flush();
        expect(sent[0].visits[0]).toMatchObject({ is_entry: false, referrer_host: null });
    });

    it('ignores a repeated start for the same pathname', () => {
        const { tracker, sent } = setup();
        tracker.startVisit('/gear', '/gear', true);
        tracker.startVisit('/gear', '/gear', true);
        tracker.startVisit('/ships', '/ships', true);
        tracker.flush();
        expect(sent[0].visits.map((v) => v.id)).toEqual(['visit-1']);
    });

    it('snapshots the open visit on hide and resends the same id with the grown total', () => {
        const { tracker, sent, advance } = setup();
        tracker.startVisit('/gear', '/gear', true);
        advance(1000);
        tracker.setVisible(false);
        advance(60_000);
        tracker.setVisible(true);
        advance(500);
        tracker.startVisit('/ships', '/ships', true);
        tracker.flush();
        expect(sent.map((b) => b.visits.map((v) => [v.id, v.active_ms]))).toEqual([
            [['visit-1', 1000]],
            [['visit-1', 1500]],
        ]);
    });

    it('records each error fingerprint once and skips ignored noise', () => {
        const { tracker, sent } = setup();
        tracker.startVisit('/gear', '/gear', true);
        tracker.recordError('boom', 'Error: boom\n    at f (https://x/a-AAAAAAAA.js:1:1)');
        tracker.recordError('boom', 'Error: boom\n    at f (https://x/a-BBBBBBBB.js:9:9)');
        tracker.recordError('Script error.', undefined);
        tracker.flush();
        expect(sent[0].errors).toHaveLength(1);
        expect(sent[0].errors[0]).toMatchObject({ message: 'boom', path: '/gear' });
    });

    it('truncates long error text', () => {
        const { tracker, sent } = setup();
        tracker.recordError('m'.repeat(400), 's'.repeat(3000));
        tracker.flush();
        expect(sent[0].errors[0].message).toHaveLength(300);
        expect(sent[0].errors[0].stack).toHaveLength(1000);
        expect(sent[0].errors[0].path).toBe('*');
    });

    it('splits large queues into capped batches', () => {
        const { tracker, sent } = setup();
        for (let i = 0; i < 45; i++) tracker.startVisit(`/p${i}`, '*', true);
        for (let i = 0; i < 12; i++) tracker.recordError(`e${i}`, undefined);
        tracker.flush();
        expect(sent.map((b) => [b.visits.length, b.errors.length])).toEqual([
            [20, 10],
            [20, 2],
            [4, 0],
        ]);
    });

    it('drops everything without sending when disabled', () => {
        const { tracker, sent } = setup({ isEnabled: () => false });
        tracker.startVisit('/gear', '/gear', true);
        tracker.startVisit('/ships', '/ships', true);
        tracker.recordError('boom', undefined);
        tracker.flush();
        expect(sent).toEqual([]);
    });

    it('does not send an empty batch', () => {
        const { tracker, sent } = setup();
        tracker.flush();
        expect(sent).toEqual([]);
    });
});

describe('PageTracker robustness and opt-out', () => {
    it('does not throw when send throws, and later batches are still sent', () => {
        let calls = 0;
        const sent: VisitRecord[][] = [];
        const { tracker } = setup({
            send: (visits) => {
                calls++;
                if (calls === 1) throw new Error('boom');
                sent.push(visits);
            },
        });
        tracker.startVisit('/a', '/a', true);
        expect(() => tracker.setVisible(false)).not.toThrow();
        tracker.startVisit('/b', '/b', true);
        expect(() => tracker.flush()).not.toThrow();
        expect(sent.length).toBeGreaterThan(0);
    });

    it('records nothing while disabled, and a recurring error is sent once enabled', () => {
        let enabled = false;
        const { tracker, sent } = setup({ isEnabled: () => enabled });
        tracker.startVisit('/a', '/a', true);
        tracker.recordClick('gear.x');
        tracker.recordError('Boom', 'at f (a.js:1:1)');
        enabled = true;
        tracker.flush();
        expect(sent).toHaveLength(0);
        tracker.recordError('Boom', 'at f (a.js:1:1)');
        tracker.startVisit('/b', '/b', true);
        tracker.flush();
        expect(sent).toHaveLength(1);
        expect(sent[0].errors).toHaveLength(1);
        expect(sent[0].visits.map((v) => v.clicks)).toEqual([{}]);
    });
});
