import { migrateShipsToSupabase } from '../src/utils/dataUpdate/migrateShipsToSupabase';

migrateShipsToSupabase()
    .then(() => {
        console.log('Migration completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exit(1);
    });
