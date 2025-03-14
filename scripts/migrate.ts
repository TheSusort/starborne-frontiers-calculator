import { migrateUserData } from '../src/migrations/dataStructureMigration';

const USER_ID = '9P9g2CnrsIT7ZB1qQpVJlWEWmwA3';

migrateUserData(USER_ID)
    .then((result) => {
        console.log('\nMigration Summary:');
        console.log('==================');
        console.log(`Status: ${result.success ? 'Success' : 'Failed'}`);
        if (!result.success) {
            console.log(`Error: ${result.error}`);
            process.exit(1);
        }
        console.log('Migration completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    });
