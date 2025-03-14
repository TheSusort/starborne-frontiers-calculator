import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { migrateUserData } from './dataStructureMigration';

export const runMigrationForAllUsers = async (specificUserId?: string) => {
    try {
        if (specificUserId) {
            console.log(`Starting migration for specific user ${specificUserId}...`);
            const result = await migrateUserData(specificUserId);

            console.log('\nMigration Summary:');
            console.log('==================');
            console.log(`Status: ${result.success ? 'Success' : 'Failed'}`);
            if (!result.success) {
                console.log(`Error: ${result.error}`);
            }

            return {
                total: 1,
                successful: result.success ? 1 : 0,
                failed: result.success ? 0 : 1,
                results: [{ userId: specificUserId, ...result }],
            };
        }

        console.log('Starting migration for all users...');
        const usersRef = collection(db, 'users');
        const snapshot = await getDocs(usersRef);

        const results = [];
        for (const doc of snapshot.docs) {
            console.log(`Migrating user ${doc.id}...`);
            const result = await migrateUserData(doc.id);
            results.push({ userId: doc.id, ...result });
        }

        // Log summary
        const successful = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        console.log('Migration complete:');
        console.log(`- Total users: ${results.length}`);
        console.log(`- Successful: ${successful}`);
        console.log(`- Failed: ${failed}`);

        if (failed > 0) {
            console.log('Failed migrations:');
            results
                .filter((r) => !r.success)
                .forEach((r) => console.log(`- User ${r.userId}: ${r.error}`));
        }

        return {
            total: results.length,
            successful,
            failed,
            results,
        };
    } catch (error) {
        console.error('Migration runner failed:', error);
        throw error;
    }
};
