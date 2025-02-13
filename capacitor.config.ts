import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.susort.starborneplanner',
    appName: 'Starborne Planner',
    webDir: 'dist',
    plugins: {
        FirebaseAuthentication: {
            skipNativeAuth: false,
            providers: ['google.com', 'password'],
            permissions: {
                google: ['profile', 'email'],
            },
        },
    },
    server: {
        androidScheme: 'https',
    },
};

export default config;
