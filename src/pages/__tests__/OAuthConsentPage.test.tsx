import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OAuthConsentPage } from '../OAuthConsentPage';

const { auth, oauth, isAdmin } = vi.hoisted(() => ({
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
    isAdmin: vi.fn(),
}));

vi.mock('../../config/supabase', () => ({ supabase: { auth: { oauth } } }));
vi.mock('../../contexts/AuthProvider', () => ({ useAuth: () => auth }));
vi.mock('../../services/adminService', () => ({ isAdmin }));

const DETAILS = {
    authorization_id: 'auth-1',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    client: { id: 'c1', name: 'Claude', uri: '', logo_uri: '' },
    user: { id: 'u1', email: 'admin@example.com' },
    scope: 'openid',
};

const renderAt = (url: string) =>
    render(
        <MemoryRouter initialEntries={[url]}>
            <OAuthConsentPage />
        </MemoryRouter>
    );

describe('OAuthConsentPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.user = { id: 'u1' };
        auth.loading = false;
        oauth.getAuthorizationDetails.mockResolvedValue({ data: DETAILS, error: null });
        oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'x' }, error: null });
        oauth.denyAuthorization.mockResolvedValue({ data: { redirect_url: 'x' }, error: null });
    });

    it('shows an admin the request and approves it', async () => {
        isAdmin.mockResolvedValue(true);
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

    it('lets an admin deny', async () => {
        isAdmin.mockResolvedValue(true);
        renderAt('/oauth/consent?authorization_id=auth-1');

        await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));

        expect(oauth.denyAuthorization).toHaveBeenCalledWith('auth-1');
        expect(oauth.approveAuthorization).not.toHaveBeenCalled();
    });

    it('shows a non-admin the gate and only Deny', async () => {
        isAdmin.mockResolvedValue(false);
        renderAt('/oauth/consent?authorization_id=auth-1');

        expect(
            await screen.findByText('MCP access is currently limited to admins.')
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
        expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Deny' }));

        expect(oauth.denyAuthorization).toHaveBeenCalledWith('auth-1');
    });

    it('shows an error card and no buttons without authorization_id', () => {
        renderAt('/oauth/consent');

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows an error card and no buttons when Supabase rejects the request', async () => {
        isAdmin.mockResolvedValue(true);
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

        expect(auth.signInWithGoogle).toHaveBeenCalledWith(window.location.href);
        expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
    });

    it('still reads authorization_id after the sign-in round-trip adds ?code=', async () => {
        isAdmin.mockResolvedValue(true);
        renderAt('/oauth/consent?authorization_id=auth-1&code=returned-code');

        await screen.findByText('Claude');

        expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith('auth-1');
    });
});
