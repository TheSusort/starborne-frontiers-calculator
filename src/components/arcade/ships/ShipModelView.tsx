import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { loadShipModel } from './shipModelLoader';
import { addShipLights } from './shipLighting';
import { pinModel } from './modelPins';

interface ShipModelViewProps {
    visualKey: string;
    /** Shown while the model loads and in its place if loading fails. */
    fallback: React.ReactNode;
}

const HEIGHT_PX = 192;
const CAMERA_POSITION = new THREE.Vector3(0, 0.8, 2.7);
const TURN_RADIANS_PER_SECOND = 0.6;
/** Three-quarter front view, used as the still pose under reduced motion. */
const STILL_YAW = Math.PI / 5;

/**
 * The ship's official model turning slowly on its vertical axis. Each key gets its own
 * renderer and canvas, released on unmount or key change.
 */
const ShipModelView: React.FC<ShipModelViewProps> = ({ visualKey, fallback }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

    // The shown model stays in the model cache.
    useEffect(() => pinModel(visualKey), [visualKey]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let cancelled = false;
        let raf = 0;
        let renderer: THREE.WebGLRenderer | null = null;
        let disposeLights = () => {};
        setState('loading');

        loadShipModel(visualKey)
            .then((model) => {
                if (cancelled) return;
                // The container is hidden until the model is ready, so its parent gives the width.
                const width = container.parentElement?.clientWidth || HEIGHT_PX;
                renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                renderer.setSize(width, HEIGHT_PX);
                renderer.setClearColor(0x000000, 0);
                renderer.domElement.style.display = 'block';
                renderer.domElement.setAttribute('aria-hidden', 'true');
                container.appendChild(renderer.domElement);

                const scene = new THREE.Scene();
                disposeLights = addShipLights(scene, renderer);
                const camera = new THREE.PerspectiveCamera(30, width / HEIGHT_PX, 0.1, 20);
                camera.position.copy(CAMERA_POSITION);
                camera.lookAt(0, 0, 0);
                const ship = model.clone();
                ship.rotation.y = STILL_YAW;
                scene.add(ship);

                const draw = renderer;
                if (reducedMotion) {
                    draw.render(scene, camera);
                } else {
                    let last = performance.now();
                    const frame = (now: number) => {
                        ship.rotation.y += ((now - last) / 1000) * TURN_RADIANS_PER_SECOND;
                        last = now;
                        draw.render(scene, camera);
                        raf = requestAnimationFrame(frame);
                    };
                    raf = requestAnimationFrame(frame);
                }
                setState('ready');
            })
            .catch(() => {
                if (!cancelled) setState('failed');
            });

        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
            if (renderer) {
                disposeLights();
                renderer.domElement.remove();
                renderer.dispose();
                renderer.forceContextLoss();
            }
        };
    }, [visualKey, reducedMotion]);

    return (
        <>
            <div ref={containerRef} className={state === 'ready' ? 'h-48' : 'hidden'} />
            {state !== 'ready' && fallback}
        </>
    );
};

export default ShipModelView;
