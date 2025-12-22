import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthProvider';
import { AuthModal } from './AuthModal';
import { Button } from '../ui/Button';
import { UserIcon } from '../ui/icons';

export const LoginButton: React.FC = () => {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const [showAuthModal, setShowAuthModal] = useState(false);

    if (user) {
        return (
            <div className="flex items-center gap-2">
                {user.photoURL ? (
                    <img
                        src={user.photoURL}
                        alt={user.displayName || user.email || 'User'}
                        className="w-8 h-8 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => navigate('/profile')}
                        title="View Profile"
                    />
                ) : (
                    <div
                        className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => navigate('/profile')}
                        title="View Profile"
                    >
                        <UserIcon className="w-5 h-5 text-gray-300" />
                    </div>
                )}
                <Button
                    onClick={() => signOut()}
                    fullWidth
                    variant="secondary"
                    type="button"
                    className="text-right"
                >
                    Sign Out
                </Button>
            </div>
        );
    }

    return (
        <>
            <Button
                onClick={() => setShowAuthModal(true)}
                fullWidth
                variant="secondary"
                type="button"
                className="text-right"
            >
                Sign In
            </Button>
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </>
    );
};
