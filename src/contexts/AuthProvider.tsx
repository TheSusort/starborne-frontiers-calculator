import React, { createContext, useContext, useEffect, useState } from 'react';
import { AuthService, AuthUser } from '../services/auth/types';
import { FirebaseAuthService } from '../services/auth/firebaseAuth';
import { SupabaseAuthService } from '../services/auth/supabaseAuth';
import { useNotification } from '../hooks/useNotification';

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

    const signInWithGoogle = async () => {
        try {
            await authService.signInWithGoogle();
            addNotification('success', 'Logged in with Google successfully');
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
