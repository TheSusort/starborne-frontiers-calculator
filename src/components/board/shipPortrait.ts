import { Cloudinary } from '@cloudinary/url-gen';

const cld = new Cloudinary({
    cloud: { cloudName: import.meta.env.VITE_CLOUDINARY_CLOUD_NAME },
});

/** A ship's big portrait as an absolute Cloudinary URL; `imageKey` is a Cloudinary public id, not
 *  a URL. */
export const shipPortraitUrl = (imageKey: string | undefined | null): string | null =>
    imageKey ? cld.image(`${imageKey}_BigPortrait.jpg`).toURL() : null;

/** A ship's small pilot portrait as an absolute Cloudinary URL; it already faces the opponent. */
export const shipSmallPortraitUrl = (imageKey: string | undefined | null): string | null =>
    imageKey ? cld.image(`${imageKey}_Portrait.jpg`).toURL() : null;
