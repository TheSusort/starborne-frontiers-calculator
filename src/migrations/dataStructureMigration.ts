import { adminDb } from '../config/firebase-admin';
import { COLLECTIONS } from '../services/firebaseStorage';
import type { UserData } from '../types/user';

// This should match the flag in firebaseStorage.ts
const USE_DEV_COLLECTION = true;
const USERS_COLLECTION = USE_DEV_COLLECTION ? 'users_dev' : 'users';

export const migrateUserData = async (userId: string, isDev = false) => {
    try {
        console.log(`Starting migration for user ${userId} (${isDev ? 'dev' : 'prod'})`);
        const batch = adminDb.batch();
        const timestamp = Date.now();

        // Get existing data from production collection
        const userDoc = adminDb.collection('users').doc(userId);
        const userSnapshot = await userDoc.get();

        if (!userSnapshot.exists) {
            console.log(`No data found for user ${userId}`);
            return { success: true, message: 'No data to migrate' };
        }

        const userData = userSnapshot.data() as UserData;
        console.log(`Found data for user ${userId}:`, Object.keys(userData));

        // Create subcollections in target collection
        const collections = [
            { name: COLLECTIONS.INVENTORY, data: userData['gear-inventory'] || [] },
            { name: COLLECTIONS.LOADOUTS, data: userData.shipLoadouts || [] },
            { name: COLLECTIONS.SHIPS, data: userData.ships || [] },
            { name: COLLECTIONS.ENCOUNTER_NOTES, data: userData.encounterNotes || [] },
            { name: COLLECTIONS.TEAM_LOADOUTS, data: userData.teamLoadouts || [] },
        ];

        // Save metadata fields directly on the user document
        const targetUserDoc = adminDb.collection(USERS_COLLECTION).doc(userId);
        batch.set(targetUserDoc, {
            version: 2,
            lastUpdated: new Date().toISOString(),
            migrationDate: new Date().toISOString(),
            engineeringStats: userData.engineeringStats,
            changelogState: userData.changelogState,
            lastSync: timestamp,
        });

        // Save each collection
        for (const { name, data } of collections) {
            if (!Array.isArray(data)) {
                console.log(`Skipping ${name} - not an array:`, data);
                continue;
            }

            console.log(`Migrating ${data.length} items to ${name}`);
            const collectionRef = adminDb.collection(USERS_COLLECTION).doc(userId).collection(name);

            data.forEach((item, index) => {
                const docRef = collectionRef.doc(item.id || `${index}`);
                batch.set(docRef, {
                    ...item,
                    timestamp,
                    id: item.id || `${index}`,
                });
            });
        }

        // Commit the batch
        await batch.commit();
        console.log(`Successfully migrated data for user ${userId}`);

        return { success: true };
    } catch (error) {
        console.error(`Failed to migrate user ${userId}:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
};
