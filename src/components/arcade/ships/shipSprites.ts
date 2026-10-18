import * as THREE from 'three';
import { loadShipModel } from './shipModelLoader';
import { addShipLights } from './shipLighting';

/** Roll angles of the pre-rendered frames, left bank to right bank; the middle frame is level. */
export const BANK_ANGLES_DEG = [-30, -15, 0, 15, 30] as const;

/** Behind and slightly above the ship (whose nose points along +Z), looking at its centre. */
const CAMERA_POSITION = new THREE.Vector3(0, 0.45, -2.6);
const CAMERA_FOV_DEG = 30;
/** Share of the frame, edge to edge, that the widest banked pose's bounding box fills. */
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

/**
 * Renders the ship seen from behind at each of `BANK_ANGLES_DEG`, as transparent square
 * canvases in the same order. A positive angle dips the ship's right wing. Every frame shares
 * one zoom, chosen so the widest pose fills the frame; the ship therefore keeps its size while
 * banking and every ship fills its sprite alike.
 */
export async function renderShipSprites(key: string, size = 256): Promise<HTMLCanvasElement[]> {
    const model = await loadShipModel(key);
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, 20);
    camera.position.copy(CAMERA_POSITION);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const poses = BANK_ANGLES_DEG.map((deg) => {
        const ship = model.clone();
        ship.rotation.z = THREE.MathUtils.degToRad(deg);
        ship.updateMatrixWorld(true);
        return ship;
    });
    camera.zoom = FILL / Math.max(...poses.map((ship) => ndcExtent(ship, camera)));
    camera.updateProjectionMatrix();

    const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
    });
    let disposeLights = () => {};
    try {
        renderer.setPixelRatio(1);
        renderer.setSize(size, size, false);
        renderer.setClearColor(0x000000, 0);
        const scene = new THREE.Scene();
        disposeLights = addShipLights(scene, renderer);

        return poses.map((ship) => {
            scene.add(ship);
            renderer.render(scene, camera);
            scene.remove(ship);
            const frame = document.createElement('canvas');
            frame.width = size;
            frame.height = size;
            frame.getContext('2d')?.drawImage(renderer.domElement, 0, 0);
            return frame;
        });
    } finally {
        disposeLights();
        renderer.dispose();
        renderer.forceContextLoss();
    }
}
