import React from 'react';

/** One of the player's allies on a `team` row, as the banner shows them. */
export interface BannerAlly {
    name: string;
    portraitUrl: string | null;
}

export interface PreviewBannerContent {
    /** The previewed checkpoint, so a new row restarts the banner. */
    checkpointId: number;
    /** "TANK · WIN OR DIE" (see `challengeBanner`). */
    text: string;
    /** The two ships flying with the player on a `team` row; empty otherwise. */
    allies: BannerAlly[];
}

/**
 * The slow-motion preview's banner: the row's challenge and stakes, large and centred, and on a
 * `team` row the two allies flying with the player. It stays mounted with its last content and
 * fades in and out with `shown`, so it is up for the whole preview.
 */
export const PreviewBanner: React.FC<{ content: PreviewBannerContent | null; shown: boolean }> = ({
    content,
    shown,
}) => {
    if (!content) return null;
    return (
        <div
            className={`absolute inset-x-0 top-20 flex justify-center px-4 pointer-events-none transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`}
            role="status"
            aria-live="polite"
        >
            <div className="card !bg-black/85 !border-2 !border-primary text-center space-y-2 shadow-[0_0_24px_rgba(176,108,255,0.6)]">
                <div className="text-3xl sm:text-5xl font-extrabold tracking-widest text-white">
                    {content.text}
                </div>
                {content.allies.length > 0 && (
                    <div className="flex items-center justify-center gap-4 text-sm text-theme-text-secondary">
                        <span className="tracking-widest">WITH</span>
                        {content.allies.map((ally, i) => (
                            <span key={i} className="flex items-center gap-2 text-white">
                                {ally.portraitUrl && (
                                    <img
                                        src={ally.portraitUrl}
                                        alt=""
                                        className="h-10 w-10 object-cover border border-primary"
                                    />
                                )}
                                <span className="font-semibold">{ally.name}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
