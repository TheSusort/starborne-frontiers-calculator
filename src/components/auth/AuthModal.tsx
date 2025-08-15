import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthProvider';
import { useNotification } from '../../hooks/useNotification';
import { Modal } from '../ui/layout/Modal';
import { Button, Input } from '../ui';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [showEmailForm, setShowEmailForm] = useState(false);
    const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
    const { addNotification } = useNotification();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        try {
            if (isSignUp) {
                await signUpWithEmail(email, password);
                addNotification('success', 'You can now sign in');
            } else {
                await signInWithEmail(email, password);
                addNotification('success', 'You are now signed in');
            }
            onClose();
        } catch (error) {
            setError(error instanceof Error ? error.message : 'An error occurred');
            addNotification('error', 'An error occurred');
        }
    };

    const handleGoogleSignIn = async () => {
        try {
            await signInWithGoogle();
            addNotification('success', 'You are now signed in');
            onClose();
        } catch (error) {
            setError(error instanceof Error ? error.message : 'An error occurred');
            addNotification('error', 'An error occurred');
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={showEmailForm ? (isSignUp ? 'Sign Up' : 'Sign In') : 'Sign In'}
            highZIndex
        >
            <div className="space-y-6">
                {error && <div className="text-red-500 text-sm">{error}</div>}

                <span className="text-sm text-gray-400">
                    Login is optional, to be able to easely access your data across devices. The app
                    works without it. If you login, your master data will be stored in Google
                    Firebase.
                    <b>
                        I recommend backing up your data through the home page, before logging in
                        for the first time.
                    </b>
                </span>
                {!showEmailForm ? (
                    <div className="flex flex-col gap-3">
                        <Button
                            onClick={handleGoogleSignIn}
                            variant="secondary"
                            fullWidth
                            className="flex items-center gap-2 justify-center"
                            type="button"
                        >
                            <img
                                src="https://www.google.com/favicon.ico"
                                alt="Google"
                                className="w-4 h-4"
                            />
                            Continue with Google
                        </Button>
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-dark-border"></div>
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-dark-lighter text-gray-400">Or</span>
                            </div>
                        </div>
                        <Button
                            onClick={() => setShowEmailForm(true)}
                            variant="secondary"
                            fullWidth
                            type="button"
                        >
                            Continue with Email
                        </Button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <Input
                                label="Email"
                                type="email"
                                id="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <Input
                                label="Password"
                                type="password"
                                id="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Button variant="primary" fullWidth type="submit">
                                {isSignUp ? 'Sign Up' : 'Sign In'}
                            </Button>
                            <Button
                                variant="secondary"
                                fullWidth
                                onClick={() => setIsSignUp(!isSignUp)}
                                type="button"
                            >
                                {isSignUp
                                    ? 'Already have an account? Sign in'
                                    : "Don't have an account? Sign up"}
                            </Button>
                            <Button
                                variant="secondary"
                                fullWidth
                                onClick={() => setShowEmailForm(false)}
                                type="button"
                            >
                                Back to sign in options
                            </Button>
                        </div>
                    </form>
                )}
            </div>
        </Modal>
    );
};
