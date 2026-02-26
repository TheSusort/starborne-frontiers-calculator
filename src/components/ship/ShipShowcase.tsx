import React, { useEffect, useRef } from 'react';
import { Ship } from '../../types/ship';
import { Video, VideoHandle } from '../ui/Video';
import { Image } from '../ui/Image';
import { hasShipVideo } from '../../utils/ship/hasVideo';

interface ShipShowcaseProps {
    ship: Ship;
}

export const ShipShowcase: React.FC<ShipShowcaseProps> = ({ ship }) => {
    const videoRef = useRef<VideoHandle>(null);
    const showVideo = hasShipVideo(ship.rarity, ship.imageKey);

    useEffect(() => {
        if (showVideo) {
            videoRef.current?.play();
        }
    }, [showVideo]);

    if (!ship.imageKey) {
        return null;
    }

    return (
        <section className="hidden lg:block card overflow-hidden">
            <div className="relative w-full" style={{ aspectRatio: '1/1' }}>
                <Image
                    src={`${ship.imageKey}_BigPortrait.jpg`}
                    alt={ship.name}
                    className="w-full"
                    imageClassName="w-full"
                    aspectRatio="1/1"
                />
                {showVideo && (
                    <Video
                        ref={videoRef}
                        src={`${ship.imageKey}_Video`}
                        className="absolute inset-0 w-full pointer-events-none"
                        videoClassName="w-full object-cover"
                        aspectRatio="1/1"
                    />
                )}
            </div>
        </section>
    );
};
