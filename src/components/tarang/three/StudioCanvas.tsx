"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { Guitar } from "./Guitar";

/**
 * Pose for each hero chapter. `e` (0 → 2) moves through them; between poses
 * the guitar also completes one full turn about its long axis.
 */
type Pose = { pos: [number, number, number]; rot: [number, number, number]; scale: number };

const DESKTOP: Pose[] = [
  { pos: [0, -0.06, 0], rot: [0.06, -0.38, 0.16], scale: 1 },
  { pos: [0.95, 0.02, 0.2], rot: [0.32, -0.25, -1.08], scale: 1.08 },
  { pos: [-0.85, -0.02, 0.9], rot: [-0.42, 0.42, 0.62], scale: 1.12 },
];

const MOBILE: Pose[] = [
  { pos: [0, 0.32, -0.6], rot: [0.06, -0.38, 0.12], scale: 0.86 },
  { pos: [0, 0.42, -0.4], rot: [0.32, -0.25, -1.3], scale: 0.84 },
  { pos: [0.3, 0.62, -1.1], rot: [-0.42, 0.42, 0.95], scale: 0.64 },
];

/** Centre of the instrument in its own coordinates (body bottom → headstock). */
const PIVOT_Y = 0.48;

function Rig({ progress }: { progress: RefObject<number> }) {
  const outer = useRef<THREE.Group>(null);
  const guitar = useRef<THREE.Group>(null);
  const { size, pointer } = useThree();
  const mobile = size.width < 768;
  const intro = useRef(0);

  useFrame((state, dt) => {
    const g = outer.current;
    if (!g) return;
    const poses = mobile ? MOBILE : DESKTOP;
    const e = THREE.MathUtils.clamp(progress.current ?? 0, 0, 2);
    const i = Math.min(Math.floor(e), 1);
    const f = e - i;
    const a = poses[i];
    const b = poses[i + 1];

    intro.current = THREE.MathUtils.damp(intro.current, 1, 1.6, dt);
    const t = state.clock.elapsedTime;
    const idle = Math.sin(t * 0.6) * 0.04;

    const target = {
      x: THREE.MathUtils.lerp(a.pos[0], b.pos[0], f),
      y: THREE.MathUtils.lerp(a.pos[1], b.pos[1], f) + Math.sin(t * 0.8) * 0.03,
      z: THREE.MathUtils.lerp(a.pos[2], b.pos[2], f) - (1 - intro.current) * 1.4,
      rx: THREE.MathUtils.lerp(a.rot[0], b.rot[0], f) - pointer.y * 0.08,
      ry:
        THREE.MathUtils.lerp(a.rot[1], b.rot[1], f) +
        e * Math.PI * 2 +
        idle +
        pointer.x * 0.14 -
        (1 - intro.current) * 1.2,
      rz: THREE.MathUtils.lerp(a.rot[2], b.rot[2], f),
      s: THREE.MathUtils.lerp(a.scale, b.scale, f),
    };

    const k = 4.5;
    g.position.x = THREE.MathUtils.damp(g.position.x, target.x, k, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, target.y, k, dt);
    g.position.z = THREE.MathUtils.damp(g.position.z, target.z, k, dt);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, target.rx, k, dt);
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, target.ry, k, dt);
    g.rotation.z = THREE.MathUtils.damp(g.rotation.z, target.rz, k, dt);
    g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, target.s, k, dt));
  });

  return (
    <group ref={outer} rotation={[0.06, -1.6, 0.16]} position={[0, -0.06, -1.4]}>
      <group position={[0, -PIVOT_Y, 0]}>
        <Guitar ref={guitar} />
      </group>
    </group>
  );
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.08} />
      {/* warm key, top-right */}
      <directionalLight position={[3, 4, 5]} intensity={2.4} color="#ffe2b8" />
      {/* brass rim from behind-left — draws the silhouette against the ink */}
      <directionalLight position={[-4, 2, -4]} intensity={3.2} color="#d6a75f" />
      {/* cool kicker from below-right */}
      <directionalLight position={[4, -3, -2]} intensity={1.1} color="#9fb4ff" />
      <Environment resolution={256} frames={1}>
        <group rotation={[0, 0, 0]}>
          {/* overhead softbox */}
          <Lightformer form="rect" intensity={2.2} position={[0, 5, 2]} rotation-x={Math.PI / 2} scale={[8, 3, 1]} />
          {/* tall strip softboxes either side — they read as long highlights on the lacquer */}
          <Lightformer form="rect" intensity={3} position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[1.2, 8, 1]} color="#ffe6c4" />
          <Lightformer form="rect" intensity={1.6} position={[5, 1, 1]} rotation-y={-Math.PI / 2} scale={[1.2, 8, 1]} />
          <Lightformer form="ring" intensity={1.2} position={[0, 0, -6]} scale={4} color="#c9a46a" />
        </group>
      </Environment>
    </>
  );
}

export default function StudioCanvas({
  progress,
  active,
}: {
  progress: RefObject<number>;
  active: boolean;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={active ? "always" : "never"}
      camera={{ position: [0, 0, 6], fov: 30, near: 0.1, far: 50 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{
        opacity: ready ? 1 : 0,
        transition: "opacity 1.6s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <Lights />
      <Rig progress={progress} />
      <Sparkles count={70} scale={[7, 4.5, 3]} size={1.6} speed={0.18} opacity={0.35} color="#c9a46a" />
    </Canvas>
  );
}
