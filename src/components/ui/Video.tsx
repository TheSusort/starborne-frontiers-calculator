import { Cloudinary } from '@cloudinary/url-gen';
import { AdvancedVideo } from '@cloudinary/react';
import { useState, useRef, useImperativeHandle, forwardRef, memo, useCallback } from 'react';

const cld = new Cloudinary({
    cloud: { cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME },
});

// Whitelist of video public IDs that exist on Cloudinary
// Add new entries when uploading videos: `${imageKey}_Video`
const AVAILABLE_VIDEOS = new Set<string>([
    'Gelecek_15_Video',
    'Legion_6_Video',
    'Marauder_15_Video',
    'MPL_5_Video',
    'Terran_6_Video',
    'Terran_7_Video',
    'Terran_16_Video',
    'Tianchao_6_Video',
    'Tianchao_7_Video',
    'Tianchao_11_Video',
    'Tianchao_13_Video',
    'Tianchao_14_Video',
    'XAOC_6_Video',
    'XAOC_8_Video',
    'XAOC_9_Video',
    'XAOC_11_Video',
    'XAOC_12_Video',
    'XAOC_13_Video',
    'XAOC_17_Video',
    // Add more as you upload them
]);

interface VideoProps {
    src: string;
    className?: string;
    videoClassName?: string;
    aspectRatio?: string;
    loop?: boolean;
    muted?: boolean;
    playsInline?: boolean;
}

export interface VideoHandle {
    play: () => void;
    pause: () => void;
}

export const Video = memo(
    forwardRef<VideoHandle, VideoProps>(
        (
            {
                src,
                className = '',
                videoClassName = '',
                aspectRatio,
                loop = true,
                muted = true,
                playsInline = true,
            },
            ref
        ) => {
            const videoExists = AVAILABLE_VIDEOS.has(src);
            const [shouldLoad, setShouldLoad] = useState(false);
            const [videoReady, setVideoReady] = useState(false);
            const videoRef = useRef<HTMLVideoElement>(null);

            useImperativeHandle(ref, () => ({
                play: () => {
                    if (!videoExists) return;

                    if (!shouldLoad) {
                        setShouldLoad(true);
                    }
                    // Play will be triggered by onLoadedData or if already ready
                    if (videoReady && videoRef.current) {
                        videoRef.current.play();
                    }
                },
                pause: () => {
                    if (videoRef.current) {
                        videoRef.current.pause();
                        videoRef.current.currentTime = 0;
                    }
                },
            }));

            const handleLoadedData = useCallback(() => {
                setVideoReady(true);
                // Auto-play once loaded since play() was called
                videoRef.current?.play();
            }, []);

            const aspectStyle = aspectRatio ? { aspectRatio } : undefined;

            // Don't render anything if no src, not in whitelist, or not yet triggered
            if (!src || !videoExists || !shouldLoad) {
                return null;
            }

            const myVideo = cld.video(src);

            return (
                <div
                    className={`${className} ${className.includes('absolute') ? '' : 'relative'}`}
                    style={aspectStyle}
                >
                    <AdvancedVideo
                        cldVid={myVideo}
                        onLoadedData={handleLoadedData}
                        className={`${videoClassName} transition-opacity duration-300 ${videoReady ? 'opacity-100' : 'opacity-0'}`}
                        loop={loop}
                        muted={muted}
                        playsInline={playsInline}
                        innerRef={videoRef}
                    />
                </div>
            );
        }
    )
);

Video.displayName = 'Video';
