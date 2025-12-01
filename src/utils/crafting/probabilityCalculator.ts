import { CraftingInput, CraftingResult, StarRarityDistribution } from '../../types/crafting';
import { CRAFTING_PROBABILITIES } from '../../constants/craftingProbabilities';

/**
 * Applies booster effects to probability distributions
 * Boosters double the chances of 5/6 star and epic/legendary at the expense of lowest quality
 *
 * The logic: Double the target probabilities, then redistribute the excess from lower tiers.
 * If lower tiers are exhausted, reduce the middle tier to make room.
 */
function applyBoosters(
    stars: [number, number, number],
    rarity: [number, number, number],
    hasRankBooster: boolean,
    hasRarityBooster: boolean
): { stars: [number, number, number]; rarity: [number, number, number] } {
    let adjustedStars = [...stars] as [number, number, number];
    let adjustedRarity = [...rarity] as [number, number, number];

    // Rank booster: doubles 5* and 6* chances, reduces 4*
    if (hasRankBooster) {
        const fourStar = adjustedStars[0];
        const fiveStar = adjustedStars[1];
        const sixStar = adjustedStars[2];

        // Double 5* and 6*
        const doubledFiveStar = fiveStar * 2;
        const doubledSixStar = sixStar * 2;

        // Calculate how much we need to reduce from lower tiers
        const totalNeeded = doubledFiveStar - fiveStar + (doubledSixStar - sixStar);

        // Start by taking from 4*
        const availableFromFour = fourStar;
        const takenFromFour = Math.min(availableFromFour, totalNeeded);

        // Calculate what's left to take
        const remaining = totalNeeded - takenFromFour;

        // If we still need more and 4* is exhausted, take from 5*
        // This means 5* won't fully double, but 6* will get priority
        if (remaining > 0) {
            // Reduce 5* by the remaining amount
            adjustedStars[1] = doubledFiveStar - remaining;
            adjustedStars[2] = doubledSixStar;
        } else {
            // We have enough from 4*, so both 5* and 6* can double
            adjustedStars[1] = doubledFiveStar;
            adjustedStars[2] = doubledSixStar;
        }

        adjustedStars[0] = fourStar - takenFromFour;

        // Ensure no negative values
        adjustedStars[0] = Math.max(0, adjustedStars[0]);
        adjustedStars[1] = Math.max(0, adjustedStars[1]);
        adjustedStars[2] = Math.max(0, adjustedStars[2]);

        // Normalize to ensure they sum to 1
        const total = adjustedStars[0] + adjustedStars[1] + adjustedStars[2];
        if (total > 0) {
            adjustedStars = [
                adjustedStars[0] / total,
                adjustedStars[1] / total,
                adjustedStars[2] / total,
            ] as [number, number, number];
        }
    }

    // Rarity booster: doubles epic and legendary chances, reduces rare
    if (hasRarityBooster) {
        const rare = adjustedRarity[0];
        const epic = adjustedRarity[1];
        const legendary = adjustedRarity[2];

        // Double epic and legendary
        const doubledEpic = epic * 2;
        const doubledLegendary = legendary * 2;

        // Calculate how much we need to reduce from lower tiers
        const totalNeeded = doubledEpic - epic + (doubledLegendary - legendary);

        // Start by taking from rare
        const availableFromRare = rare;
        const takenFromRare = Math.min(availableFromRare, totalNeeded);

        // Calculate what's left to take
        const remaining = totalNeeded - takenFromRare;

        // If we still need more and rare is exhausted, take from epic
        // This means epic won't fully double, but legendary will get priority
        if (remaining > 0) {
            // Reduce epic by the remaining amount
            adjustedRarity[1] = doubledEpic - remaining;
            adjustedRarity[2] = doubledLegendary;
        } else {
            // We have enough from rare, so both epic and legendary can double
            adjustedRarity[1] = doubledEpic;
            adjustedRarity[2] = doubledLegendary;
        }

        adjustedRarity[0] = rare - takenFromRare;

        // Ensure no negative values
        adjustedRarity[0] = Math.max(0, adjustedRarity[0]);
        adjustedRarity[1] = Math.max(0, adjustedRarity[1]);
        adjustedRarity[2] = Math.max(0, adjustedRarity[2]);

        // Normalize to ensure they sum to 1
        const total = adjustedRarity[0] + adjustedRarity[1] + adjustedRarity[2];
        if (total > 0) {
            adjustedRarity = [
                adjustedRarity[0] / total,
                adjustedRarity[1] / total,
                adjustedRarity[2] / total,
            ] as [number, number, number];
        }
    }

    return { stars: adjustedStars, rarity: adjustedRarity };
}

/**
 * Calculates the full probability distribution for crafting results
 */
export function calculateCraftingProbabilities(input: CraftingInput): CraftingResult {
    // Get base probabilities
    const baseProb = CRAFTING_PROBABILITIES[input.setCoreRarity][input.setMaterialRarity];

    // Apply boosters
    const { stars, rarity } = applyBoosters(
        baseProb.stars,
        baseProb.rarity,
        input.boosters.rank === true,
        input.boosters.rarity === true
    );

    // Calculate full distribution (stars × rarity)
    const distribution: StarRarityDistribution = {
        '4_star_rare': stars[0] * rarity[0],
        '4_star_epic': stars[0] * rarity[1],
        '4_star_legendary': stars[0] * rarity[2],
        '5_star_rare': stars[1] * rarity[0],
        '5_star_epic': stars[1] * rarity[1],
        '5_star_legendary': stars[1] * rarity[2],
        '6_star_rare': stars[2] * rarity[0],
        '6_star_epic': stars[2] * rarity[1],
        '6_star_legendary': stars[2] * rarity[2],
    };

    // Calculate star distribution
    const starDistribution = {
        '4_star': stars[0],
        '5_star': stars[1],
        '6_star': stars[2],
    };

    // Calculate rarity distribution
    const rarityDistribution = {
        rare: rarity[0],
        epic: rarity[1],
        legendary: rarity[2],
    };

    // Calculate expected values
    const expectedStars = 4 * stars[0] + 5 * stars[1] + 6 * stars[2];
    const expectedRarityValue = rarity[0] * 1 + rarity[1] * 2 + rarity[2] * 3;
    const expectedRarity =
        expectedRarityValue < 1.5 ? 'rare' : expectedRarityValue < 2.5 ? 'epic' : 'legendary';

    return {
        starDistribution,
        rarityDistribution,
        fullDistribution: distribution,
        expectedStars,
        expectedRarity,
    };
}

/**
 * Calculates expected results for multiple crafts
 */
export function calculateExpectedResults(
    input: CraftingInput,
    craftCount: number
): {
    expected: {
        '4_star': number;
        '5_star': number;
        '6_star': number;
        rare: number;
        epic: number;
        legendary: number;
    };
    distribution: StarRarityDistribution;
} {
    const probabilities = calculateCraftingProbabilities(input);

    return {
        expected: {
            '4_star': probabilities.starDistribution['4_star'] * craftCount,
            '5_star': probabilities.starDistribution['5_star'] * craftCount,
            '6_star': probabilities.starDistribution['6_star'] * craftCount,
            rare: probabilities.rarityDistribution.rare * craftCount,
            epic: probabilities.rarityDistribution.epic * craftCount,
            legendary: probabilities.rarityDistribution.legendary * craftCount,
        },
        distribution: probabilities.fullDistribution,
    };
}
