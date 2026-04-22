import { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../../config/supabase';
import { AuthService, AuthUser } from './types';

export class SupabaseAuthService implements AuthService {
    private convertSupabaseUser(user: SupabaseUser | null): AuthUser | null {
        if (!user) return null;

        return {
            id: user.id,
            email: user.email ?? null,
            displayName: user.user_metadata?.full_name ?? null,
            photoURL: user.user_metadata?.avatar_url ?? null,
        };
    }

    async getCurrentUser(): Promise<AuthUser | null> {
        const {
            data: { user },
        } = await supabase.auth.getUser();
        return this.convertSupabaseUser(user);
    }

    async signInWithGoogle(): Promise<void> {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin,
            },
        });
        if (error) throw error;
    }

    async signInWithEmail(email: string, password: string): Promise<void> {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw error;
    }

    async signUpWithEmail(email: string, password: string): Promise<void> {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });
        if (error) throw error;
        // Supabase returns success with an empty identities array when the email
        // is already registered (to prevent email enumeration). Translate that
        // into a real error so the UI can tell the user what's going on.
        if (data.user && data.user.identities && data.user.identities.length === 0) {
            throw new Error('An account with this email already exists. Try signing in instead.');
        }
    }

    async signOut(): Promise<void> {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    }

    onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            callback(this.convertSupabaseUser(session?.user ?? null));
        });
        return () => subscription.unsubscribe();
    }
}
