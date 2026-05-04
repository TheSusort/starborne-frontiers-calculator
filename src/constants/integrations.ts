export type IntegrationStatus = 'deprecated' | 'coming-soon' | 'available' | 'connected';

export interface Integration {
    id: string;
    name: string;
    description: string;
    status: IntegrationStatus;
}

export const INTEGRATIONS: Integration[] = [
    {
        id: 'cubedweb',
        name: 'Cubedweb Hangar',
        description: 'Shared hangar viewing — a new system is in development.',
        status: 'deprecated',
    },
    {
        id: 'sf-api',
        name: 'Starborne Frontiers API',
        description: 'Official game API access.',
        status: 'coming-soon',
    },
];
