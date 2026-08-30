import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";

// ---------------------------------------------------------------------------
// Atmosphere-only WebGL layer behind the Home page.
//
// The food imagery is the hero (layered CSS planes, see HomePage). This layer
// exists purely to add a faint, warm dust ambience:
//   - a SINGLE sparse dust field (like dust in a shaft of restaurant light),
//   - a slow camera drift tied to scroll progress + pointer,
//   - frameloop="demand" so a static page costs ~0 GPU work.
// No geometry, no polygons, no rings — nothing that reads as a "3D demo".
// ---------------------------------------------------------------------------

function buildPositions(count, spread, depth) {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = 1.8 + Math.random() * spread;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.5;
    arr[i * 3 + 2] = -Math.random() * depth;
  }
  return arr;
}

function Dust({ count, size = 0.05, opacity = 0.18, spread = 8, depth = 10 }) {
  const positions = useMemo(() => buildPositions(count, spread, depth), [count, spread, depth]);
  return (
    <Points positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        color="#e9dcbf"
        size={size}
        sizeAttenuation
        depthWrite={false}
        opacity={opacity}
        blending={THREE.AdditiveBlending}
      />
    </Points>
  );
}

function useRigControl() {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  return useMemo(() => ({ invalidate, camera }), [invalidate, camera]);
}

function Bridge({ onReady }) {
  const rig = useRigControl();
  useEffect(() => {
    onReady(rig);
    return () => onReady(null);
  }, [onReady, rig]);
  return null;
}

function DustRig({ stateRef, mobile }) {
  const group = useRef();
  const camera = useThree((s) => s.camera);
  const cameraRef = useRef(null);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useFrame(() => {
    const s = stateRef.current;
    const cam = cameraRef.current;
    if (!cam) return;

    const targetZ = 8 - s.progress * (mobile ? 1.2 : 2);
    const targetX = s.px * (mobile ? 0.08 : 0.16);
    const targetY = s.py * (mobile ? 0.06 : 0.12);
    cam.position.x += (targetX - cam.position.x) * 0.05;
    cam.position.y += (targetY - cam.position.y) * 0.05;
    cam.position.z += (targetZ - cam.position.z) * 0.08;
    cam.lookAt(0, 0, 0);

    if (group.current) {
      // Barely-there parallax of the dust volume with the pointer.
      group.current.position.x = s.px * 0.3;
      group.current.position.y = s.py * 0.2;
    }
  });

  return (
    <group ref={group}>
      <Dust count={mobile ? 14 : 40} />
    </group>
  );
}

// apiRef shape: { setProgress(p), setPointer(x, y) }
export default function CinematicScene({ apiRef, tier, mobile, reducedMotion, className = "" }) {
  const stateRef = useRef({ progress: 0, px: 0, py: 0 });
  const rigRef = useRef(null);

  const onReady = useCallback((rig) => {
    rigRef.current = rig;
    if (rig) rig.invalidate();
  }, []);

  const api = useMemo(
    () => ({
      setProgress: (progress) => {
        stateRef.current.progress = progress;
        rigRef.current?.invalidate();
      },
      setPointer: (x, y) => {
        stateRef.current.px = x;
        stateRef.current.py = y;
        rigRef.current?.invalidate();
      },
    }),
    []
  );

  useEffect(() => {
    if (apiRef) apiRef.current = api;
    return () => {
      if (apiRef) apiRef.current = null;
    };
  }, [api, apiRef]);

  if (reducedMotion || !tier || tier === "low") return null;

  return (
    <div className={`cine-canvas-stage ${className}`.trim()} aria-hidden="true">
      <Canvas
        frameloop="demand"
        dpr={tier === "high" ? [1, 1.75] : [1, 1.4]}
        gl={{ alpha: true, antialias: tier === "high", powerPreference: "high-performance", stencil: false }}
        camera={{ position: [0, 0, 8], fov: 45, near: 0.1, far: 80 }}
      >
        <ambientLight intensity={0.6} />
        <Bridge onReady={onReady} />
        <DustRig stateRef={stateRef} mobile={mobile} />
      </Canvas>
    </div>
  );
}