import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { AuthService, AuthUser } from '../services/auth/types';
import { FirebaseAuthService } from '../services/auth/firebaseAuth';
import { SupabaseAuthService } from '../services/auth/supabaseAuth';
import { useNotification } from '../hooks/useNotification';
import { StorageKey } from '../constants/storage';
import { useStorage } from '../hooks/useStorage';

interface AuthContextType {
    user: AuthUser | null;
    loading: boolean;
    signInWithGoogle: () => Promise<void>;
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Choose which auth service to use
const authService: AuthService =
    import.meta.env.VITE_USE_SUPABASE === 'true'
        ? new SupabaseAuthService()
        : new FirebaseAuthService();

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);
    const { addNotification } = useNotification();
    const [isNewUser, setIsNewUser] = useState(false);
    const [migrationCompleted, setMigrationCompleted] = useState(false);
    const isMigratingRef = useRef(false);
    const previousUserIdRef = useRef<string | null>(null);

    // Initialize storage hooks
    const { setData: setLoadouts } = useStorage({
        key: StorageKey.LOADOUTS,
        defaultValue: [],
    });
    const { setData: setTeamLoadouts } = useStorage({
        key: StorageKey.TEAM_LOADOUTS,
        defaultValue: [],
    });
    const { setData: setShips } = useStorage({
        key: StorageKey.SHIPS,
        defaultValue: [],
    });
    const { setData: setInventory } = useStorage({
        key: StorageKey.INVENTORY,
        defaultValue: [],
    });
    const { setData: setEncounters } = useStorage({
        key: StorageKey.ENCOUNTERS,
        defaultValue: [],
    });
    const { setData: setEngineeringStats } = useStorage({
        key: StorageKey.ENGINEERING_STATS,
        defaultValue: {},
    });

    useEffect(() => {
        // Get initial user
        authService.getCurrentUser().then((user) => {
            setUser(user);
            setLoading(false);
        });

        // Listen for auth changes
        const unsubscribe = authService.onAuthStateChanged((user) => {
            setUser(user);
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Effect to handle migration of local data to Supabase when a new user signs up
    useEffect(() => {
        // Prevent running this effect if migration is already completed for this user
        if (migrationCompleted && user?.id === previousUserIdRef.current) {
            return;
        }

        let isMounted = true;
        const migrateDataForNewUser = async () => {
            // Prevent concurrent migrations and infinite loops
            if (
                isNewUser &&
                user?.id &&
                !isMigratingRef.current &&
                user.id !== previousUserIdRef.current
            ) {
                try {
                    // Set the ref to prevent concurrent migrations
                    isMigratingRef.current = true;

                    addNotification('info', 'Migrating your local data to the cloud...');

                    // Dynamically import to avoid circular dependencies
                    const { migrateLegacyData, syncMigratedDataToSupabase } = await import(
                        '../utils/migrateLegacyData'
                    );

                    // Step 1: Migrate legacy IDs to UUIDs
                    const migratedData = migrateLegacyData();

                    // Step 2: Sync migrated data to Supabase
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    let result: { success: boolean; error?: any } = { success: false };
                    let retryCount = 0;
                    const maxRetries = 3;

                    // Attempt migration with retries for partial failures
                    while (retryCount < maxRetries) {
                        try {
                            result = await syncMigratedDataToSupabase(user.id, migratedData);
                            break; // Exit retry loop if successful
                        } catch (syncError) {
                            console.error(`Migration attempt ${retryCount + 1} failed:`, syncError);
                            retryCount++;

                            if (retryCount < maxRetries) {
                                // Add a delay between retries
                                await new Promise((r) => setTimeout(r, 1000 * retryCount));
                                if (isMounted) {
                                    addNotification(
                                        'info',
                                        `Retrying migration (attempt ${retryCount + 1})...`
                                    );
                                }
                            } else {
                                // Reached max retries
                                result = { success: false, error: syncError };
                            }
                        }
                    }

                    if (result.success) {
                        addNotification(
                            'success',
                            'Your data has been successfully migrated to the cloud!'
                        );
                    } else {
                        addNotification('error', 'There was an issue migrating some of your data.');
                        console.error('Migration error:', result.error);
                    }
                } catch (error) {
                    console.error('Error during data migration:', error);
                    addNotification(
                        'error',
                        'Failed to migrate local data. Your local data is still available.'
                    );
                } finally {
                    // Only update state if component is still mounted
                    if (isMounted) {
                        previousUserIdRef.current = user.id;
                        setIsNewUser(false);
                        setMigrationCompleted(true);
                        isMigratingRef.current = false;
                    }
                }
            }
        };

        migrateDataForNewUser();

        // Clean up function
        return () => {
            isMounted = false;
        };
    }, [isNewUser, user, addNotification, migrationCompleted]);

    const signInWithGoogle = async () => {
        try {
            // Track if this is a new user sign-up
            const currentUser = await authService.getCurrentUser();
            const wasSignedIn = !!currentUser;

            await authService.signInWithGoogle();

            // If the user wasn't signed in before but is now, it's a new sign-up
            const newUser = await authService.getCurrentUser();
            if (!wasSignedIn && newUser && newUser.id !== previousUserIdRef.current) {
                // Reset migration state for new sign-in
                setMigrationCompleted(false);
                // Set the flag to trigger data migration
                setIsNewUser(true);
            }

            addNotification('success', 'Logging in with Google');
        } catch (error) {
            console.error('Google sign in error:', error);
            addNotification('error', 'Google sign in failed');
            throw error;
        }
    };

    const signInWithEmail = async (email: string, password: string) => {
        try {
            await authService.signInWithEmail(email, password);
            addNotification('success', 'Logged in successfully');
        } catch (error) {
            console.error('Sign in error:', error);
            addNotification('error', 'Sign in failed');
            throw error;
        }
    };

    const signUpWithEmail = async (email: string, password: string) => {
        try {
            await authService.signUpWithEmail(email, password);
            // Reset migration state for new sign-up
            setMigrationCompleted(false);
            // Set the new user flag to trigger data migration
            setIsNewUser(true);
            addNotification('success', 'Account created successfully');
        } catch (error) {
            console.error('Sign up error:', error);
            addNotification('error', 'Sign up failed');
            throw error;
        }
    };

    const signOut = async () => {
        try {
            await authService.signOut();
            // Dispatch a custom event that other providers can listen to
            window.dispatchEvent(new CustomEvent('app:signout'));
            addNotification('success', 'Logged out successfully');
        } catch (error) {
            console.error('Sign out error:', error);
            addNotification('error', 'Sign out failed');
            throw error;
        }
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                signInWithGoogle,
                signInWithEmail,
                signUpWithEmail,
                signOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
