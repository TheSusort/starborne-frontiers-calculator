import { Cloudinary, type CloudinaryImage } from '@cloudinary/url-gen';
import { scale } from '@cloudinary/url-gen/actions/resize';
import { format, quality } from '@cloudinary/url-gen/actions/delivery';
import { auto as autoFormat } from '@cloudinary/url-gen/qualifiers/format';
import { auto as autoQuality } from '@cloudinary/url-gen/qualifiers/quality';
import { AdvancedImage, lazyload } from '@cloudinary/react';
import { useState, memo } from 'react';

// Create singleton Cloudinary instance
const cld = new Cloudinary({
    cloud: { cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME },
});

/** `image` scaled to `width` px wide, delivered in the browser's best format and quality. For
 *  full-size uploads such as the bounty boss art. */
// eslint-disable-next-line react-refresh/only-export-components
export const scaledImage = (image: CloudinaryImage, width: number): CloudinaryImage =>
    image
        .resize(scale().width(width))
        .delivery(format(autoFormat()))
        .delivery(quality(autoQuality()));

interface ImageProps {
    src: string;
    alt?: string;
    className?: string;
    imageClassName?: string;
    /** Aspect ratio as "width/height" (e.g., "16/9", "389/518") to prevent layout shift */
    aspectRatio?: string;
    style?: React.CSSProperties;
    /** Rendered in place of the "No image available" placeholder when there is no src or it fails to load. */
    fallback?: React.ReactNode;
    /** Scales the image to this many px wide on delivery (see `scaledImage`). Leave it out for
     *  images already uploaded at display size. */
    width?: number;
}

export const Image = memo(
    ({
        src,
        alt = '',
        className = '',
        imageClassName = '',
        aspectRatio,
        style,
        fallback,
        width,
    }: ImageProps) => {
        const [imageError, setImageError] = useState(false);
        const [isLoading, setIsLoading] = useState(true);

        const aspectStyle = { ...(aspectRatio ? { aspectRatio } : {}), ...style };

        if (!src || src === '' || imageError) {
            if (fallback !== undefined) return <>{fallback}</>;
            return (
                <div className={`bg-dark-lighter ${className}`} style={aspectStyle}>
                    <div className="flex items-center justify-center h-full">
                        <span className="text-theme-text-secondary">No image available</span>
                    </div>
                </div>
            );
        }

        const myImage = width ? scaledImage(cld.image(src), width) : cld.image(src);

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
