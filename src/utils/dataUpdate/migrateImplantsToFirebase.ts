import { adminDb } from '../../config/firebase-admin';
import { IMPLANTS } from '../../constants/implants';
import { QueryDocumentSnapshot } from 'firebase-admin/firestore';

export const migrateImplantsToFirebase = async () => {
    try {
        // Clear existing implants first
        const existingImplants = await adminDb.collection('implants').get();
        const deletePromises = existingImplants.docs.map((doc: QueryDocumentSnapshot) =>
            doc.ref.delete()
        );
        await Promise.all(deletePromises);

        // Create batches (Firestore has a limit of 500 operations per batch)
        const batchSize = 450;
        const entries = Object.entries(IMPLANTS);
        const batches = [];

        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = adminDb.batch();
            const batchEntries = entries.slice(i, i + batchSize);

            batchEntries.forEach(([id, implantData]) => {
                const implantRef = adminDb.collection('implants').doc(id);
                batch.set(implantRef, {
                    ...implantData,
                    id,
                    updatedAt: new Date().toISOString(),
                });
            });

            batches.push(batch.commit());
        }

        await Promise.all(batches);
        // eslint-disable-next-line no-console
        console.log(`Successfully migrated ${entries.length} implants to Firebase`);
    } catch (error) {
        console.error('Error during migration:', error);
        throw error;
    }
};
