import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { AuthService, AuthUser } from '../services/auth/types';
import { FirebaseAuthService } from '../services/auth/firebaseAuth';
import { SupabaseAuthService } from '../services/auth/supabaseAuth';
import { useNotification } from '../hooks/useNotification';
import { supabase } from '../config/supabase';
import { migratePlayerData, syncMigratedDataToSupabase } from '../utils/migratePlayerData';

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
    const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
    const { addNotification } = useNotification();

    useEffect(() => {
        const migrateDataForNewUser = async () => {
            try {
                // Dispatch migration start event
                window.dispatchEvent(new Event('app:migration:start'));

                const migrationResult = migratePlayerData();
                if (user?.id) {
                    await syncMigratedDataToSupabase(user.id, migrationResult);
                }

                // Dispatch migration end event
                window.dispatchEvent(new Event('app:migration:end'));
            } catch (error) {
                console.error('Error migrating data for new user:', error);
                addNotification('error', 'Failed to migrate data');
                // Still dispatch end event even on error
                window.dispatchEvent(new Event('app:migration:end'));
            }
        };

        const unsubscribe = authService.onAuthStateChanged(async (user) => {
            const previousUser = currentUser;
            setUser(user);
            setCurrentUser(user);
            setLoading(false);

            if (user) {
                // Check if this is a new user
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('created_at')
                    .eq('id', user.id)
                    .single();

                if (userError && userError.code === 'PGRST116') {
                    // User doesn't exist in the database yet - this is a new user
                    await migrateDataForNewUser();
                } else if (userData) {
                    // User exists, check if they need migration
                    const userCreatedAt = new Date(userData.created_at);
                    const now = new Date();
                    const isNewUser = now.getTime() - userCreatedAt.getTime() < 5000; // 5 second window

                    if (isNewUser) {
                        await migrateDataForNewUser();
                    }
                }
            } else if (previousUser) {
                // Only dispatch signout event if we had a previous user
                // This prevents wiping data during the transition from unauthenticated to authenticated
                window.dispatchEvent(new Event('app:signout'));
            }
        });

        return () => {
            unsubscribe();
        };
    }, [user?.id, addNotification]);

    const signInWithGoogle = async () => {
        try {
            await authService.signInWithGoogle();

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
