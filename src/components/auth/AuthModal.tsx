import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthProvider';
import { Modal } from '../ui/layout/Modal';

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        try {
            if (isSignUp) {
                await signUpWithEmail(email, password);
            } else {
                await signInWithEmail(email, password);
            }
            onClose();
        } catch (error) {
            setError(error instanceof Error ? error.message : 'An error occurred');
        }
    };

    const handleGoogleSignIn = async () => {
        try {
            await signInWithGoogle();
            onClose();
        } catch (error) {
            setError(error instanceof Error ? error.message : 'An error occurred');
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={showEmailForm ? (isSignUp ? 'Sign Up' : 'Sign In') : 'Sign In'}
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
                        <button
                            onClick={handleGoogleSignIn}
                            className="px-4 py-2 bg-white hover:bg-gray-100 text-dark transition-colors rounded flex items-center justify-center gap-2"
                        >
                            <img
                                src="https://www.google.com/favicon.ico"
                                alt="Google"
                                className="w-4 h-4"
                            />
                            Continue with Google
                        </button>
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-dark-border"></div>
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-dark-lighter text-gray-400">Or</span>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowEmailForm(true)}
                            className="px-4 py-2 bg-primary hover:bg-primary-hover text-dark transition-colors rounded"
                        >
                            Continue with Email
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium">
                                Email
                            </label>
                            <input
                                type="email"
                                id="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="mt-1 block w-full rounded border-dark-border bg-dark p-2"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium">
                                Password
                            </label>
                            <input
                                type="password"
                                id="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="mt-1 block w-full rounded border-dark-border bg-dark p-2"
                                required
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <button
                                type="submit"
                                className="w-full px-4 py-2 bg-primary hover:bg-primary-hover text-dark transition-colors rounded"
                            >
                                {isSignUp ? 'Sign Up' : 'Sign In'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsSignUp(!isSignUp)}
                                className="text-sm text-gray-400 hover:text-white"
                            >
                                {isSignUp
                                    ? 'Already have an account? Sign in'
                                    : "Don't have an account? Sign up"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowEmailForm(false)}
                                className="text-sm text-gray-400 hover:text-white"
                            >
                                ← Back to sign in options
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </Modal>
    );
};
