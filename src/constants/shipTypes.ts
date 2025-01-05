import { ShipType } from '../types/ship';

export const SHIP_TYPES: Record<string, ShipType> = {
    ATTACKER: {
        name: 'Attacker',
        description: 'Maximize damage output',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314151596142662.webp',
    },
    DEFENDER: {
        name: 'Defender',
        description: 'Maximize HP and defense',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314174920663053.webp',
    },
    DEBUFFER: {
        name: 'Debuffer',
        description: 'Maximize damage output while having 270 hacking or more',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314199100829787.webp',
    },
    SUPPORTER: {
        name: 'Supporter',
        description: 'Maximize healing output',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314233301188750.webp',
    },
    SUPPORTER_BUFFER: {
        name: 'Supporter(Buffer)',
        description: 'Max speed, then HP/defense, big bonus if boost set',
        iconUrl: 'https://cdn.discordapp.com/emojis/1082314233301188750.webp',
    },
} satisfies Record<string, ShipType>;

export type ShipTypeName = keyof typeof SHIP_TYPES;
