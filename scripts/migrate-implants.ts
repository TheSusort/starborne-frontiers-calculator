import { migrateImplantsToFirebase } from '../src/utils/dataUpdate/migrateImplantsToFirebase';

migrateImplantsToFirebase()
    .then(() => {
        console.log('Migration completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    });
