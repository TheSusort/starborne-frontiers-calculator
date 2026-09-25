import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { Button } from '../components/ui/Button';
import { Loader } from '../components/ui/Loader';
import { PageLayout } from '../components/ui/layout/PageLayout';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthProvider';
import { isAdmin } from '../services/adminService';

type ConsentState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'not-admin' }
    | { kind: 'consent'; details: OAuthAuthorizationDetails };

const hostOf = (uri: string): string => {
    try {
        return new URL(uri).host;
    } catch {
        return uri;
    }
};

const ErrorCard: React.FC<{ message: string }> = ({ message }) => (
    <div className="card space-y-2" role="alert">
        <h2 className="text-lg font-semibold">This connection request cannot continue</h2>
        <p className="text-theme-text-secondary">{message}</p>
    </div>
);

/**
 * Supabase Auth's OAuth consent screen (Authorization Path `/oauth/consent`). An app connecting to
 * the planner's MCP server sends the player here with `authorization_id`; approving lets that app
 * read the player's fleet. The admin check here is the UX half of the gate — the MCP function
 * enforces it (`src/mcp/http.ts`).
 */
export const OAuthConsentPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const authorizationId = searchParams.get('authorization_id');
    const { user, loading: authLoading, signInWithGoogle } = useAuth();
    const [state, setState] = useState<ConsentState>({ kind: 'loading' });
    const [deciding, setDeciding] = useState(false);

    useEffect(() => {
        if (!authorizationId || !user) return;
        let cancelled = false;

        const load = async () => {
            if (!(await isAdmin(user.id))) {
                if (!cancelled) setState({ kind: 'not-admin' });
                return;
            }
            const { data, error } =
                await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
            if (cancelled) return;
            if (error || !data) {
                setState({
                    kind: 'error',
                    message: error?.message ?? 'The request was not found.',
                });
                return;
            }
            if ('redirect_url' in data) {
                // Already approved earlier: Supabase hands back the client's redirect directly.
                window.location.assign(data.redirect_url);
                return;
            }
            setState({ kind: 'consent', details: data });
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [authorizationId, user]);

    const decide = async (approve: boolean) => {
        if (!authorizationId) return;
        setDeciding(true);
        const { error } = approve
            ? await supabase.auth.oauth.approveAuthorization(authorizationId)
            : await supabase.auth.oauth.denyAuthorization(authorizationId);
        if (error) {
            setState({ kind: 'error', message: error.message });
            setDeciding(false);
        }
    };

    const body = (() => {
        if (!authorizationId) {
            return (
                <ErrorCard message="The link is missing its authorization request. Start connecting again from your app." />
            );
        }
        if (authLoading) return <Loader />;
        if (!user) {
            return (
                <div className="card space-y-4">
                    <p>Sign in to choose whether this app may read your planner data.</p>
                    <Button onClick={() => void signInWithGoogle(window.location.href)}>
                        Sign in with Google
                    </Button>
                </div>
            );
        }
        if (state.kind === 'loading') return <Loader />;
        if (state.kind === 'error') return <ErrorCard message={state.message} />;
        if (state.kind === 'not-admin') {
            return (
                <div className="card space-y-4">
                    <p>MCP access is currently limited to admins.</p>
                    <Button
                        variant="secondary"
                        disabled={deciding}
                        onClick={() => void decide(false)}
                    >
                        Deny
                    </Button>
                </div>
            );
        }
        const { details } = state;
        return (
            <div className="card space-y-4">
                <dl className="space-y-2">
                    <div>
                        <dt className="text-theme-text-secondary text-sm">App</dt>
                        <dd className="font-semibold">{details.client.name}</dd>
                    </div>
                    <div>
                        <dt className="text-theme-text-secondary text-sm">Returns to</dt>
                        <dd>{hostOf(details.redirect_uri)}</dd>
                    </div>
                    <div>
                        <dt className="text-theme-text-secondary text-sm">Signed in as</dt>
                        <dd>{details.user.email}</dd>
                    </div>
                    <div>
                        <dt className="text-theme-text-secondary text-sm">Access</dt>
                        <dd>Read-only access to your ships, gear and engineering stats</dd>
                    </div>
                </dl>
                <div className="flex gap-2">
                    <Button disabled={deciding} onClick={() => void decide(true)}>
                        Approve
                    </Button>
                    <Button
                        variant="secondary"
                        disabled={deciding}
                        onClick={() => void decide(false)}
                    >
                        Deny
                    </Button>
                </div>
            </div>
        );
    })();

    return (
        <PageLayout
            title="Connect an app"
            description="An app is asking to read your planner data."
        >
            {body}
        </PageLayout>
    );
};

export default OAuthConsentPage;
