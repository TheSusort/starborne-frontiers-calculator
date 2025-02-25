import { initializeApp, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env') });

const serviceAccount: ServiceAccount = {
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    privateKey: process.env.VITE_FIREBASE_PRIVATE_KEY,
    clientEmail: process.env.VITE_FIREBASE_CLIENT_EMAIL /*
    clientId: process.env.VITE_FIREBASE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: process.env.VITE_FIREBASE_CLIENT_CERT_URL,
    universe_domain: 'googleapis.com',*/,
};

const app = initializeApp({
    credential: cert(serviceAccount),
});

export const adminDb = getFirestore(app);
