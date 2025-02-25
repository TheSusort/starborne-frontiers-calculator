import { adminDb } from '../../config/firebase-admin';
import { SHIPS } from '../../constants/ships';
import { QueryDocumentSnapshot } from 'firebase-admin/firestore';

export const migrateShipsToFirebase = async () => {
    try {
        // Clear existing ships first
        const existingShips = await adminDb.collection('ships').get();
        const deletePromises = existingShips.docs.map((doc: QueryDocumentSnapshot) =>
            doc.ref.delete()
        );
        await Promise.all(deletePromises);

        // Create batches (Firestore has a limit of 500 operations per batch)
        const batchSize = 450;
        const entries = Object.entries(SHIPS);
        const batches = [];

        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = adminDb.batch();
            const batchEntries = entries.slice(i, i + batchSize);

            batchEntries.forEach(([id, shipData]) => {
                const shipRef = adminDb.collection('ships').doc(id);
                batch.set(shipRef, {
                    ...shipData,
                    id,
                    updatedAt: new Date().toISOString(),
                });
            });

            batches.push(batch.commit());
        }

        await Promise.all(batches);
        // eslint-disable-next-line no-console
        console.log(`Successfully migrated ${entries.length} ships to Firebase`);
    } catch (error) {
        console.error('Error during migration:', error);
        throw error;
    }
};
