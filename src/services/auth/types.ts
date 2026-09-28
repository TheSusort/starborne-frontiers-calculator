export interface AuthUser {
    id: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    isAdmin?: boolean;
}

export interface AuthService {
    getCurrentUser: () => Promise<AuthUser | null>;
    /** `redirectTo` is where Google sign-in returns; defaults to the site root. */
    signInWithGoogle: (redirectTo?: string) => Promise<void>;
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    onAuthStateChanged: (callback: (user: AuthUser | null) => void) => () => void;
}
