import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ARCADE_LIGHT_ACCENT, lightRig, Vec3, VIEWER_RENDERER } from './lightRig';
import { officialViewerCamera } from './spritePoses';

/** Shadow map sizes for the key and rim lights. The viewer uses these for its thumbnails. */
export const SPRITE_SHADOW_MAPS = { key: 512, rim: 256 } as const;
/** And these for its interactive view. */
export const VIEW_SHADOW_MAPS = { key: 2048, rim: 1024 } as const;

export interface ShipLights {
    /** Turns the rig for a camera at `camera` (see `lightRig`); call before rendering with it. */
    aim(camera: Vec3): void;
    /** Frees the environment map and shadow maps; call before disposing the renderer. */
    dispose(): void;
}

/**
 * Lights a ship scene the way the official unit viewer does (see `lightRig` for the numbers):
 * ACES filmic tone mapping, soft self-shadows from the key and rim lights, a faint room
 * environment for the metal to reflect, and `accent` on the rim and accent lights. Sets the
 * renderer's tone mapping, colour space and shadow map, so it runs before the first compile.
 */
export function lightShipScene(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    shadowMaps: { key: number; rim: number },
    accent: number = ARCADE_LIGHT_ACCENT
): ShipLights {
    const r = VIEWER_RENDERER;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = r.toneMappingExposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, r.environmentSigma);
    room.dispose();
    pmrem.dispose();
    scene.environment = environment.texture;
    scene.environmentIntensity = r.environmentIntensity;

    const rig = lightRig(officialViewerCamera('left').position, accent);
    const lights = rig.directional.map((spec) => {
        const light = new THREE.DirectionalLight(spec.color, spec.intensity);
        const mapSize =
            spec.role === 'key' ? shadowMaps.key : spec.role === 'rim' ? shadowMaps.rim : 0;
        if (mapSize > 0) {
            light.castShadow = true;
            light.shadow.mapSize.set(mapSize, mapSize);
            const cam = light.shadow.camera;
            cam.near = r.shadowNear;
            cam.far = r.shadowFar;
            cam.left = -r.shadowExtent;
            cam.right = r.shadowExtent;
            cam.top = r.shadowExtent;
            cam.bottom = -r.shadowExtent;
            light.shadow.bias = r.shadowBias;
            light.shadow.normalBias = r.shadowNormalBias;
        }
        light.position.set(...spec.position);
        scene.add(light);
        return light;
    });
    scene.add(new THREE.AmbientLight(rig.ambient.color, rig.ambient.intensity));

    let aimedAt = officialViewerCamera('left').position.join();
    return {
        aim(camera) {
            const id = camera.join();
            if (id === aimedAt) return;
            aimedAt = id;
            lightRig(camera, accent).directional.forEach((spec, i) => {
                lights[i].position.set(...spec.position);
                lights[i].updateMatrixWorld();
            });
        },
        dispose() {
            environment.dispose();
            for (const light of lights) light.dispose();
        },
    };
}
