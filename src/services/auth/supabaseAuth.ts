import { AuthService, AuthUser } from './types';
import { supabase } from '../../config/supabase';
import { User as SupabaseUser } from '@supabase/supabase-js';

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
        const { error } = await supabase.auth.signUp({
            email,
            password,
        });
        if (error) throw error;
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
