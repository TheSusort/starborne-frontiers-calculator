import * as THREE from 'three';
import { whenIdle } from '../idle';
import { loadShipModel } from './shipModelLoader';
import { addShipLights } from './shipLighting';
import {
    CHASE_CAMERA,
    FRAME_GRID_POSES,
    LEVEL_BANK_COLUMN,
    LEVEL_PITCH_ROW,
    officialViewerCamera,
    poseRotation,
    rowPoses,
    ShipPose,
    SpriteCamera,
} from './spritePoses';

/** Share of the frame, edge to edge, that the widest framing pose's bounding box fills. */
const FILL = 0.94;

/** Largest |x| or |y| in normalised device coordinates of the corners of `object`'s box. */
function ndcExtent(object: THREE.Object3D, camera: THREE.Camera): number {
    const box = new THREE.Box3().setFromObject(object, true);
    const p = new THREE.Vector3();
    let extent = 0;
    for (let i = 0; i < 8; i++) {
        p.set(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z
        );
        p.project(camera);
        extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
    }
    return extent;
}

interface SpriteStage {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    disposeLights: () => void;
    dropped: boolean;
}

let stage: SpriteStage | null = null;

function dropStage(s: SpriteStage): void {
    if (stage === s) stage = null;
    if (s.dropped) return;
    s.dropped = true;
    s.disposeLights();
    s.renderer.dispose();
}

/** One renderer and lit scene serve every sprite render. They are created on first use and
 *  dropped, with their GPU resources, when the browser takes the WebGL context away, so the next
 *  render builds a fresh stage instead of drawing into a context that may never come back. */
function spriteStage(): SpriteStage {
    if (stage && !stage.renderer.getContext().isContextLost()) return stage;
    if (stage) dropStage(stage);
    const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const disposeLights = addShipLights(scene, renderer);
    const created: SpriteStage = { renderer, scene, disposeLights, dropped: false };
    renderer.domElement.addEventListener('webglcontextlost', () => dropStage(created));
    stage = created;
    return created;
}

/** Frees the GPU copies of `model`'s geometry, materials and textures in every renderer; a
 *  renderer that draws the model again uploads them afresh. */
function releaseGpu(model: THREE.Object3D): void {
    const materials = new Set<THREE.Material>();
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (!material) return;
        for (const m of Array.isArray(material) ? material : [material]) materials.add(m);
    });
    for (const material of materials) {
        for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
    }
}

function posed(model: THREE.Object3D, pose: ShipPose): THREE.Object3D {
    const ship = model.clone();
    const r = poseRotation(pose);
    ship.rotation.set(r.x, r.y, r.z, 'YXZ');
    ship.updateMatrixWorld(true);
    return ship;
}

interface RenderOptions {
    camera: SpriteCamera;
    poses: readonly ShipPose[];
    /** Poses the shared zoom is fitted to; defaults to `poses`. */
    framing?: readonly ShipPose[];
    width: number;
    height: number;
    /** Wait for idle time between loading the model and the synchronous render. */
    idle?: boolean;
}

const zoomCache = new Map<string, number>();

/**
 * Renders the ship at each of `poses` through `camera`, as transparent canvases in the same
 * order. Every frame shares one zoom, fitted so the widest `framing` pose fills the frame; the
 * ship therefore keeps its size across poses and every ship fills its sprite alike. Rejects if
 * the WebGL context is lost mid-render.
 */
async function renderPoses(key: string, o: RenderOptions): Promise<HTMLCanvasElement[]> {
    const model = await loadShipModel(key);
    if (o.idle) await whenIdle();
    const camera = new THREE.PerspectiveCamera(o.camera.fov, o.width / o.height, 0.1, 20);
    camera.position.set(...o.camera.position);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const framing = o.framing ?? o.poses;
    const zoomKey = JSON.stringify([key, o.camera, o.width / o.height, framing]);
    let zoom = zoomCache.get(zoomKey);
    if (zoom === undefined) {
        zoom = FILL / Math.max(...framing.map((p) => ndcExtent(posed(model, p), camera)));
        zoomCache.set(zoomKey, zoom);
    }
    camera.zoom = zoom;
    camera.updateProjectionMatrix();

    // The shared canvas is resized and read back within this synchronous block, so concurrent
    // calls never see each other's frames.
    const { renderer, scene } = spriteStage();
    try {
        renderer.setSize(o.width, o.height, false);
        const frames = o.poses.map((pose) => {
            const ship = posed(model, pose);
            scene.add(ship);
            renderer.render(scene, camera);
            scene.remove(ship);
            const frame = document.createElement('canvas');
            frame.width = o.width;
            frame.height = o.height;
            frame.getContext('2d')?.drawImage(renderer.domElement, 0, 0);
            return frame;
        });
        if (renderer.getContext().isContextLost()) {
            throw new Error(`ship sprites ${key}: WebGL context lost`);
        }
        return frames;
    } finally {
        releaseGpu(model);
    }
}

/**
 * The run's chase-camera frames for the given rows of the frame grid (`PITCH_ANGLES_DEG` ×
 * `BANK_ANGLES_DEG`), one array of bank frames per requested row, as square canvases. All rows
 * share the zoom fitted to the whole grid, so rows rendered by separate calls match.
 */
export function renderChaseFrames(
    key: string,
    rows: readonly number[],
    size = 256,
    idle = false
): Promise<HTMLCanvasElement[][]> {
    const n = rowPoses(0).length;
    return renderPoses(key, {
        camera: CHASE_CAMERA,
        poses: rows.flatMap(rowPoses),
        framing: FRAME_GRID_POSES,
        width: size,
        height: size,
        idle,
    }).then((frames) => rows.map((_, i) => frames.slice(i * n, (i + 1) * n)));
}

/** The level chase-camera frame alone, framed like the run's grid so it sits inside a gate's
 *  circle; rendered in idle time. */
export function renderGateSprite(key: string, size = 128): Promise<HTMLCanvasElement> {
    const level = rowPoses(LEVEL_PITCH_ROW)[LEVEL_BANK_COLUMN];
    return renderPoses(key, {
        camera: CHASE_CAMERA,
        poses: [level],
        framing: FRAME_GRID_POSES,
        width: size,
        height: size,
        idle: true,
    }).then(([frame]) => frame);
}

/** The ship at the official viewer's default angle, bow toward `facing`; rendered in idle time. */
export function renderViewerSprite(
    key: string,
    facing: 'left' | 'right',
    width = 400,
    height = 225
): Promise<HTMLCanvasElement> {
    return renderPoses(key, {
        camera: officialViewerCamera(facing),
        poses: [{ bankDeg: 0, pitchDeg: 0 }],
        width,
        height,
        idle: true,
    }).then(([frame]) => frame);
}
