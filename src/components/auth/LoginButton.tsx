import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthProvider';
import { AuthModal } from './AuthModal';
import { Button } from '../ui/Button';

export const LoginButton: React.FC = () => {
    const { user, signOut } = useAuth();
    const [showAuthModal, setShowAuthModal] = useState(false);

    if (user) {
        return (
            <div className="flex items-center gap-2">
                {user.photoURL && (
                    <img
                        src={user.photoURL}
                        alt={user.displayName || user.email || 'User'}
                        className="w-8 h-8 rounded-full"
                    />
                )}
                <button
                    onClick={() => signOut()}
                    className="px-4 py-2 bg-dark-border hover:bg-dark-border-hover transition-colors"
                >
                    Sign Out
                </button>
            </div>
        );
    }

    return (
        <>
            <Button
                onClick={() => setShowAuthModal(true)}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-dark transition-colors w-full text-left"
            >
                Sign In
            </Button>
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </>
    );
};
