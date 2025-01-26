import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { Ship } from '../types/ship';
import { GearPiece } from '../types/gear';
import { EncounterNote } from '../types/encounters';
import { TeamLoadout } from '../types/loadout';
import { EngineeringStats } from '../types/stats';
import { Loadout } from '../types/loadout';
import { ChangelogState } from '../types/changelog';
import { FilterState } from '../hooks/usePersistedFilters';
export interface UserData {
    ships: Ship[];
    inventory: GearPiece[];
    encounterNotes: EncounterNote[];
    engineeringStats: EngineeringStats;
    loadouts: Loadout[];
    teamLoadouts: TeamLoadout[];
    filters: Record<string, FilterState>;
    changelogState: ChangelogState;
}

export const firebaseStorage = {
    async saveUserData(userId: string, data: Partial<UserData>) {
        try {
            const userDoc = doc(db, 'users', userId);
            await setDoc(userDoc, data, { merge: true });
        } catch (error) {
            console.error('Error saving to Firebase:', error);
            throw error;
        }
    },

    async getUserData(userId: string): Promise<Partial<UserData> | null> {
        try {
            const userDoc = doc(db, 'users', userId);
            const docSnap = await getDoc(userDoc);
            return docSnap.exists() ? (docSnap.data() as UserData) : null;
        } catch (error) {
            console.error('Error getting data from Firebase:', error);
            throw error;
        }
    },
};
