import * as THREE from 'three';
import { IdleSlice, runWhenIdle } from '../idle';
import {
    loadShipModel,
    onShipModelEvicted,
    releaseGpu,
    trimShipModelsToClosedSize,
} from './shipModelLoader';
import { lightShipScene, ShipLights, SPRITE_SHADOW_MAPS } from './shipLighting';
import { LightRigOptions, PILOT_LIGHTING } from './lightRig';
import {
    CHASE_CAMERA,
    FRAME_GRID_POSES,
    officialViewerCamera,
    poseRotation,
    ShipPose,
    SpriteCamera,
    sweepPoses,
    SweepRef,
} from './spritePoses';

/** Share of the frame, edge to edge, that the widest framing pose's bounding box fills. */
const FILL = 0.94;
/** Idle time one sprite frame is assumed to need: a render plus its read-back. */
const FRAME_UNIT_MS = 6;
/** Idle time fitting the zoom to one pose is assumed to need. */
const FIT_UNIT_MS = 2;

interface SpriteStage {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    lights: ShipLights;
    /** Models whose geometry, material and textures this stage's renderer has uploaded. */
    resident: Set<THREE.Object3D>;
    dropped: boolean;
}

let stage: SpriteStage | null = null;

/** `release` also frees the resident models' GPU copies and the WebGL context itself. */
function dropStage(s: SpriteStage, release: boolean): void {
    if (stage === s) stage = null;
    if (s.dropped) return;
    s.dropped = true;
    if (release) for (const model of s.resident) releaseGpu(model);
    s.resident.clear();
    s.lights.dispose();
    s.renderer.dispose();
    if (release) s.renderer.forceContextLoss();
}

/** One renderer and lit scene serve every sprite render. They are created on first use and keep
 *  each model's GPU copies resident between renders. The stage is dropped, with its GPU
 *  resources, by `disposeSpriteStage` or when the browser takes the WebGL context away, so the
 *  next render builds a fresh one instead of drawing into a context that may never come back. */
function spriteStage(): SpriteStage {
    if (stage && !stage.renderer.getContext().isContextLost()) return stage;
    if (stage) dropStage(stage, false);
    const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const lights = lightShipScene(scene, renderer, SPRITE_SHADOW_MAPS);
    const created: SpriteStage = {
        renderer,
        scene,
        lights,
        resident: new Set(),
        dropped: false,
    };
    renderer.domElement.addEventListener('webglcontextlost', () => dropStage(created, false));
    stage = created;
    return created;
}

/** Frees the sprite renderer, its WebGL context and the GPU copies of every model it drew; the
 *  next render creates them afresh. */
export function disposeSpriteStage(): void {
    if (stage) dropStage(stage, true);
}

/** Zooms by model key, then by camera, aspect and framing poses. */
const zoomCache = new Map<string, Map<string, number>>();
/** Each model's vertices in its own frame (x, y, z triples), for fitting the zoom. */
const vertexCache = new WeakMap<THREE.Object3D, Float32Array>();

/** Models the cache has evicted: their GPU copies are released and must not be counted
 *  resident again by a render that was still running. */
const evicted = new WeakSet<THREE.Object3D>();

/** Records that `model` is uploaded to `stage`, unless the cache has evicted it. */
export function markResident(s: Pick<SpriteStage, 'resident'>, model: THREE.Object3D): void {
    if (!evicted.has(model)) s.resident.add(model);
}

/** Drops the zoom fits of every model but `keep`'s; the models stay in their own cache. */
export function trimSpriteCaches(keep?: string | null): void {
    for (const key of [...zoomCache.keys()]) if (key !== keep) zoomCache.delete(key);
    trimShipModelsToClosedSize(keep);
}

onShipModelEvicted((model, key) => {
    evicted.add(model);
    stage?.resident.delete(model);
    zoomCache.delete(key);
});

function modelVertices(model: THREE.Object3D): Float32Array {
    let points = vertexCache.get(model);
    if (points) return points;
    model.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    const count = meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
    points = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    let at = 0;
    for (const mesh of meshes) {
        const position = mesh.geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
            v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
            points[at++] = v.x;
            points[at++] = v.y;
            points[at++] = v.z;
        }
    }
    vertexCache.set(model, points);
    return points;
}

const rotation = new THREE.Matrix4();
const euler = new THREE.Euler();
const corner = new THREE.Vector3();

/**
 * Largest |x| or |y| in normalised device coordinates of the corners of the model's exact
 * bounding box in `pose`: the box `Box3.setFromObject(posed, true)` gives, from the cached
 * vertices instead of a traversal of a posed clone.
 */
function poseExtent(points: Float32Array, pose: ShipPose, camera: THREE.Camera): number {
    const r = poseRotation(pose);
    rotation.makeRotationFromEuler(euler.set(r.x, r.y, r.z, 'YXZ'));
    const e = rotation.elements;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
        const px = points[i];
        const py = points[i + 1];
        const pz = points[i + 2];
        const x = e[0] * px + e[4] * py + e[8] * pz;
        const y = e[1] * px + e[5] * py + e[9] * pz;
        const z = e[2] * px + e[6] * py + e[10] * pz;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
    }
    let extent = 0;
    for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0).project(camera);
        extent = Math.max(extent, Math.abs(corner.x), Math.abs(corner.y));
    }
    return extent;
}

function setPose(ship: THREE.Object3D, pose: ShipPose): void {
    const r = poseRotation(pose);
    ship.rotation.set(r.x, r.y, r.z, 'YXZ');
    ship.updateMatrixWorld(true);
}

interface RenderOptions {
    camera: SpriteCamera;
    poses: readonly ShipPose[];
    /** Poses the shared zoom is fitted to; defaults to `poses`. */
    framing?: readonly ShipPose[];
    width: number;
    height: number;
    /** Aborting drops the render; its promise rejects with an `AbortError`. */
    signal?: AbortSignal;
    /** The viewer's rig when unset. */
    lighting?: LightRigOptions;
}

/**
 * Renders the ship at each of `poses` through `camera`, as transparent canvases in the same
 * order. Every frame shares one zoom, fitted so the widest `framing` pose fills the frame; the
 * ship therefore keeps its size across poses and every ship fills its sprite alike.
 *
 * The work runs through the shared idle queue in small units (the zoom fit one pose at a time,
 * the shader compile and texture uploads of a model new to the stage, then one frame at a time),
 * so it never holds a frame for long. Rejects if the WebGL context is lost mid-render.
 */
async function renderPoses(key: string, o: RenderOptions): Promise<HTMLCanvasElement[]> {
    const model = await loadShipModel(key);
    return runWhenIdle((slice) => renderModel(key, model, o, slice), { signal: o.signal });
}

async function renderModel(
    key: string,
    model: THREE.Group,
    o: RenderOptions,
    slice: IdleSlice
): Promise<HTMLCanvasElement[]> {
    const camera = new THREE.PerspectiveCamera(o.camera.fov, o.width / o.height, 0.1, 20);
    camera.position.set(...o.camera.position);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const framing = o.framing ?? o.poses;
    const zooms = zoomCache.get(key) ?? new Map<string, number>();
    zoomCache.set(key, zooms);
    const zoomKey = JSON.stringify([o.camera, o.width / o.height, framing]);
    let zoom = zooms.get(zoomKey);
    if (zoom === undefined) {
        const points = modelVertices(model);
        let extent = 0;
        for (const pose of framing) {
            await slice.next(FIT_UNIT_MS);
            extent = Math.max(extent, poseExtent(points, pose, camera));
        }
        zoom = FILL / extent;
        zooms.set(zoomKey, zoom);
    }
    camera.zoom = zoom;
    camera.updateProjectionMatrix();

    const ship = model.clone();
    setPose(ship, o.poses[0]);
    const s = spriteStage();
    if (!s.resident.has(model)) {
        // A model new to the stage compiles its shader and uploads its textures in units of
        // their own, ahead of its first frame.
        await slice.next(FRAME_UNIT_MS);
        s.scene.add(ship);
        try {
            await s.renderer.compileAsync(s.scene, camera);
        } finally {
            s.scene.remove(ship);
        }
        const textures = new Set<THREE.Texture>();
        model.traverse((child) => {
            const material = (child as THREE.Mesh).material as THREE.Material | undefined;
            if (!material) return;
            for (const value of Object.values(material) as unknown[]) {
                if (value instanceof THREE.Texture) textures.add(value as THREE.Texture);
            }
        });
        for (const texture of textures) {
            await slice.next(FRAME_UNIT_MS);
            s.renderer.initTexture(texture);
        }
        markResident(s, model);
    }

    const frames: HTMLCanvasElement[] = [];
    for (const pose of o.poses) {
        await slice.next(FRAME_UNIT_MS);
        // A stage dropped while this render waited is replaced; the model is uploaded again.
        const current = spriteStage();
        const { renderer, scene } = current;
        markResident(current, model);
        current.lights.aim(o.camera.position, o.lighting);
        setPose(ship, pose);
        // The shared canvas is resized, drawn and read back within this synchronous block, so
        // other renders never see each other's frames.
        renderer.setSize(o.width, o.height, false);
        scene.add(ship);
        renderer.render(scene, camera);
        scene.remove(ship);
        if (renderer.getContext().isContextLost()) {
            throw new Error(`ship sprites ${key}: WebGL context lost`);
        }
        const frame = document.createElement('canvas');
        frame.width = o.width;
        frame.height = o.height;
        frame.getContext('2d')?.drawImage(renderer.domElement, 0, 0);
        frames.push(frame);
    }
    return frames;
}

/**
 * The run's chase-camera frames for the given sweeps of the frame grid, one array of heading
 * frames (`HEADING_ANGLES_DEG` order) per requested sweep, as square canvases. Every sweep shares
 * the zoom fitted to the whole grid, so sweeps rendered by separate calls match. They are the
 * player's own ship, lit with `PILOT_LIGHTING`.
 */
export function renderChaseSweeps(
    key: string,
    sweeps: readonly SweepRef[],
    { size = 256, signal }: { size?: number; signal?: AbortSignal } = {}
): Promise<HTMLCanvasElement[][]> {
    const perSweep = sweeps.map(({ pitch, bank }) => sweepPoses(pitch, bank));
    return renderPoses(key, {
        camera: CHASE_CAMERA,
        poses: perSweep.flat(),
        framing: FRAME_GRID_POSES,
        width: size,
        height: size,
        signal,
        lighting: PILOT_LIGHTING,
    }).then((frames) => {
        let at = 0;
        return perSweep.map((poses) => frames.slice(at, (at += poses.length)));
    });
}

/** The ship at the official viewer's default angle, bow toward `facing`. */
export function renderViewerSprite(
    key: string,
    facing: 'left' | 'right',
    {
        width = 400,
        height = 225,
        signal,
    }: { width?: number; height?: number; signal?: AbortSignal } = {}
): Promise<HTMLCanvasElement> {
    return renderPoses(key, {
        camera: officialViewerCamera(facing),
        poses: [{ yawDeg: 0, bankDeg: 0, pitchDeg: 0 }],
        width,
        height,
        signal,
    }).then(([frame]) => frame);
}
