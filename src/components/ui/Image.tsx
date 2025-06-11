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
}

export const Image = memo(({ src, alt = '', className = '' }: ImageProps) => {
    const [imageError, setImageError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    if (!src || src === '' || imageError) {
        return (
            <div className={`bg-gray-700 ${className}`}>
                <div className="flex items-center justify-center h-full">
                    <span className="text-gray-400">No image available</span>
                </div>
            </div>
        );
    }

    const myImage = cld.image(src);

    return (
        <div className={`${className} ${className.includes('absolute') ? '' : 'relative'}`}>
            <AdvancedImage
                cldImg={myImage}
                plugins={[lazyload()]}
                onError={() => setImageError(true)}
                onLoad={() => setIsLoading(false)}
                alt={alt}
            />
            {isLoading && <div className="animate-pulse bg-gray-700 absolute inset-0" />}
        </div>
    );
});

Image.displayName = 'Image';
