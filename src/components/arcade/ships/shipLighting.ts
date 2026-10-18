import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Lights a ship scene: a neutral room environment (the ORM metalness channel renders black
 * without something to reflect), a key light from above, and the arcade's pink and cyan rims.
 * Returns a function that frees the environment map; call it before disposing `renderer`.
 */
export function addShipLights(scene: THREE.Scene, renderer: THREE.WebGLRenderer): () => void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.6;
    pmrem.dispose();

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(1, 3, -2);
    scene.add(key);
    const pink = new THREE.DirectionalLight(0xff4fd8, 1.6);
    pink.position.set(-3, 0.5, 1);
    scene.add(pink);
    const cyan = new THREE.DirectionalLight(0x40f0ff, 1.6);
    cyan.position.set(3, 0.5, 1);
    scene.add(cyan);
    return () => environment.dispose();
}
