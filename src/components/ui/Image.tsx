import { Cloudinary } from '@cloudinary/url-gen';
import { AdvancedImage, lazyload } from '@cloudinary/react';
import { useState, memo } from 'react';

// Create singleton Cloudinary instance
const cld = new Cloudinary({
    cloud: { cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME },
});

interface ImageProps {
    src: string;
    alt?: string;
    className?: string;
    imageClassName?: string;
    /** Aspect ratio as "width/height" (e.g., "16/9", "389/518") to prevent layout shift */
    aspectRatio?: string;
}

export const Image = memo(
    ({ src, alt = '', className = '', imageClassName = '', aspectRatio }: ImageProps) => {
        const [imageError, setImageError] = useState(false);
        const [isLoading, setIsLoading] = useState(true);

        const aspectStyle = aspectRatio ? { aspectRatio } : undefined;

        if (!src || src === '' || imageError) {
            return (
                <div className={`bg-gray-700 ${className}`} style={aspectStyle}>
                    <div className="flex items-center justify-center h-full">
                        <span className="text-gray-400">No image available</span>
                    </div>
                </div>
            );
        }

        const myImage = cld.image(src);

        return (
            <div
                className={`${className} ${className.includes('absolute') ? '' : 'relative'}`}
                style={aspectStyle}
            >
                <AdvancedImage
                    cldImg={myImage}
                    plugins={[lazyload()]}
                    onError={() => setImageError(true)}
                    onLoad={() => setIsLoading(false)}
                    alt={alt}
                    className={`${imageClassName} transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
                />
                {isLoading && (
                    <div className="absolute inset-0 bg-dark-lighter overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent skeleton-shimmer" />
                    </div>
                )}
            </div>
        );
    }
);

Image.displayName = 'Image';
