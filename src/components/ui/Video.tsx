import { Cloudinary } from '@cloudinary/url-gen';
import { AdvancedVideo } from '@cloudinary/react';
import { useState, useRef, useImperativeHandle, forwardRef, memo, useCallback } from 'react';

const cld = new Cloudinary({
    cloud: { cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME },
});

// Track videos that failed to load to avoid repeated 404s
const failedVideos = new Set<string>();

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
            const [shouldLoad, setShouldLoad] = useState(false);
            const [videoReady, setVideoReady] = useState(false);
            const [videoError, setVideoError] = useState(() => failedVideos.has(src));
            const videoRef = useRef<HTMLVideoElement>(null);

            const handleError = useCallback(() => {
                failedVideos.add(src);
                setVideoError(true);
            }, [src]);

            useImperativeHandle(ref, () => ({
                play: () => {
                    if (videoError || failedVideos.has(src)) return;

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

            // Don't render anything if no src, error, or not yet triggered
            if (!src || videoError || !shouldLoad) {
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
                        onError={handleError}
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
