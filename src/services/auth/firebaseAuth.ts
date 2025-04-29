import { AuthService, AuthUser } from './types';
import { auth } from '../../config/firebase';
import {
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    User as FirebaseUser,
} from 'firebase/auth';

export class FirebaseAuthService implements AuthService {
    private convertFirebaseUser(user: FirebaseUser | null): AuthUser | null {
        if (!user) return null;

        return {
            id: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
        };
    }

    async getCurrentUser(): Promise<AuthUser | null> {
        return this.convertFirebaseUser(auth.currentUser);
    }

    async signInWithGoogle(): Promise<void> {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    }

    async signInWithEmail(email: string, password: string): Promise<void> {
        await signInWithEmailAndPassword(auth, email, password);
    }

    async signUpWithEmail(email: string, password: string): Promise<void> {
        await createUserWithEmailAndPassword(auth, email, password);
    }

    async signOut(): Promise<void> {
        await signOut(auth);
    }

    onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
        return onAuthStateChanged(auth, (user) => {
            callback(this.convertFirebaseUser(user));
        });
    }
}
