import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthProvider';
import { useActiveProfile } from '../../contexts/ActiveProfileProvider';
import { Button } from '../ui/Button';
import { Dropdown } from '../ui/Dropdown';
import { ChevronDownIcon, UserIcon } from '../ui/icons';
import { ProfileSwitcherMenu } from '../ui/layout/ProfileSwitcher';
import { AuthModal } from './AuthModal';

export const LoginButton: React.FC = () => {
    const { user, signOut } = useAuth();
    const { activeProfile, profiles } = useActiveProfile();
    const navigate = useNavigate();
    const [showAuthModal, setShowAuthModal] = useState(false);

    if (user) {
        const displayLabel = activeProfile?.username || 'Account';
        const hasAlts = profiles.some((p) => p.owner_auth_user_id !== null);

        const trigger = (isOpen: boolean) => (
            <div className="w-full flex gap-2 cursor-pointer" title="Account menu">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-dark border border-dark-border hover:bg-dark-lighter transition-colors">
                    <ChevronDownIcon
                        className={`flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    />
                    <span className="flex-1 truncate text-right">{displayLabel}</span>
                </div>
                <div className="bg-dark border border-dark-border hover:bg-dark-lighter transition-colors overflow-hidden flex items-center justify-center flex-shrink-0">
                    {user.photoURL ? (
                        <img
                            src={user.photoURL}
                            alt={user.displayName || user.email || 'User'}
                            className="w-10 h-10 object-cover"
                        />
                    ) : (
                        <UserIcon className="w-10 h-5 text-theme-text" />
                    )}
                </div>
            </div>
        );

        return (
            <Dropdown trigger={trigger} align="left" direction="up">
                {hasAlts && <ProfileSwitcherMenu />}
                <div className={hasAlts ? 'border-t border-dark-border mt-1 pt-1' : ''}>
                    <Dropdown.Item
                        onClick={() => void navigate('/profile')}
                        className="text-gray-400 text-sm"
                    >
                        Profile
                    </Dropdown.Item>
                    <Dropdown.Item onClick={() => void signOut()} className="text-gray-400 text-sm">
                        Sign Out
                    </Dropdown.Item>
                </div>
            </Dropdown>
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
