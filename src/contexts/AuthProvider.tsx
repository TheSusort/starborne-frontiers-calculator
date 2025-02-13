import React, { createContext, useContext, useEffect, useState } from 'react';
import {
    User,
    signInWithPopup,
    GoogleAuthProvider,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from '../config/firebase';
import { useNotification } from '../hooks/useNotification';
import { STORAGE_KEYS } from '../constants/storage';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { Capacitor } from '@capacitor/core';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    signInWithGoogle: () => Promise<void>;
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const { addNotification } = useNotification();

    useEffect(() => {
        const setupAuth = async () => {
            if (Capacitor.isNativePlatform()) {
                // Setup native auth state listener
                const unsubscribe = await FirebaseAuthentication.addListener(
                    'authStateChange',
                    async (change) => {
                        setUser(change.user ? (change.user as unknown as User) : null);
                        setLoading(false);
                    }
                );

                // Get initial auth state
                const result = await FirebaseAuthentication.getCurrentUser();
                setUser(result.user ? (result.user as unknown as User) : null);
                setLoading(false);

                return () => {
                    unsubscribe.remove();
                };
            } else {
                // Web platform - use existing Firebase auth
                const unsubscribe = onAuthStateChanged(auth, (user) => {
                    setUser(user);
                    setLoading(false);
                });

                return unsubscribe;
            }
        };

        setupAuth();
    }, []);

    const signInWithGoogle = async () => {
        try {
            if (Capacitor.isNativePlatform()) {
                // Native platform
                await FirebaseAuthentication.signInWithGoogle();
            } else {
                // Web platform
                const provider = new GoogleAuthProvider();
                await signInWithPopup(auth, provider);
            }
        } catch (error) {
            console.error('Error signing in with Google:', error);
            throw error;
        }
    };

    const signInWithEmail = async (email: string, password: string) => {
        try {
            if (Capacitor.isNativePlatform()) {
                await FirebaseAuthentication.signInWithEmailAndPassword({ email, password });
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
        } catch (error) {
            console.error('Error signing in with email:', error);
            throw error;
        }
    };

    const signUpWithEmail = async (email: string, password: string) => {
        try {
            if (Capacitor.isNativePlatform()) {
                await FirebaseAuthentication.createUserWithEmailAndPassword({ email, password });
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
            }
        } catch (error) {
            console.error('Error signing up with email:', error);
            throw error;
        }
    };

    const signOut = async () => {
        try {
            if (Capacitor.isNativePlatform()) {
                await FirebaseAuthentication.signOut();
            } else {
                await firebaseSignOut(auth);
            }
            // Clear all local storage data
            Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
            addNotification('success', 'Logged out successfully');
        } catch (error) {
            console.error('Logout failed:', error);
            addNotification('error', 'Failed to log out');
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
