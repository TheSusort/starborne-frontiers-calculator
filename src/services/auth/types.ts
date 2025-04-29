export interface AuthUser {
    id: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
}

export interface AuthService {
    getCurrentUser: () => Promise<AuthUser | null>;
    signInWithGoogle: () => Promise<void>;
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    onAuthStateChanged: (callback: (user: AuthUser | null) => void) => () => void;
}
