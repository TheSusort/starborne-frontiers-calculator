import { randomUUID, randomBytes } from 'node:crypto';

export interface TestCredentials {
    email: string;
    password: string;
}

export function generateTestCredentials(prefix: string, domain: string): TestCredentials {
    const email = `${prefix}${randomUUID()}@${domain}`;
    const password = randomBytes(16).toString('base64url'); // ~22 chars
    return { email, password };
}
