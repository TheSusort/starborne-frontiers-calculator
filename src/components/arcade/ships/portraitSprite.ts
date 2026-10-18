const cache = new Map<string, Promise<HTMLImageElement>>();
const loaded = new Map<string, HTMLImageElement>();

/** Session-cached portrait image. Never sets `crossOrigin`: the canvas only draws it. */
export function loadPortrait(url: string): Promise<HTMLImageElement> {
    let p = cache.get(url);
    if (!p) {
        p = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                loaded.set(url, img);
                resolve(img);
            };
            img.onerror = () => {
                cache.delete(url);
                reject(new Error(`portrait failed: ${url}`));
            };
            img.src = url;
        });
        cache.set(url, p);
    }
    return p;
}

/** The image if it has finished loading, for per-frame drawing. */
export function cachedPortrait(url: string): HTMLImageElement | null {
    return loaded.get(url) ?? null;
}
