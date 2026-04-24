import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthProvider';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { UserIcon } from '../ui/icons';
import { ProfileSwitcherMenu } from '../ui/layout/ProfileSwitcher';
import { AuthModal } from './AuthModal';

export const LoginButton: React.FC = () => {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const [showAuthModal, setShowAuthModal] = useState(false);

    if (user) {
        const trigger = user.photoURL ? (
            <img
                src={user.photoURL}
                alt={user.displayName || user.email || 'User'}
                className="w-10 h-10 cursor-pointer hover:opacity-80 transition-opacity object-cover"
                title="Account menu"
            />
        ) : (
            <div
                className="w-8 h-8 bg-dark-lighter flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
                title="Account menu"
            >
                <UserIcon className="w-5 h-5 text-theme-text" />
            </div>
        );

        return (
            <div className="flex items-center gap-2">
                <Dropdown trigger={trigger} align="left" direction="up">
                    <ProfileSwitcherMenu />
                    <div className="border-t border-dark-border mt-1 pt-1">
                        <Dropdown.Item
                            onClick={() => void navigate('/profile')}
                            className="text-gray-400 text-sm"
                        >
                            Profile
                        </Dropdown.Item>
                    </div>
                </Dropdown>
                <Button
                    onClick={() => void signOut()}
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
                data-testid="open-auth-modal"
            >
                Sign In
            </Button>
            <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
        </>
    );
};
