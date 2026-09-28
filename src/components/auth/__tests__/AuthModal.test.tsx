import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthModal } from '../AuthModal';

const { signInWithGoogle } = vi.hoisted(() => ({ signInWithGoogle: vi.fn() }));

vi.mock('../../../contexts/AuthProvider', () => ({
    useAuth: () => ({
        signInWithEmail: vi.fn(),
        signUpWithEmail: vi.fn(),
        signInWithGoogle,
    }),
}));

vi.mock('../../../hooks/useNotification', () => ({
    useNotification: () => ({ addNotification: vi.fn() }),
}));

describe('AuthModal', () => {
    const onClose = vi.fn();
    beforeEach(() => {
        onClose.mockClear();
        signInWithGoogle.mockClear();
    });

    it('sends Google sign-in back to googleRedirectTo, or to the default when omitted', () => {
        const { unmount } = render(
            <AuthModal
                isOpen
                onClose={onClose}
                googleRedirectTo="https://x.test/oauth/consent?a=1"
            />
        );
        fireEvent.click(screen.getByTestId('auth-google-button'));
        expect(signInWithGoogle).toHaveBeenLastCalledWith('https://x.test/oauth/consent?a=1');
        unmount();

        render(<AuthModal isOpen onClose={onClose} />);
        fireEvent.click(screen.getByTestId('auth-google-button'));
        expect(signInWithGoogle).toHaveBeenLastCalledWith(undefined);
    });

    it('does not render when closed', () => {
        const { container } = render(<AuthModal isOpen={false} onClose={onClose} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the choice view by default with Google and Email buttons', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        expect(screen.getByTestId('auth-google-button')).toBeInTheDocument();
        expect(screen.getByTestId('auth-continue-with-email')).toBeInTheDocument();
        // Form fields are hidden in the choice view.
        expect(screen.queryByTestId('auth-email-input')).not.toBeInTheDocument();
    });

    it('Google button label is "Google" (no "Continue with" prefix)', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        const googleBtn = screen.getByTestId('auth-google-button');
        expect(googleBtn).toHaveTextContent(/^Google$/);
    });

    it('Email button label is "Email" (no "Continue with" prefix)', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        const emailBtn = screen.getByTestId('auth-continue-with-email');
        expect(emailBtn).toHaveTextContent(/^Email$/);
    });

    it('clicking Email reveals the email/password form and the back caret', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        fireEvent.click(screen.getByTestId('auth-continue-with-email'));
        expect(screen.getByTestId('auth-email-input')).toBeInTheDocument();
        expect(screen.getByTestId('auth-password-input')).toBeInTheDocument();
        expect(screen.getByTestId('auth-signin-submit')).toBeInTheDocument();
        expect(screen.getByTestId('auth-back-to-choice')).toBeInTheDocument();
    });

    it('back caret returns from email form to choice view and clears fields', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        fireEvent.click(screen.getByTestId('auth-continue-with-email'));
        const email = screen.getByTestId<HTMLInputElement>('auth-email-input');
        fireEvent.change(email, { target: { value: 'a@b.c' } });
        fireEvent.click(screen.getByTestId('auth-back-to-choice'));
        expect(screen.getByTestId('auth-google-button')).toBeInTheDocument();
        // Re-enter form, fields are cleared.
        fireEvent.click(screen.getByTestId('auth-continue-with-email'));
        expect(screen.getByTestId<HTMLInputElement>('auth-email-input').value).toBe('');
    });

    it('mode toggle switches between sign-in and sign-up submit testids', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        fireEvent.click(screen.getByTestId('auth-continue-with-email'));
        expect(screen.getByTestId('auth-signin-submit')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('auth-toggle-mode'));
        expect(screen.getByTestId('auth-signup-submit')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('auth-toggle-mode'));
        expect(screen.getByTestId('auth-signin-submit')).toBeInTheDocument();
    });

    it('clicking the close button calls onClose', () => {
        render(<AuthModal isOpen onClose={onClose} />);
        fireEvent.click(screen.getByLabelText('Close modal'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
