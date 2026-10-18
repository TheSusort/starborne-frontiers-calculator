import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const BASE = 'https://starborne.com/ship-renders';
const TIMEOUT_MS = 10_000;
/** The FBX's own texture references are replaced below, so its requests resolve to nothing. */
const EMPTY_PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function modelUrls(key: string) {
    const at = (suffix: string) => `${BASE}/${key}/${key}_${suffix}`;
    return {
        fbx: at('LOD0.fbx'),
        albedo: at('A.webp'),
        emissive: at('E.webp'),
        normal: at('N.webp'),
        orm: at('ORM.webp'),
    };
}

interface Vec3 {
    x: number;
    y: number;
    z: number;
}

/**
 * Renders face +Z with +Y up and their `EngineFX*` markers at the rear, except a few authored
 * standing on their tail: longest along Y with the engines at one end of it. Returns the
 * rotation about X that turns such a model nose-forward (engines toward -Z), else 0.
 * `engineOffset` is the engine markers' centroid relative to the model's centre.
 */
export function noseUpCorrection(size: Vec3, engineOffset: Vec3 | null): number {
    if (!engineOffset) return 0;
    const tallest = size.y > size.x && size.y > size.z;
    const enginesAlongY =
        Math.abs(engineOffset.y) > Math.abs(engineOffset.x) &&
        Math.abs(engineOffset.y) > Math.abs(engineOffset.z);
    if (!tallest || !enginesAlongY) return 0;
    return engineOffset.y < 0 ? Math.PI / 2 : -Math.PI / 2;
}

function engineCentroid(object: THREE.Object3D): THREE.Vector3 | null {
    const sum = new THREE.Vector3();
    let n = 0;
    object.updateMatrixWorld(true);
    object.traverse((child) => {
        if (!/engine/i.test(child.name)) return;
        sum.add(child.getWorldPosition(new THREE.Vector3()));
        n++;
    });
    return n > 0 ? sum.divideScalar(n) : null;
}

const cache = new Map<string, Promise<THREE.Group>>();

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const id = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
        p.then(
            (v) => {
                clearTimeout(id);
                resolve(v);
            },
            (e: unknown) => {
                clearTimeout(id);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        );
    });
}

async function load(key: string): Promise<THREE.Group> {
    const urls = modelUrls(key);
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => (url === urls.fbx ? url : EMPTY_PIXEL));
    const textures = new THREE.TextureLoader();
    textures.setCrossOrigin('anonymous');
    const [object, albedo, emissive, normal, orm] = await Promise.all([
        new FBXLoader(manager).loadAsync(urls.fbx),
        textures.loadAsync(urls.albedo),
        textures.loadAsync(urls.emissive),
        textures.loadAsync(urls.normal),
        textures.loadAsync(urls.orm),
    ]);
    albedo.colorSpace = THREE.SRGBColorSpace;
    emissive.colorSpace = THREE.SRGBColorSpace;
    normal.colorSpace = THREE.NoColorSpace;
    orm.colorSpace = THREE.NoColorSpace;
    // ORM packs occlusion (R), roughness (G), metalness (B) — the channels MeshStandardMaterial reads.
    const material = new THREE.MeshStandardMaterial({
        map: albedo,
        emissiveMap: emissive,
        emissive: new THREE.Color(0xffffff),
        normalMap: normal,
        aoMap: orm,
        roughnessMap: orm,
        metalnessMap: orm,
    });
    object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = material;
    });
    // Orient, centre and normalise so callers can frame any ship the same way: nose toward +Z,
    // up +Y, bounding-box diagonal 2.
    const raw = new THREE.Box3().setFromObject(object);
    const engines = engineCentroid(object);
    object.rotateX(
        noseUpCorrection(
            raw.getSize(new THREE.Vector3()),
            engines && engines.sub(raw.getCenter(new THREE.Vector3()))
        )
    );
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    object.position.sub(box.getCenter(new THREE.Vector3()));
    const wrapper = new THREE.Group();
    wrapper.add(object);
    wrapper.scale.setScalar(2 / size);
    return wrapper;
}

/** Session-cached; a failed or timed-out load is evicted so a later call retries. Callers fall back
 *  to the portrait on rejection. */
export function loadShipModel(key: string, timeoutMs = TIMEOUT_MS): Promise<THREE.Group> {
    let p = cache.get(key);
    if (!p) {
        p = withTimeout(load(key), timeoutMs, `ship model ${key}`);
        p.catch(() => cache.delete(key));
        cache.set(key, p);
    }
    return p;
}
