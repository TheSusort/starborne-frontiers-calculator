import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthProvider';
import { useActiveProfile } from '../contexts/ActiveProfileProvider';
import { useNotification } from '../hooks/useNotification';
import { PageLayout } from '../components/ui';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Checkbox } from '../components/ui/Checkbox';
import { Loader } from '../components/ui/Loader';
import { StatCard } from '../components/ui/StatCard';
import {
    getUserProfile,
    updateUserProfile,
    checkUsernameAvailability,
    getUserStats,
    getUserUsageStats,
    getTopShipRankings,
    UserProfile,
    UserStats,
    UserUsageStats,
    TopShipRanking,
} from '../services/userProfileService';
import { StorageKey } from '../constants/storage';
import { AltAccountsSection } from '../components/profile/AltAccountsSection';
import { EngineeringLeaderboards } from '../components/engineering/EngineeringLeaderboards';
import Seo from '../components/seo/Seo';
import { TrophyIcon } from '../components/ui/icons';

export const ProfilePage: React.FC = () => {
    const { user } = useAuth();
    const { activeProfileId, isOnAlt, refreshProfiles } = useActiveProfile();
    const { addNotification } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [stats, setStats] = useState<UserStats | null>(null);
    const [usageStats, setUsageStats] = useState<UserUsageStats | null>(null);
    const [topShips, setTopShips] = useState<TopShipRanking[]>([]);
    const [shipsLoading, setShipsLoading] = useState(false);

    // Form state
    const [username, setUsername] = useState('');
    const [inGameId, setInGameId] = useState('');
    const [isPublic, setIsPublic] = useState(false);
    const [usernameError, setUsernameError] = useState<string | null>(null);
    const [checkingUsername, setCheckingUsername] = useState(false);
    const [showImportSummary, setShowImportSummary] = useState(
        () => localStorage.getItem(StorageKey.SHOW_IMPORT_SUMMARY) !== 'false'
    );

    useEffect(() => {
        if (!user?.id || !activeProfileId) {
            setLoading(false);
            return;
        }

        const loadProfileData = async () => {
            try {
                setLoading(true);
                // Load profile, stats, and usage stats first (fast).
                // getUserProfile / getUserUsageStats operate on the auth identity (users table).
                // getUserStats queries game-data tables (ships, inventory, engineering) and is
                // scoped to the active profile so alt accounts show their own fleet stats.
                const [profileData, statsData, usageData] = await Promise.all([
                    getUserProfile(activeProfileId), // active profile (username, public flag, in_game_id)
                    getUserStats(activeProfileId), // game data — scoped to active profile
                    getUserUsageStats(activeProfileId), // usage stats scoped to active profile (alt shows alt's stats)
                ]);

                setProfile(profileData);
                setStats(statsData);
                setUsageStats(usageData);

                // Set form values
                if (profileData) {
                    setUsername(profileData.username || '');
                    setInGameId(profileData.in_game_id || '');
                    setIsPublic(profileData.is_public || false);
                }
            } catch (error) {
                console.error('Error loading profile data:', error);
                addNotification('error', 'Failed to load profile data');
            } finally {
                setLoading(false);
            }
        };

        void loadProfileData();
    }, [user?.id, activeProfileId, addNotification]);

    // Load ship rankings asynchronously (separate from main page load)
    useEffect(() => {
        if (!activeProfileId) {
            setTopShips([]);
            return;
        }

        const loadShipRankings = async () => {
            try {
                setShipsLoading(true);
                const shipsData = await getTopShipRankings(activeProfileId); // game data — scoped to active profile
                setTopShips(shipsData);
            } catch (error) {
                console.error('Error loading ship rankings:', error);
                addNotification('error', 'Failed to load ship rankings');
            } finally {
                setShipsLoading(false);
            }
        };

        // Load ship rankings after a short delay to let the page render first
        const timer = setTimeout(() => {
            void loadShipRankings();
        }, 100);

        return () => clearTimeout(timer);
    }, [activeProfileId, addNotification]);

    const validateUsername = (value: string): boolean => {
        const usernameRegex = /^[a-zA-Z0-9 _-]{3,20}$/;
        if (!value) {
            setUsernameError(null);
            return true; // Empty is allowed
        }
        if (!usernameRegex.test(value)) {
            setUsernameError(
                'Username must be 3-20 characters (letters, numbers, spaces, dashes, underscores)'
            );
            return false;
        }
        setUsernameError(null);
        return true;
    };

    const handleUsernameChange = async (value: string) => {
        setUsername(value);
        setUsernameError(null);

        if (!value) {
            return; // Empty is allowed
        }

        if (!validateUsername(value)) {
            return;
        }

        // Check availability if username changed and is different from current
        if (value !== profile?.username) {
            setCheckingUsername(true);
            try {
                const isAvailable = await checkUsernameAvailability(value);
                if (!isAvailable) {
                    setUsernameError('Username is already taken');
                }
            } catch (error) {
                console.error('Error checking username availability:', error);
                setUsernameError('Error checking username availability');
            } finally {
                setCheckingUsername(false);
            }
        }
    };

    const handleSave = async () => {
        if (!user?.id || !activeProfileId || !profile) return;

        // Validate username
        if (username && !validateUsername(username)) {
            return;
        }

        // Check if username is available (if changed)
        if (username && username !== profile.username) {
            setCheckingUsername(true);
            try {
                const isAvailable = await checkUsernameAvailability(username);
                if (!isAvailable) {
                    setUsernameError('Username is already taken');
                    setCheckingUsername(false);
                    return;
                }
            } catch (error) {
                console.error('Error checking username availability:', error);
                setUsernameError('Error checking username availability');
                setCheckingUsername(false);
                return;
            } finally {
                setCheckingUsername(false);
            }
        }

        try {
            setSaving(true);
            const updatedProfile = await updateUserProfile(activeProfileId, {
                username: username || null,
                in_game_id: inGameId || null,
                is_public: isPublic,
            });

            setProfile(updatedProfile);
            // Refresh profiles so the sidebar switcher reflects the new username / is_public.
            await refreshProfiles();
            addNotification('success', 'Profile updated successfully');
        } catch (error) {
            console.error('Error updating profile:', error);
            addNotification('error', 'Failed to update profile');
        } finally {
            setSaving(false);
        }
    };

    if (!user) {
        return (
            <PageLayout title="Profile">
                <div className="text-center py-8">
                    <p className="text-theme-text-secondary">Please sign in to view your profile</p>
                </div>
            </PageLayout>
        );
    }

    if (loading) {
        return <Loader />;
    }

    const hasChanges =
        username !== (profile?.username || '') ||
        inGameId !== (profile?.in_game_id || '') ||
        isPublic !== (profile?.is_public || false);

    return (
        <>
            <Seo
                title="Profile"
                description="Manage your profile settings, view statistics, and see your leaderboard rankings"
            />
            <PageLayout title="Profile" description="Manage your profile and view your statistics">
                <div className="space-y-8">
                    {/* Profile Settings */}
                    <div className="card space-y-4">
                        <h2 className="text-xl font-semibold">Profile Settings</h2>

                        <div className="space-y-4">
                            <Input
                                label="Username"
                                value={username}
                                onChange={(e) => void handleUsernameChange(e.target.value)}
                                placeholder="Enter username (3-20 characters)"
                                error={usernameError || undefined}
                                helpLabel="Username will appear in leaderboards if you're set to public. Must be unique."
                            />

                            <Input
                                label="In-Game ID"
                                value={inGameId}
                                onChange={(e) => setInGameId(e.target.value)}
                                placeholder="Enter your in-game ID"
                                helpLabel="Your in-game ID for friend requests and duels"
                            />

                            <Checkbox
                                label="Show in Public Leaderboards"
                                checked={isPublic}
                                onChange={setIsPublic}
                                helpLabel="When enabled, your username will appear in public leaderboards. When disabled, you'll appear as 'Anonymous'."
                            />

                            <div className="flex justify-end pt-2">
                                <Button
                                    onClick={() => void handleSave()}
                                    disabled={
                                        !hasChanges || saving || checkingUsername || !!usernameError
                                    }
                                    variant="primary"
                                >
                                    {saving ? 'Saving...' : 'Save Changes'}
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Alt Accounts — only visible on the main profile */}
                    {!isOnAlt && <AltAccountsSection />}

                    {/* App Preferences */}
                    <div className="card space-y-4">
                        <h2 className="text-xl font-semibold">App Preferences</h2>
                        <Checkbox
                            label="Show import summary after importing"
                            checked={showImportSummary}
                            onChange={(checked) => {
                                setShowImportSummary(checked);
                                localStorage.setItem(
                                    StorageKey.SHOW_IMPORT_SUMMARY,
                                    String(checked)
                                );
                            }}
                            helpLabel="When enabled, a summary of what changed is shown after each import."
                        />
                    </div>

                    {/* Statistics */}
                    {stats && (
                        <div>
                            <h2 className="text-xl font-semibold mb-4">Statistics</h2>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                <StatCard title="Ships" value={stats.shipCount} />
                                <StatCard title="Gear Pieces" value={stats.gearCount} />
                                <StatCard title="Implants" value={stats.implantCount} />
                                <StatCard
                                    title="Engineering Points"
                                    value={stats.engineeringPoints.toLocaleString()}
                                />
                                <StatCard
                                    title="Tokens Spent"
                                    value={stats.engineeringTokens.toLocaleString()}
                                />
                            </div>
                        </div>
                    )}

                    {/* Usage Statistics */}
                    {usageStats && (
                        <div>
                            <h2 className="text-xl font-semibold mb-4">Usage Statistics</h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <StatCard
                                    title="Autogear Runs"
                                    value={usageStats.total_autogear_runs.toLocaleString()}
                                    color="blue"
                                />
                                <StatCard
                                    title="Data Imports"
                                    value={usageStats.total_data_imports.toLocaleString()}
                                    color="green"
                                />
                                <StatCard
                                    title="Total Activity"
                                    value={usageStats.total_activity.toLocaleString()}
                                    color="yellow"
                                />
                            </div>
                        </div>
                    )}

                    {/* Engineering Leaderboards */}
                    <div className="card">
                        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                            <TrophyIcon className="w-6 h-6" />
                            Engineering Leaderboards
                        </h2>
                        <EngineeringLeaderboards />
                    </div>

                    {/* Top Ship Rankings */}
                    <div className="card">
                        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                            <TrophyIcon className="w-6 h-6" />
                            Top Ship Rankings
                        </h2>
                        {shipsLoading ? (
                            <div className="relative min-h-[200px]">
                                <Loader size="sm" />
                            </div>
                        ) : topShips.length > 0 ? (
                            <div className="space-y-2">
                                {topShips.map((ship, index) => (
                                    <div
                                        key={`${ship.shipName}-${index}`}
                                        className="flex justify-between items-center p-3 border border-dark-border"
                                    >
                                        <div>
                                            <div className="font-semibold">{ship.shipName}</div>
                                            <div className="text-sm text-theme-text-secondary">
                                                {ship.shipType}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="font-bold">Rank #{ship.rank}</div>
                                            <div className="text-xs text-theme-text-secondary">
                                                out of {ship.totalEntries}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-8 text-theme-text-secondary">
                                No ship rankings available
                            </div>
                        )}
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default ProfilePage;
