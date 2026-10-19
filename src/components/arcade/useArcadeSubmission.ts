import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthProvider';
import { getUserProfile } from '../../services/userProfileService';
import {
    getOwnGuestName,
    GuestNameRequiredError,
    GuestNameTakenError,
    submitArcadeScore,
} from '../../services/arcadeService';
import type { RunResult } from '../../utils/arcade/types';

/** A finished run and the fleet ship it was flown with (null for the neon fighter). They are
 *  one object so a submission is keyed by the run alone: the ship cannot change by itself. */
export interface FinishedRun {
    result: RunResult;
    shipName: string | null;
}

export type SubmissionStatus =
    | 'guest-invite'
    | 'needs-guest-name'
    | 'checking'
    | 'needs-username'
    | 'submitting'
    | 'submitted'
    | 'skipped'
    | 'error';

/**
 * Submits every finished run for an account or a named guest. A visitor with no session is
 * invited to join as a guest; an account without a username, or a guest without a name, is
 * asked for one first. The RPC keeps the higher score, so the client never compares against a
 * stored best. A run whose overlay closed or was replaced mid-check is still saved; only its
 * UI updates are dropped. The run's ship is sent with the score.
 */
export function useArcadeSubmission(finished: FinishedRun | null) {
    const { user, loading, guestUserId, signInAsGuest } = useAuth();
    const userId = user?.id ?? null;
    const identity = userId ?? guestUserId;
    const result = finished?.result ?? null;
    const [status, setStatus] = useState<SubmissionStatus>(
        loading || identity ? 'checking' : 'guest-invite'
    );
    const [rank, setRank] = useState<number | null>(null);
    const [leaderboardVersion, setLeaderboardVersion] = useState(0);
    const [profileAttempt, setProfileAttempt] = useState(0);
    const liveResultRef = useRef<RunResult | null>(null);
    const statusRef = useRef<SubmissionStatus>(status);
    const errorSourceRef = useRef<'profile' | 'submit'>('submit');
    /** The uid `signInAsGuest` returned, before the new `guestUserId` has re-rendered. */
    const signedInGuestRef = useRef<string | null>(null);
    /** True while `saveGuestName` signs in and submits, so the identity change that sign-in
     *  causes does not start a second check or submit. */
    const joiningRef = useRef(false);

    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    useEffect(() => {
        liveResultRef.current = result;
        return () => {
            liveResultRef.current = null;
        };
    }, [result]);

    const submit = useCallback(
        async (guestName?: string): Promise<'saved' | 'taken' | 'failed'> => {
            if (!finished) return 'failed';
            const { result } = finished;
            // A guest-name save keeps 'needs-guest-name' while in flight: the modal shows its own
            // saving state, and closing it would reset the typed name on a taken-name retry.
            if (liveResultRef.current === result && !guestName) setStatus('submitting');
            try {
                const saved = guestName
                    ? await submitArcadeScore(result, finished.shipName, guestName)
                    : await submitArcadeScore(result, finished.shipName);
                if (liveResultRef.current !== result) return 'saved';
                setRank(saved?.rank ?? null);
                setStatus('submitted');
                setLeaderboardVersion((v) => v + 1);
                return 'saved';
            } catch (error) {
                // A reply that lands after Skip leaves the dismissed modal closed.
                if (error instanceof GuestNameTakenError) {
                    if (liveResultRef.current === result && statusRef.current !== 'skipped') {
                        setStatus('needs-guest-name');
                    }
                    return 'taken';
                }
                if (error instanceof GuestNameRequiredError) {
                    if (liveResultRef.current === result && statusRef.current !== 'skipped') {
                        setStatus('needs-guest-name');
                    }
                    return 'failed';
                }
                console.error('Error submitting arcade score:', error);
                if (liveResultRef.current === result) {
                    errorSourceRef.current = 'submit';
                    setStatus('error');
                }
                return 'failed';
            }
        },
        [finished]
    );

    useEffect(() => {
        if (!guestUserId) signedInGuestRef.current = null;
    }, [guestUserId]);

    useEffect(() => {
        // While `saveGuestName` is signing in and submitting, an identity change is not a new check.
        if (joiningRef.current) return;
        setRank(null);
        // A still-resolving session is not a missing one: no guest invite until auth settles.
        if (loading) {
            setStatus('checking');
            return;
        }
        if (!result) {
            setStatus(identity ? 'checking' : 'guest-invite');
            return;
        }
        if (!identity) {
            setStatus('guest-invite');
            return;
        }
        let cancelled = false;
        setStatus('checking');
        const check: Promise<'ready' | 'needs-username' | 'needs-guest-name'> = userId
            ? getUserProfile(userId).then((p) => (p?.username ? 'ready' : 'needs-username'))
            : getOwnGuestName(identity).then((n) => (n ? 'ready' : 'needs-guest-name'));
        check
            .then((next) => {
                if (next === 'ready') {
                    void submit();
                    return;
                }
                if (!cancelled) setStatus(next);
            })
            .catch((error) => {
                if (cancelled) return;
                console.error('Error loading the arcade identity:', error);
                errorSourceRef.current = 'profile';
                setStatus('error');
            });
        return () => {
            cancelled = true;
        };
    }, [result, loading, userId, identity, submit, profileAttempt]);

    // A failed profile load re-runs the profile check, so a username-less account still gets the prompt.
    const retry = useCallback(() => {
        if (errorSourceRef.current === 'profile') setProfileAttempt((n) => n + 1);
        else void submit();
    }, [submit]);
    // A save that settles after Skip leaves the status alone.
    const onUsernameSaved = useCallback(() => {
        if (statusRef.current === 'needs-username') void submit();
    }, [submit]);
    const skip = useCallback(() => setStatus('skipped'), []);

    /** Opens the guest-name prompt; no anonymous session is created until a name is saved. */
    const joinAsGuest = useCallback(() => setStatus('needs-guest-name'), []);

    /** Signs in as a guest if needed, then claims `name` and saves the run in one call. A taken
     *  name leaves the session in place, so a retry reuses it. Throws while an account is
     *  signed in: an anonymous sign-in would replace that account's session. */
    const saveGuestName = useCallback(
        async (name: string): Promise<'saved' | 'taken'> => {
            if (userId) throw new Error('An account is signed in; it cannot join as a guest');
            joiningRef.current = true;
            try {
                if (!guestUserId && !signedInGuestRef.current) {
                    signedInGuestRef.current = await signInAsGuest();
                }
                const outcome = await submit(name);
                if (outcome === 'failed') throw new Error('Could not save the score');
                return outcome;
            } finally {
                joiningRef.current = false;
            }
        },
        [userId, guestUserId, signInAsGuest, submit]
    );

    return {
        status,
        rank,
        leaderboardVersion,
        retry,
        onUsernameSaved,
        skip,
        joinAsGuest,
        saveGuestName,
    };
}
