import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveProfile } from '../../../contexts/ActiveProfileProvider';
import { useNotification } from '../../../hooks/useNotification';
import { Dropdown } from '../Dropdown';
import { AltAccountIcon } from '../icons/AltAccountIcon';
import { type ProfileRow } from '../../../services/altAccountService';

/**
 * Resolve the best display name for a profile row.
 * Falls back to email prefix if username is absent, then to a truncated id.
 */
const displayName = (profile: ProfileRow, authUserId: string | null): string => {
    if (profile.username) return profile.username;
    if (profile.id === authUserId && profile.email) {
        // Use the part before the @ for the main profile
        return profile.email.split('@')[0];
    }
    return `Profile ${profile.id.slice(0, 6)}`;
};

/**
 * ProfileSwitcher — shows the active profile name in the sidebar with a
 * dropdown that lets the user switch between main + alt accounts, or navigate
 * to the profile management page.
 *
 * Returns null while profiles are loading or when there is no authenticated user.
 */
export const ProfileSwitcher: React.FC = () => {
    const { profiles, activeProfile, isOnAlt, switchProfile, profilesLoading } = useActiveProfile();
    const { addNotification } = useNotification();
    const navigate = useNavigate();

    // Sorted list: main profile first, then alts alphabetically by display name.
    const sortedProfiles = useMemo(() => {
        if (!profiles.length) return [];

        // Identify the main profile — the one whose id matches owner_auth_user_id or whose
        // owner_auth_user_id is null (it IS the auth user row).
        const main = profiles.find((p) => p.owner_auth_user_id === null);
        const alts = profiles
            .filter((p) => p.owner_auth_user_id !== null)
            .sort((a, b) => {
                const aName = displayName(a, main?.id ?? null);
                const bName = displayName(b, main?.id ?? null);
                return aName.localeCompare(bName);
            });

        return main ? [main, ...alts] : alts;
    }, [profiles]);

    if (profilesLoading || !activeProfile) return null;

    const mainProfile = sortedProfiles.find((p) => p.owner_auth_user_id === null) ?? null;
    const activeName = displayName(activeProfile, mainProfile?.id ?? null);

    const handleSwitch = (profile: ProfileRow) => {
        if (profile.id === activeProfile.id) return;
        switchProfile(profile.id);
        const name = displayName(profile, mainProfile?.id ?? null);
        addNotification('success', `Switched to ${name}`);
    };

    const trigger = (
        <button
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80 ${
                isOnAlt ? 'text-amber-400' : 'text-gray-300'
            }`}
            aria-label={`Active profile: ${activeName}. Click to switch profile.`}
        >
            <AltAccountIcon
                className={`flex-shrink-0 ${isOnAlt ? 'text-amber-400' : 'text-gray-400'}`}
            />
            <span className="truncate max-w-[120px]">{activeName}</span>
        </button>
    );

    return (
        <Dropdown trigger={trigger} align="left">
            {sortedProfiles.map((profile) => {
                const name = displayName(profile, mainProfile?.id ?? null);
                const isActive = profile.id === activeProfile.id;
                return (
                    <Dropdown.Item
                        key={profile.id}
                        onClick={() => handleSwitch(profile)}
                        className={isActive ? 'font-semibold text-teal-400' : ''}
                    >
                        <span className="flex items-center gap-2">
                            {profile.owner_auth_user_id !== null && (
                                <AltAccountIcon className="flex-shrink-0 text-amber-400" />
                            )}
                            <span className="truncate">{name}</span>
                            {isActive && (
                                <span className="ml-auto text-xs text-gray-500">active</span>
                            )}
                        </span>
                    </Dropdown.Item>
                );
            })}
            <div className="border-t border-dark-border mt-1 pt-1">
                <Dropdown.Item
                    onClick={() => void navigate('/profile')}
                    className="text-gray-400 text-sm"
                >
                    Manage profiles
                </Dropdown.Item>
            </div>
        </Dropdown>
    );
};
