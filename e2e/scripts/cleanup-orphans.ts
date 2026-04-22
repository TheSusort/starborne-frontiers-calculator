import 'dotenv/config';
import { listOrphanTestUsers, deleteTestUser } from '../helpers/supabaseAdmin';

async function main() {
    const prefix = process.env.E2E_TEST_EMAIL_PREFIX;
    const domain = process.env.E2E_TEST_EMAIL_DOMAIN;
    if (!prefix) throw new Error('E2E_TEST_EMAIL_PREFIX is required');
    if (!domain) throw new Error('E2E_TEST_EMAIL_DOMAIN is required');

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphans = await listOrphanTestUsers(prefix, domain, cutoff);

    console.log(`Found ${orphans.length} orphan test user(s) older than 24h`);

    let deleted = 0;
    for (const { email } of orphans) {
        try {
            await deleteTestUser(email, prefix, domain);
            deleted++;
            console.log(`  deleted ${email}`);
        } catch (err) {
            console.error(`  FAILED ${email}:`, err);
        }
    }
    console.log(`Deleted ${deleted}/${orphans.length}`);

    if (deleted < orphans.length) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
