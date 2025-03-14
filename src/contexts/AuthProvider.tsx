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
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setUser(user);
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const signInWithGoogle = async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
            addNotification('success', 'Logged in successfully');
        } catch (error) {
            console.error('Google sign in failed:', error);
            addNotification('error', 'Failed to log in with Google');
        }
    };

    const signInWithEmail = async (email: string, password: string) => {
        try {
            await signInWithEmailAndPassword(auth, email, password);
            addNotification('success', 'Logged in successfully');
        } catch (error) {
            console.error('Email sign in failed:', error);
            addNotification('error', 'Failed to log in');
        }
    };

    const signUpWithEmail = async (email: string, password: string) => {
        try {
            await createUserWithEmailAndPassword(auth, email, password);
            addNotification('success', 'Account created successfully');
        } catch (error) {
            console.error('Email sign up failed:', error);
            addNotification('error', 'Failed to create account');
        }
    };

    const signOut = async () => {
        try {
            // Clear all storage keys
            Object.values(STORAGE_KEYS).forEach((key) => {
                console.log('Clearing storage key:', key);
                localStorage.removeItem(key);
            });

            // Sign out from Firebase
            await firebaseSignOut(auth);
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
