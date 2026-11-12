import { Cloudinary } from '@cloudinary/url-gen';
import { scaledImage } from '../ui/Image';

const cld = new Cloudinary({
    cloud: { cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME },
});

/** A ship's big portrait as an absolute Cloudinary URL; `imageKey` is a Cloudinary public id, not
 *  a URL. */
export const shipPortraitUrl = (imageKey: string | undefined | null): string | null =>
    imageKey ? cld.image(`${imageKey}_BigPortrait.jpg`).toURL() : null;

/** A bounty boss's portrait (`Bounty.imageKey`), scaled down to `width` px. */
export const bountyPortraitUrl = (
    imageKey: string | undefined | null,
    width = 160
): string | null => (imageKey ? scaledImage(cld.image(imageKey), width).toURL() : null);

/** A ship's small pilot portrait as an absolute Cloudinary URL; it already faces the opponent. */
export const shipSmallPortraitUrl = (imageKey: string | undefined | null): string | null =>
    imageKey ? cld.image(`${imageKey}_Portrait.jpg`).toURL() : null;
