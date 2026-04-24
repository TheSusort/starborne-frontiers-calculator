import React, { useMemo } from 'react';
import { useActiveProfile } from '../../../contexts/ActiveProfileProvider';
import { useNotification } from '../../../hooks/useNotification';
import { Dropdown } from '../Dropdown';
import { AltAccountIcon } from '../icons/AltAccountIcon';
import { type ProfileRow } from '../../../services/altAccountService';

const displayName = (profile: ProfileRow, authUserId: string | null): string => {
    if (profile.username) return profile.username;
    if (profile.id === authUserId && profile.email) {
        return profile.email.split('@')[0];
    }
    return `Profile ${profile.id.slice(0, 6)}`;
};

/**
 * Renders the profile switcher entries (main + alts) as Dropdown items.
 * Caller is responsible for wrapping in a <Dropdown>.
 *
 * Returns null when profiles are loading or there is no active profile,
 * which lets the caller skip the surrounding chrome too.
 */
export const ProfileSwitcherMenu: React.FC = () => {
    const { profiles, activeProfile, switchProfile, profilesLoading } = useActiveProfile();
    const { addNotification } = useNotification();

    const sortedProfiles = useMemo(() => {
        if (!profiles.length) return [];
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

    const handleSwitch = (profile: ProfileRow) => {
        if (profile.id === activeProfile.id) return;
        switchProfile(profile.id);
        addNotification('success', `Switched to ${displayName(profile, mainProfile?.id ?? null)}`);
    };

    return (
        <>
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
        </>
    );
};
