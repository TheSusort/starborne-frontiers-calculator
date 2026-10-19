import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthProvider';
import { getUserProfile } from '../../services/userProfileService';
import { submitArcadeScore } from '../../services/arcadeService';
import type { RunResult } from '../../utils/arcade/types';

/** A finished run and the fleet ship it was flown with (null for the neon fighter). They are
 *  one object so a submission is keyed by the run alone: the ship cannot change by itself. */
export interface FinishedRun {
    result: RunResult;
    shipName: string | null;
}

export type SubmissionStatus =
    'signed-out' | 'checking' | 'needs-username' | 'submitting' | 'submitted' | 'skipped' | 'error';

/**
 * Submits every finished run for a signed-in player; the RPC keeps the higher score, so the
 * client never compares against a stored best. A main account without a username is asked
 * for one first. A run whose overlay closed or was replaced mid-check is still saved; only its
 * UI updates are dropped. The run's ship is sent with the score.
 */
export function useArcadeSubmission(finished: FinishedRun | null) {
    const { user } = useAuth();
    const userId = user?.id ?? null;
    const result = finished?.result ?? null;
    const [status, setStatus] = useState<SubmissionStatus>(userId ? 'checking' : 'signed-out');
    const [rank, setRank] = useState<number | null>(null);
    const [leaderboardVersion, setLeaderboardVersion] = useState(0);
    const [profileAttempt, setProfileAttempt] = useState(0);
    const liveResultRef = useRef<RunResult | null>(null);
    const statusRef = useRef<SubmissionStatus>(status);
    const errorSourceRef = useRef<'profile' | 'submit'>('submit');

    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    useEffect(() => {
        liveResultRef.current = result;
        return () => {
            liveResultRef.current = null;
        };
    }, [result]);

    const submit = useCallback(async () => {
        if (!finished) return;
        const { result } = finished;
        if (liveResultRef.current === result) setStatus('submitting');
        try {
            const saved = await submitArcadeScore(result, finished.shipName);
            if (liveResultRef.current !== result) return;
            setRank(saved?.rank ?? null);
            setStatus('submitted');
            setLeaderboardVersion((v) => v + 1);
        } catch (error) {
            console.error('Error submitting arcade score:', error);
            if (liveResultRef.current === result) {
                errorSourceRef.current = 'submit';
                setStatus('error');
            }
        }
    }, [finished]);

    useEffect(() => {
        setRank(null);
        if (!result) {
            setStatus(userId ? 'checking' : 'signed-out');
            return;
        }
        if (!userId) {
            setStatus('signed-out');
            return;
        }
        let cancelled = false;
        setStatus('checking');
        getUserProfile(userId)
            .then((profile) => {
                if (profile?.username) {
                    void submit();
                    return;
                }
                if (!cancelled) setStatus('needs-username');
            })
            .catch((error) => {
                if (cancelled) return;
                console.error('Error loading profile for arcade score:', error);
                errorSourceRef.current = 'profile';
                setStatus('error');
            });
        return () => {
            cancelled = true;
        };
    }, [result, userId, submit, profileAttempt]);

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

    return { status, rank, leaderboardVersion, retry, onUsernameSaved, skip };
}
