// Epic ships with videos (legendary ships all have videos)
export const EPIC_VIDEOS = new Set<string>([
    'Atlas_15',
    'XAOC_16',
    'Marauder_14',
    'Marauder_5',
    'Marauder_9',
    'MPL_10',
    'Binderburg_8',
    'Everliving_4',
    'Everliving_11',
    'Tianchao_5',
    'Gelecek_14',
    'Legion_14',
]);

export function hasShipVideo(rarity: string, imageKey?: string): boolean {
    return rarity === 'legendary' || (rarity === 'epic' && !!imageKey && EPIC_VIDEOS.has(imageKey));
}
