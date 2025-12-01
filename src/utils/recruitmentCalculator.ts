import { Ship } from '../types/ship';
import { RarityName } from '../constants/rarities';

// Ships that cannot be recruited through beacons
const NON_RECRUITABLE_SHIPS = ['Wusheng', 'Lionheart', 'Oleander', 'Nyxen', 'Asphodel', 'Lev'];

export type BeaconType = 'public' | 'specialist' | 'expert' | 'elite';

export interface BeaconRates {
    common: number;
    uncommon: number;
    rare: number;
    epic: number;
    legendary: number;
}

export interface RecruitmentResult {
    beaconType: BeaconType;
    probability: number;
    expectedPulls: number;
    pullsFor90Percent: number;
    pullsFor99Percent: number;
}

/**
 * Get the base rates for each beacon type
 */
export const getBeaconRates = (beaconType: BeaconType): BeaconRates => {
    switch (beaconType) {
        case 'public':
            return {
                common: 0.6,
                uncommon: 0.38,
                rare: 0.02,
                epic: 0,
                legendary: 0,
            };
        case 'specialist': {
            // Legendary rate is 1/66 ≈ 0.01515
            const legendaryRate = 1 / 66;
            // Remaining probability after legendary: 1 - legendaryRate
            // Rare: 89% of remaining, Epic: 10% of remaining
            const remainingRate = 1 - legendaryRate;
            return {
                common: 0,
                uncommon: 0,
                rare: 0.89 * remainingRate,
                epic: 0.1 * remainingRate,
                legendary: legendaryRate,
            };
        }
        case 'expert':
            return {
                common: 0,
                uncommon: 0,
                rare: 0,
                epic: 0.9,
                legendary: 0.1,
            };
        case 'elite':
            return {
                common: 0,
                uncommon: 0,
                rare: 0,
                epic: 0,
                legendary: 1.0,
            };
        default:
            return {
                common: 0,
                uncommon: 0,
                rare: 0,
                epic: 0,
                legendary: 0,
            };
    }
};

/**
 * Filter out non-recruitable ships
 */
export const getRecruitableShips = (ships: Ship[]): Ship[] => {
    return ships.filter((ship) => !NON_RECRUITABLE_SHIPS.includes(ship.name));
};

/**
 * Get ships by rarity from recruitable ships
 */
export const getShipsByRarity = (ships: Ship[], rarity: RarityName): Ship[] => {
    const recruitable = getRecruitableShips(ships);
    return recruitable.filter((ship) => ship.rarity === rarity);
};

/**
 * Group ships by rarity for display
 */
export const groupShipsByRarity = (ships: Ship[]): Record<string, Ship[]> => {
    const grouped: Record<string, Ship[]> = {};
    ships.forEach((ship) => {
        if (!grouped[ship.rarity]) {
            grouped[ship.rarity] = [];
        }
        grouped[ship.rarity].push(ship);
    });
    return grouped;
};

/**
 * Get human-readable label for beacon type
 */
export const getBeaconLabel = (beaconType: BeaconType): string => {
    switch (beaconType) {
        case 'public':
            return 'Public Beacon';
        case 'specialist':
            return 'Specialist Beacon';
        case 'expert':
            return 'Expert Beacon';
        case 'elite':
            return 'Elite Beacon';
        default:
            return beaconType;
    }
};

/**
 * Get description of beacon type rates
 */
export const getBeaconDescription = (beaconType: BeaconType): string => {
    switch (beaconType) {
        case 'public':
            return '60% Common, 38% Uncommon, 2% Rare';
        case 'specialist':
            return '~89% Rare, ~10% Epic, ~1.52% Legendary (1/66 chance)';
        case 'expert':
            return '90% Epic, 10% Legendary';
        case 'elite':
            return '100% Legendary';
        default:
            return '';
    }
};

/**
 * Get the rarity for a beacon type (for styling purposes)
 */
export const getBeaconRarity = (beaconType: BeaconType): RarityName => {
    switch (beaconType) {
        case 'public':
            return 'uncommon';
        case 'specialist':
            return 'rare';
        case 'expert':
            return 'epic';
        case 'elite':
            return 'legendary';
    }
};

export interface EventShip {
    name: string;
    rate?: number; // 0-1 decimal (optional, mutually exclusive with threshold)
    threshold?: number; // Number of pulls needed for guarantee (optional, mutually exclusive with rate)
}

/**
 * Calculate the probability of getting a specific ship from a beacon
 * @param ship - The target ship
 * @param beaconType - Type of beacon
 * @param ships - All available ships
 * @param eventShips - Optional array of event ships with their rates (for specialist beacons)
 */
export const calculateShipProbability = (
    ship: Ship,
    beaconType: BeaconType,
    ships: Ship[],
    eventShips: EventShip[] = []
): number => {
    const recruitableShips = getRecruitableShips(ships);
    const rates = getBeaconRates(beaconType);

    // Get the base rate for the ship's rarity
    const rarityRate = rates[ship.rarity as keyof BeaconRates];

    // If rarity rate is 0, ship cannot be obtained from this beacon
    if (rarityRate === 0) {
        return 0;
    }

    // Count ships of the same rarity
    const shipsOfRarity = getShipsByRarity(recruitableShips, ship.rarity);
    const totalShipsOfRarity = shipsOfRarity.length;

    if (totalShipsOfRarity === 0) {
        return 0;
    }

    // Handle event ship logic for specialist beacons (epic and legendary ships)
    if (beaconType === 'specialist' && eventShips.length > 0) {
        // Check if this specific ship is an event ship
        const eventShipForThisShip = eventShips.find((es) => es.name === ship.name);

        if (eventShipForThisShip) {
            // If it has a threshold (guaranteed), it still has a probability before the threshold
            // For guaranteed ships, we still calculate the base probability
            if (eventShipForThisShip.rate !== undefined) {
                // This is an event ship with rate: probability = rarity rate * event ship rate
                return rarityRate * eventShipForThisShip.rate;
            }
            // If it's guaranteed (has threshold), we still need to calculate the probability
            // before the threshold for expected pulls calculation
            // For now, use base probability
        }

        // This is not an event ship, or it's a guaranteed ship (no rate), but there might be event ships of the same rarity
        const eventShipsOfThisRarity = eventShips.filter((es) => {
            const eventShip = recruitableShips.find((s) => s.name === es.name);
            return eventShip && eventShip.rarity === ship.rarity && es.rate !== undefined;
        });

        if (eventShipsOfThisRarity.length > 0) {
            // Calculate total event rate for this rarity (only ships with rate, not threshold)
            const totalEventRate = eventShipsOfThisRarity.reduce(
                (sum, es) => sum + (es.rate || 0),
                0
            );

            // Non-event ships of this rarity: probability = rarity rate * (1 - total event rate) / (number of non-event ships)
            const nonEventShips = shipsOfRarity.filter(
                (s) => !eventShipsOfThisRarity.some((es) => es.name === s.name)
            );
            const nonEventCount = nonEventShips.length;

            if (nonEventCount === 0) {
                return 0;
            }

            return (rarityRate * (1 - totalEventRate)) / nonEventCount;
        }
    }

    // Base probability: rarity rate / number of ships of that rarity
    return rarityRate / totalShipsOfRarity;
};

/**
 * Calculate probability of getting at least one of the target ships
 */
export const calculateMultipleShipsProbability = (
    targetShips: Ship[],
    beaconType: BeaconType,
    ships: Ship[],
    eventShips: EventShip[] = []
): number => {
    if (targetShips.length === 0) {
        return 0;
    }

    // Calculate probability of NOT getting any of the target ships
    let probabilityOfNotGettingAny = 1;

    for (const ship of targetShips) {
        const shipProbability = calculateShipProbability(ship, beaconType, ships, eventShips);
        probabilityOfNotGettingAny *= 1 - shipProbability;
    }

    // Probability of getting at least one = 1 - probability of getting none
    return 1 - probabilityOfNotGettingAny;
};

/**
 * Calculate expected number of pulls to get a ship
 * @param probability - Probability per pull
 * @param beaconType - Type of beacon (only specialist beacons support guaranteed ships)
 * @param eventShips - Optional array of event ships (to check for guaranteed ships)
 * @param targetShipNames - Names of target ships to check against guaranteed ships
 */
export const calculateExpectedPulls = (
    probability: number,
    beaconType: BeaconType,
    eventShips: EventShip[] = [],
    targetShipNames: string[] = []
): number => {
    if (probability === 0) {
        return Infinity;
    }

    // Event ships (guaranteed or rate changes) only apply to specialist beacons
    if (beaconType === 'specialist') {
        // Check if any target ship is guaranteed
        const guaranteedTargetShips = eventShips.filter(
            (es) => es.threshold !== undefined && targetShipNames.includes(es.name)
        );

        if (guaranteedTargetShips.length > 0) {
            // Find the minimum threshold among guaranteed target ships
            const minThreshold = Math.min(
                ...guaranteedTargetShips.map((es) => es.threshold || Infinity)
            );

            // Expected pulls = threshold + (probability of getting it before threshold) * (expected pulls if we get it before threshold)
            // Simplified: threshold + (probability of getting it in first threshold pulls) * (expected pulls before threshold)
            // Since probability of getting it before threshold is usually small, we can approximate:
            // Expected pulls ≈ threshold + (probability * threshold) * (1 / probability) = threshold + threshold * probability
            // But more accurately:
            // Expected pulls = (probability of getting it before threshold) * (expected pulls if we get it before threshold)
            //                + (1 - probability of getting it before threshold) * threshold

            const probBeforeThreshold = 1 - Math.pow(1 - probability, minThreshold);
            const expectedPullsBeforeThreshold = probability > 0 ? 1 / probability : Infinity;

            // Weighted average: if we get it early, use early expected pulls; if not, use threshold
            return (
                probBeforeThreshold * Math.min(expectedPullsBeforeThreshold, minThreshold) +
                (1 - probBeforeThreshold) * minThreshold
            );
        }
    }

    return 1 / probability;
};

/**
 * Calculate number of pulls needed for a given confidence level
 * @param probability - Probability per pull
 * @param confidence - Confidence level (0-1)
 * @param beaconType - Type of beacon (only specialist beacons support guaranteed ships)
 * @param eventShips - Optional array of event ships (to check for guaranteed ships)
 * @param targetShipNames - Names of target ships to check against guaranteed ships
 */
export const calculatePullsForConfidence = (
    probability: number,
    confidence: number,
    beaconType: BeaconType,
    eventShips: EventShip[] = [],
    targetShipNames: string[] = []
): number => {
    if (probability === 0) {
        return Infinity;
    }

    // Event ships (guaranteed or rate changes) only apply to specialist beacons
    if (beaconType === 'specialist') {
        // Check if any target ship is guaranteed
        const guaranteedTargetShips = eventShips.filter(
            (es) => es.threshold !== undefined && targetShipNames.includes(es.name)
        );

        if (guaranteedTargetShips.length > 0) {
            // Find the minimum threshold among guaranteed target ships
            const minThreshold = Math.min(
                ...guaranteedTargetShips.map((es) => es.threshold || Infinity)
            );

            // If confidence can be achieved before the threshold, calculate normally
            // Otherwise, return the threshold (since it's guaranteed at that point)
            const pullsBeforeThreshold = Math.ceil(
                Math.log(1 - confidence) / Math.log(1 - probability)
            );

            // If we can achieve the confidence before the threshold, use that
            if (pullsBeforeThreshold < minThreshold) {
                return pullsBeforeThreshold;
            }

            // Otherwise, the threshold is the answer (guaranteed at that point)
            return minThreshold;
        }
    }

    // Standard calculation: P(at least one success in n pulls) = 1 - (1 - p)^n
    // We want: 1 - (1 - p)^n >= confidence
    // (1 - p)^n <= 1 - confidence
    // n * ln(1 - p) <= ln(1 - confidence)
    // n >= ln(1 - confidence) / ln(1 - p)
    const n = Math.log(1 - confidence) / Math.log(1 - probability);
    return Math.ceil(n);
};

/**
 * Calculate probability of getting at least one target ship in N pulls
 * @param probabilityPerPull - Probability of success in a single pull
 * @param numberOfPulls - Number of pulls available
 * @param beaconType - Type of beacon (only specialist beacons support guaranteed ships)
 * @param eventShips - Optional array of event ships (to check for guaranteed ships)
 * @param targetShipNames - Names of target ships to check against guaranteed ships
 * @returns Probability of getting at least one success in N pulls
 */
export const calculateProbabilityWithPulls = (
    probabilityPerPull: number,
    numberOfPulls: number,
    beaconType: BeaconType,
    eventShips: EventShip[] = [],
    targetShipNames: string[] = []
): number => {
    if (numberOfPulls === 0) {
        return 0;
    }

    // Event ships (guaranteed or rate changes) only apply to specialist beacons
    if (beaconType === 'specialist') {
        // Check if any target ship is guaranteed
        const guaranteedTargetShips = eventShips.filter(
            (es) => es.threshold !== undefined && targetShipNames.includes(es.name)
        );

        if (guaranteedTargetShips.length > 0) {
            // Find the minimum threshold among guaranteed target ships
            const minThreshold = Math.min(
                ...guaranteedTargetShips.map((es) => es.threshold || Infinity)
            );

            // Calculate number of guaranteed pulls
            const guaranteedPulls = Math.floor(numberOfPulls / minThreshold);
            const remainingPulls = numberOfPulls % minThreshold;

            // If we have at least one guaranteed pull, probability is 1
            if (guaranteedPulls > 0) {
                return 1.0;
            }

            // Otherwise, calculate probability for remaining pulls
            if (probabilityPerPull === 0 || remainingPulls === 0) {
                return 0;
            }
            return 1 - Math.pow(1 - probabilityPerPull, remainingPulls);
        }
    }

    // No guaranteed ships, use normal calculation
    if (probabilityPerPull === 0) {
        return 0;
    }
    // P(at least one success in n pulls) = 1 - (1 - p)^n
    return 1 - Math.pow(1 - probabilityPerPull, numberOfPulls);
};

/**
 * Calculate recruitment results for all beacon types
 */
export const calculateRecruitmentResults = (
    targetShips: Ship[],
    ships: Ship[],
    eventShips: EventShip[] = []
): RecruitmentResult[] => {
    const beaconTypes: BeaconType[] = ['public', 'specialist', 'expert', 'elite'];
    const targetShipNames = targetShips.map((s) => s.name);

    return beaconTypes.map((beaconType) => {
        const probability = calculateMultipleShipsProbability(
            targetShips,
            beaconType,
            ships,
            eventShips
        );

        // Event ships only affect specialist beacon calculations
        const expectedPulls = calculateExpectedPulls(
            probability,
            beaconType,
            eventShips,
            targetShipNames
        );
        const pullsFor90Percent = calculatePullsForConfidence(
            probability,
            0.9,
            beaconType,
            eventShips,
            targetShipNames
        );
        const pullsFor99Percent = calculatePullsForConfidence(
            probability,
            0.99,
            beaconType,
            eventShips,
            targetShipNames
        );

        return {
            beaconType,
            probability,
            expectedPulls,
            pullsFor90Percent,
            pullsFor99Percent,
        };
    });
};
