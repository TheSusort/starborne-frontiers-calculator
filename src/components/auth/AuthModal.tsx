import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthProvider';
import { useNotification } from '../../hooks/useNotification';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CloseIcon } from '../ui/icons/CloseIcon';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const PORTAL_ID = 'modal-root-high';

const getPortalRoot = () => {
    let root = document.getElementById(PORTAL_ID);
    if (!root) {
        root = document.createElement('div');
        root.setAttribute('id', PORTAL_ID);
        root.className = 'z-[80] relative';
        document.body.appendChild(root);
    }
    return root;
};

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showEmailForm, setShowEmailForm] = useState(false);
    const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
    const { addNotification } = useNotification();

    useEffect(() => {
        if (!isOpen) return;
        const scrollY = window.scrollY;
        document.body.style.position = 'fixed';
        document.body.style.top = `-${scrollY}px`;
        document.body.style.width = '100%';
        document.body.style.overflow = 'hidden';
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';
            document.body.style.overflow = '';
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();
        let succeeded = false;
        try {
            if (isSignUp) {
                await signUpWithEmail(email, password);
                addNotification('success', 'You can now sign in');
            } else {
                await signInWithEmail(email, password);
                addNotification('success', 'You are now signed in');
            }
            succeeded = true;
        } catch {
            // Error toast fired by AuthProvider; keep modal open.
        }
        if (succeeded) onClose();
    };

    const handleGoogleSignIn = async () => {
        let succeeded = false;
        try {
            await signInWithGoogle();
            addNotification('success', 'You are now signed in');
            succeeded = true;
        } catch {
            // Error toast fired by AuthProvider.
        }
        if (succeeded) onClose();
    };

    const handleBackToChoice = () => {
        setShowEmailForm(false);
        setEmail('');
        setPassword('');
    };

    const title = showEmailForm ? (isSignUp ? 'Sign Up' : 'Sign In') : 'Sign In';

    return createPortal(
        <>
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300"
                role="presentation"
            />
            <div className="fixed inset-0 z-[70]" onClick={onClose}>
                <div className="flex h-full items-center justify-center p-4">
                    <div
                        className="relative bg-dark-lighter border border-dark-border shadow-xl w-full max-w-lg flex"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-labelledby="auth-modal-title"
                    >
                        {/* Brand panel — desktop only */}
                        <div
                            aria-hidden="true"
                            className="hidden sm:flex flex-col justify-between w-2/5 p-4 relative overflow-hidden"
                            style={{
                                backgroundImage:
                                    "linear-gradient(180deg, rgba(11,16,24,.45) 0%, rgba(11,16,24,.85) 100%), url('/images/Deep_crevasse_01.png')",
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                            }}
                        >
                            <div className="relative">
                                <div className="font-secondary text-[0.65rem] text-primary uppercase tracking-[0.3em] [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]">
                                    {'// STARBORNE PLANNER'}
                                </div>
                                <div className="font-secondary text-lg text-white mt-3 leading-tight [text-shadow:0_2px_8px_rgba(0,0,0,0.7)]">
                                    Sync your fleet
                                    <br />
                                    across devices.
                                </div>
                                <div className="text-xs text-theme-text-secondary mt-2 [text-shadow:0_1px_4px_rgba(0,0,0,0.7)]">
                                    Optional. Local-first by default.
                                </div>
                            </div>
                            <div
                                className="relative h-px"
                                style={{
                                    background:
                                        'linear-gradient(90deg, rgb(var(--color-primary)) 0%, transparent 70%)',
                                }}
                            />
                        </div>

                        {/* Form panel */}
                        <div className="flex-1 flex flex-col">
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-border">
                                <div className="flex items-center gap-2">
                                    {showEmailForm && (
                                        <button
                                            type="button"
                                            onClick={handleBackToChoice}
                                            aria-label="Back to sign in options"
                                            data-testid="auth-back-to-choice"
                                            className="text-theme-text-secondary hover:text-theme-text leading-none text-lg p-1 -ml-1"
                                        >
                                            ←
                                        </button>
                                    )}
                                    <h3
                                        id="auth-modal-title"
                                        className="text-lg font-semibold font-secondary"
                                    >
                                        {title}
                                    </h3>
                                </div>
                                <button
                                    type="button"
                                    aria-label="Close modal"
                                    onClick={onClose}
                                    className="text-theme-text-secondary hover:text-theme-text p-1 -mr-1"
                                >
                                    <CloseIcon />
                                </button>
                            </div>

                            {/* Mobile compact brand */}
                            <div className="sm:hidden px-4 pt-3">
                                <div className="font-secondary text-[0.55rem] text-primary uppercase tracking-[0.3em]">
                                    {'// STARBORNE PLANNER'}
                                </div>
                                <div className="text-xs text-theme-text-secondary mt-1">
                                    Sync your fleet across devices. Optional.
                                </div>
                            </div>

                            {/* Sub-view content (animated swap via key change) */}
                            <div
                                key={showEmailForm ? 'form' : 'choice'}
                                className="px-4 py-4 animate-subview-enter"
                            >
                                {showEmailForm ? (
                                    <form
                                        onSubmit={(e) => void handleSubmit(e)}
                                        className="space-y-4"
                                    >
                                        <Input
                                            label="Email"
                                            type="email"
                                            id="email"
                                            name="email"
                                            autoComplete="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            data-testid="auth-email-input"
                                        />
                                        <Input
                                            label="Password"
                                            type="password"
                                            id="password"
                                            name="password"
                                            autoComplete={
                                                isSignUp ? 'new-password' : 'current-password'
                                            }
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            required
                                            data-testid="auth-password-input"
                                        />
                                        <Button
                                            variant="primary"
                                            fullWidth
                                            type="submit"
                                            data-testid={
                                                isSignUp
                                                    ? 'auth-signup-submit'
                                                    : 'auth-signin-submit'
                                            }
                                        >
                                            {isSignUp ? 'Sign Up' : 'Sign In'}
                                        </Button>
                                        <div className="text-center text-sm text-theme-text-secondary">
                                            {isSignUp
                                                ? 'Already have an account? '
                                                : "Don't have an account? "}
                                            <button
                                                type="button"
                                                onClick={() => setIsSignUp(!isSignUp)}
                                                data-testid="auth-toggle-mode"
                                                className="text-primary hover:underline font-medium"
                                            >
                                                {isSignUp ? 'Sign in' : 'Sign up'}
                                            </button>
                                        </div>
                                    </form>
                                ) : (
                                    <div className="flex flex-col gap-3">
                                        <Button
                                            onClick={() => void handleGoogleSignIn()}
                                            variant="secondary"
                                            fullWidth
                                            className="flex items-center gap-2 justify-center"
                                            type="button"
                                            data-testid="auth-google-button"
                                        >
                                            <img
                                                src="https://www.google.com/favicon.ico"
                                                alt=""
                                                className="w-4 h-4"
                                            />
                                            Google
                                        </Button>
                                        <div className="relative">
                                            <div className="absolute inset-0 flex items-center">
                                                <div className="w-full border-t border-dark-border" />
                                            </div>
                                            <div className="relative flex justify-center text-xs uppercase tracking-widest">
                                                <span className="px-2 bg-dark-lighter text-theme-text-secondary">
                                                    or
                                                </span>
                                            </div>
                                        </div>
                                        <Button
                                            onClick={() => setShowEmailForm(true)}
                                            variant="secondary"
                                            fullWidth
                                            type="button"
                                            data-testid="auth-continue-with-email"
                                        >
                                            Email
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>,
        getPortalRoot()
    );
};
