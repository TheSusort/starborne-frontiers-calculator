import { Cloudinary } from '@cloudinary/url-gen';
import { AdvancedVideo } from '@cloudinary/react';
import { useState, useRef, useMemo, useImperativeHandle, forwardRef, memo } from 'react';

const cld = new Cloudinary({
    cloud: { cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME },
});

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
            const [isPlaying, setIsPlaying] = useState(false);
            const videoRef = useRef<HTMLVideoElement>(null);

            useImperativeHandle(ref, () => ({
                play: () => {
                    if (!videoRef.current) return;
                    setIsPlaying(true);
                    videoRef.current.play();
                },
                pause: () => {
                    if (videoRef.current) {
                        videoRef.current.pause();
                        videoRef.current.currentTime = 0;
                    }
                    setIsPlaying(false);
                },
            }));

            const aspectStyle = aspectRatio ? { aspectRatio } : undefined;

            const myVideo = useMemo(() => (src ? cld.video(src) : null), [src]);

            if (!src || !myVideo) {
                return null;
            }

            return (
                <div
                    className={`${className} ${className.includes('absolute') ? '' : 'relative'}`}
                    style={aspectStyle}
                >
                    <AdvancedVideo
                        cldVid={myVideo}
                        className={`${videoClassName} transition-opacity duration-300 ${isPlaying ? 'opacity-100' : 'opacity-0'}`}
                        loop={loop}
                        muted={muted}
                        playsInline={playsInline}
                        preload="auto"
                        innerRef={videoRef}
                    />
                </div>
            );
        }
    )
);

Video.displayName = 'Video';
