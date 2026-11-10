import React from 'react';
import { Chip } from '../ui/Chip';
import type { WishlistMatchScore } from '../../utils/wishlist/scoreWishlistMatches';
import { describeMatchScore } from '../../utils/wishlist/wishlistScoreDisplay';

/** Upgrade value of one match: green when it is an upgrade, plain otherwise. */
export const WishlistScoreBadge: React.FC<{ score: WishlistMatchScore }> = ({ score }) => {
    const { label, detail } = describeMatchScore(score);
    return (
        <span className="inline-flex flex-wrap items-center gap-2">
            <Chip variant={score.isUpgrade ? 'buff' : 'default'}>
                {score.isUpgrade ? `Upgrade ${label}` : label}
            </Chip>
            {detail && <span className="text-xs text-theme-text-secondary">{detail}</span>}
        </span>
    );
};
