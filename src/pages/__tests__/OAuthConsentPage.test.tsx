import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { OAuthConsentPage } from '../OAuthConsentPage';

const { auth, oauth } = vi.hoisted(() => ({
    auth: {
        user: null as { id: string } | null,
        loading: false,
        signInWithGoogle: vi.fn(),
    },
    oauth: {
        getAuthorizationDetails: vi.fn(),
        approveAuthorization: vi.fn(),
        denyAuthorization: vi.fn(),
    },
}));

vi.mock('../../config/supabase', () => ({ supabase: { auth: { oauth } } }));
vi.mock('../../contexts/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../../components/auth/AuthModal', () => ({
    AuthModal: ({ isOpen, googleRedirectTo }: { isOpen: boolean; googleRedirectTo?: string }) =>
        isOpen ? <div data-testid="auth-modal">{googleRedirectTo}</div> : null,
}));

const DETAILS = {
    authorization_id: 'auth-1',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    client: { id: 'c1', name: 'Claude', uri: '', logo_uri: '' },
    user: { id: 'u1', email: 'admin@example.com' },
    scope: 'openid',
};

const DETAILS_B = {
    authorization_id: 'auth-2',
    redirect_uri: 'https://other-app.example/callback',
    client: { id: 'c2', name: 'Other App', uri: '', logo_uri: '' },
    user: { id: 'u1', email: 'admin@example.com' },
    scope: 'openid',
};

/** Renders at `url`. The page reads `window.location.href` (where sign-in must return to), which
 *  `MemoryRouter` never sets, so the browser URL is moved there too. */
const renderAt = (url: string) => {
    window.history.pushState({}, '', url);
    return render(
        <MemoryRouter initialEntries={[url]}>
            <OAuthConsentPage />
        </MemoryRouter>
    );
};

const CONSENT_URL = `${window.location.origin}/oauth/consent?authorization_id=auth-1`;

/** A button that navigates to `to` without remounting `OAuthConsentPage`, the way a client
 *  clicking a second connect link in the same tab would. */
const NavButton = ({ to }: { to: string }) => {
    const navigate = useNavigate();
    return <button onClick={() => void navigate(to)}>go-to-{to}</button>;
};

const renderWithNav = (url: string, navigateTo: string) =>
    render(
        <MemoryRouter initialEntries={[url]}>
            <NavButton to={navigateTo} />
            <OAuthConsentPage />
        </MemoryRouter>
    );

describe('OAuthConsentPage', () => {
    afterEach(() => window.history.pushState({}, '', '/'));

    beforeEach(() => {
        vi.clearAllMocks();
        auth.user = { id: 'u1' };
        auth.loading = false;
        oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
        oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'x' }, error: null });
        oauth.denyAuthorization.mockResolvedValue({ data: { redirect_url: 'x' }, error: null });
    });

    it('shows a signed-in player the request and approves it', async () => {
        renderAt('/oauth/consent?authorization_id=auth-1');

        expect(await screen.findByText('Claude')).toBeInTheDocument();
        expect(screen.getByText('claude.ai')).toBeInTheDocument();
        expect(screen.getByText('admin@example.com')).toBeInTheDocument();
        expect(
            screen.getByText('Read-only access to your ships, gear and engineering stats')
        ).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

        expect(oauth.approveAuthorization).toHaveBeenCalledWith('auth-1');
    });

    it('lets a signed-in player deny', async () => {
        renderAt('/oauth/consent?authorization_id=auth-1');

        await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));

        expect(oauth.denyAuthorization).toHaveBeenCalledWith('auth-1');
        expect(oauth.approveAuthorization).not.toHaveBeenCalled();
    });

    it('shows an error card and no buttons without authorization_id', () => {
        renderAt('/oauth/consent');

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows an error card and no buttons when Supabase rejects the request', async () => {
        oauth.getAuthorizationDetails.mockResolvedValue({
            data: null,
            error: { message: 'authorization not found' },
        });
        renderAt('/oauth/consent?authorization_id=auth-1');

        expect(await screen.findByRole('alert')).toHaveTextContent('authorization not found');
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('asks a signed-out visitor to sign in, returning to this exact URL', async () => {
        auth.user = null;
        renderAt('/oauth/consent?authorization_id=auth-1');

        await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));

        expect(auth.signInWithGoogle).toHaveBeenCalledWith(CONSENT_URL);
        expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    });

    it('offers a signed-out visitor email sign-in, with Google in it returning here too', async () => {
        auth.user = null;
        renderAt('/oauth/consent?authorization_id=auth-1');

        expect(screen.queryByTestId('auth-modal')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Sign in with email' }));

        expect(screen.getByTestId('auth-modal')).toHaveTextContent(CONSENT_URL);
        expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    });

    it('still reads authorization_id after the sign-in round-trip adds ?code=', async () => {
        renderAt('/oauth/consent?authorization_id=auth-1&code=returned-code');

        await screen.findByText('Claude');

        expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith('auth-1');
    });

    it("never shows request A's details or approves them once the URL moves to request B", async () => {
        oauth.getAuthorizationDetails.mockResolvedValueOnce({ data: DETAILS, error: null });
        let resolveB: (value: { data: typeof DETAILS_B; error: null }) => void = () => {};
        oauth.getAuthorizationDetails.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveB = resolve;
                })
        );

        renderWithNav(
            '/oauth/consent?authorization_id=auth-1',
            '/oauth/consent?authorization_id=auth-2'
        );

        expect(await screen.findByText('Claude')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /go-to-/ }));

        // B's details are still loading: A's client name must be gone, no Approve to click.
        expect(screen.queryByText('Claude')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

        resolveB({ data: DETAILS_B, error: null });
        expect(await screen.findByText('Other App')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

        expect(oauth.approveAuthorization).toHaveBeenCalledWith('auth-2');
        expect(oauth.approveAuthorization).not.toHaveBeenCalledWith('auth-1');
    });
});
