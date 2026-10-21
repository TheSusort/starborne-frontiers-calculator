import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
    AutogearSession,
    AutogearShipResult,
    clearAutogearSession,
    installAutogearSessionResets,
    loadAutogearSession,
    saveAutogearSession,
} from '../autogearSession';
import { IMPORT_START_EVENT } from '../../../components/import/importEvents';
import { PROFILE_SWITCH_EVENT } from '../../../contexts/ActiveProfileProvider';

const result = {
    suggestions: [{ slotName: 'weapon', gearId: 'g1', score: 1 }],
} as unknown as AutogearShipResult;

const session: AutogearSession = {
    shipIds: ['ship-a', 'ship-b'],
    results: { 'ship-a': result },
    activeTab: 'ship-a',
};

describe('autogearSession', () => {
    beforeAll(() => installAutogearSessionResets());
    beforeEach(() => clearAutogearSession());

    it('round-trips a session for the same profile', () => {
        saveAutogearSession('profile-1', session);
        expect(loadAutogearSession('profile-1')).toEqual(session);
    });

    it('keeps signed-out sessions under their own key', () => {
        saveAutogearSession(null, session);
        expect(loadAutogearSession(null)).toEqual(session);
        expect(loadAutogearSession('profile-1')).toBeNull();
    });

    it('never serves one profile another profile’s results', () => {
        saveAutogearSession('profile-1', session);
        expect(loadAutogearSession('profile-2')).toBeNull();
    });

    it('drops stored data of an unknown shape', () => {
        sessionStorage.setItem('autogear_session', JSON.stringify({ v: 999, ...session }));
        expect(loadAutogearSession(null)).toBeNull();
        sessionStorage.setItem('autogear_session', '{not json');
        expect(loadAutogearSession(null)).toBeNull();
    });

    it.each([IMPORT_START_EVENT, PROFILE_SWITCH_EVENT, 'app:signout'])(
        'clears the session on %s',
        (event) => {
            saveAutogearSession('profile-1', session);
            window.dispatchEvent(new Event(event));
            expect(loadAutogearSession('profile-1')).toBeNull();
        }
    );
});
