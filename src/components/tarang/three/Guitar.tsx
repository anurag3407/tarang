"use client";

import { forwardRef, useMemo } from "react";
import * as THREE from "three";

/**
 * Procedural dreadnought acoustic guitar.
 *
 * Built entirely from three.js primitives so the hero ships no model files.
 * Local units: the body spans roughly y ∈ [-0.56, 0.50], the headstock tops
 * out near y = 1.55. The front (soundboard) faces +z.
 */

const BODY_DEPTH = 0.1;
const BEVEL = 0.014;
/** z of the soundboard surface once the body is centred on z = 0. */
const TOP = BODY_DEPTH / 2 + BEVEL;
const BOARD_Z = TOP + 0.012; // fretboard top surface
const NUT_Y = 1.25;
const SADDLE_Y = -0.25;
const BOARD_END_Y = 0.21;

function halfEllipse(y: number, cy: number, rx: number, ry: number) {
  const t = (y - cy) / ry;
  return Math.abs(t) >= 1 ? 0 : rx * Math.sqrt(1 - t * t);
}

/** Polynomial smooth-max: rounds the waist where the two bouts meet. */
function smax(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}

function bodyShape() {
  const yMin = -0.56;
  const yMax = 0.5;
  const n = 140;
  const right: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    // cosine spacing → denser samples at the rounded ends
    const y = yMin + ((yMax - yMin) * (1 - Math.cos((Math.PI * i) / n))) / 2;
    const lower = halfEllipse(y, -0.19, 0.44, 0.37);
    const upper = halfEllipse(y, 0.2, 0.355, 0.3);
    right.push(new THREE.Vector2(smax(lower, upper, 0.11), y));
  }
  const left = right
    .slice(1, -1)
    .reverse()
    .map((p) => new THREE.Vector2(-p.x, p.y));
  return new THREE.Shape([...right, ...left]);
}

function bodyGeometry() {
  const geo = new THREE.ExtrudeGeometry(bodyShape(), {
    depth: BODY_DEPTH,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: 0.012,
    bevelSegments: 6,
    curveSegments: 1,
  });
  geo.translate(0, 0, -BODY_DEPTH / 2);

  // Planar UVs over the body's footprint so the sunburst maps cleanly.
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(
      i,
      (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x),
      (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y)
    );
  }
  uv.needsUpdate = true;

  // ExtrudeGeometry puts both lids in group 0 (back lid first, then front).
  // Split them so the back can wear rosewood while the top wears the burst.
  const lids = geo.groups.find((g) => g.materialIndex === 0);
  if (lids) {
    const half = lids.count / 2;
    geo.groups = geo.groups.filter((g) => g !== lids);
    geo.addGroup(lids.start, half, 2);
    geo.addGroup(lids.start + half, half, 0);
  }
  return geo;
}

function sunburstTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const g = ctx.createRadialGradient(
    size * 0.5,
    size * 0.6,
    size * 0.02,
    size * 0.5,
    size * 0.55,
    size * 0.62
  );
  g.addColorStop(0, "#f4cf8c");
  g.addColorStop(0.38, "#e2a04f");
  g.addColorStop(0.62, "#a9561f");
  g.addColorStop(0.8, "#4a1b0a");
  g.addColorStop(1, "#160704");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Spruce grain: fine vertical lines of varying weight.
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * size;
    ctx.strokeStyle = `rgba(60, 25, 5, ${0.025 + Math.random() * 0.06})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(
      x + Math.random() * 6 - 3,
      size * 0.33,
      x + Math.random() * 6 - 3,
      size * 0.66,
      x + Math.random() * 4 - 2,
      size
    );
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // Canvas y runs down, UV v runs up — flip so the burst centre sits low.
  tex.flipY = false;
  return tex;
}

/** Box whose width tapers from `wBottom` (y = 0) to `wTop` (y = h). */
function taperedBox(wBottom: number, wTop: number, h: number, d: number) {
  const geo = new THREE.BoxGeometry(1, h, d);
  geo.translate(0, h / 2, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h;
    pos.setX(i, pos.getX(i) * THREE.MathUtils.lerp(wBottom, wTop, t));
  }
  geo.computeVertexNormals();
  return geo;
}

function headstockGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.048, 0);
  s.lineTo(-0.068, 0.2);
  s.quadraticCurveTo(-0.07, 0.25, -0.03, 0.255);
  s.quadraticCurveTo(0, 0.235, 0.03, 0.255);
  s.quadraticCurveTo(0.07, 0.25, 0.068, 0.2);
  s.lineTo(0.048, 0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 3,
    curveSegments: 16,
  });
  geo.translate(0, 0, -0.011);
  return geo;
}

function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r, r, len, 6, 1, true);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
    new THREE.Vector3(1, 1, 1)
  );
  geo.applyMatrix4(m);
  return geo;
}

export const Guitar = forwardRef<THREE.Group>(function Guitar(_, ref) {
  const parts = useMemo(() => {
    const burst = sunburstTexture();

    const mat = {
      top: new THREE.MeshPhysicalMaterial({
        map: burst,
        roughness: 0.32,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
      }),
      sides: new THREE.MeshPhysicalMaterial({
        color: "#2b130a",
        roughness: 0.38,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
      }),
      back: new THREE.MeshPhysicalMaterial({
        color: "#3a1a0c",
        roughness: 0.36,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
      }),
      mahogany: new THREE.MeshPhysicalMaterial({
        color: "#4a2412",
        roughness: 0.4,
        clearcoat: 0.8,
        clearcoatRoughness: 0.15,
      }),
      rosewood: new THREE.MeshStandardMaterial({ color: "#1d0f09", roughness: 0.62 }),
      bone: new THREE.MeshStandardMaterial({ color: "#efe6d2", roughness: 0.35 }),
      pearl: new THREE.MeshPhysicalMaterial({
        color: "#f3efe6",
        roughness: 0.15,
        iridescence: 1,
        iridescenceIOR: 1.6,
      }),
      nickel: new THREE.MeshStandardMaterial({ color: "#d9d6cf", metalness: 1, roughness: 0.22 }),
      brass: new THREE.MeshStandardMaterial({ color: "#d1aa6a", metalness: 1, roughness: 0.24 }),
      bronze: new THREE.MeshStandardMaterial({ color: "#b98d55", metalness: 1, roughness: 0.3 }),
      hole: new THREE.MeshBasicMaterial({ color: "#050302" }),
      cream: new THREE.MeshStandardMaterial({ color: "#e9dcc0", roughness: 0.4 }),
    };

    // Strings: six, fanning from the saddle to the nut.
    const strings = Array.from({ length: 6 }, (_, i) => {
      const t = i / 5 - 0.5;
      const a = new THREE.Vector3(t * 0.104, SADDLE_Y, TOP + 0.022);
      const b = new THREE.Vector3(t * 0.07, NUT_Y, BOARD_Z + 0.006);
      return {
        geo: cylinderBetween(a, b, 0.0034 - i * 0.00036),
        wound: i < 4,
      };
    });

    // Fret positions follow the equal-tempered rule of eighteen.
    const scale = NUT_Y - SADDLE_Y;
    const frets: number[] = [];
    for (let n = 1; n < 24; n++) {
      const y = NUT_Y - scale * (1 - Math.pow(2, -n / 12));
      if (y < BOARD_END_Y + 0.01) break;
      frets.push(y);
    }
    const fretWidthAt = (y: number) =>
      THREE.MathUtils.lerp(0.106, 0.088, (y - BOARD_END_Y) / (NUT_Y - BOARD_END_Y));
    const midFret = (n: number) => (frets[n - 2] + frets[n - 1]) / 2;
    const inlays = [3, 5, 7, 9, 15, 17]
      .filter((n) => n <= frets.length)
      .map((n) => ({ x: 0, y: midFret(n) }));
    if (frets.length >= 12) {
      inlays.push({ x: -0.022, y: midFret(12) }, { x: 0.022, y: midFret(12) });
    }

    return {
      mat,
      body: bodyGeometry(),
      board: taperedBox(0.106, 0.088, NUT_Y - BOARD_END_Y, 0.012),
      neck: (() => {
        const g = new THREE.CylinderGeometry(0.044, 0.05, 0.82, 28, 1, false, Math.PI / 2, Math.PI);
        g.scale(1, 1, 0.7);
        return g;
      })(),
      heel: new THREE.SphereGeometry(1, 32, 20),
      headstock: headstockGeometry(),
      strings,
      frets,
      fretWidthAt,
      inlays,
    };
  }, []);

  const { mat } = parts;

  return (
    <group ref={ref}>
      {/* Body */}
      <mesh geometry={parts.body} material={[mat.top, mat.sides, mat.back]} castShadow />

      {/* Sound hole + rosette */}
      <mesh position={[0, 0.12, TOP + 0.0008]} material={mat.hole}>
        <circleGeometry args={[0.074, 64]} />
      </mesh>
      <mesh position={[0, 0.12, TOP + 0.001]} material={mat.brass}>
        <ringGeometry args={[0.079, 0.091, 96]} />
      </mesh>
      <mesh position={[0, 0.12, TOP + 0.001]} material={mat.cream}>
        <ringGeometry args={[0.097, 0.101, 96]} />
      </mesh>
      <mesh position={[0, 0.12, TOP + 0.001]} material={mat.cream}>
        <ringGeometry args={[0.071, 0.0745, 96]} />
      </mesh>

      {/* Bridge, saddle and pins */}
      <mesh position={[0, SADDLE_Y - 0.012, TOP + 0.006]} material={mat.rosewood}>
        <boxGeometry args={[0.24, 0.05, 0.012]} />
      </mesh>
      <mesh position={[0, SADDLE_Y, TOP + 0.016]} material={mat.bone}>
        <boxGeometry args={[0.125, 0.005, 0.012]} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh
          key={i}
          position={[(i / 5 - 0.5) * 0.104, SADDLE_Y - 0.026, TOP + 0.013]}
          rotation={[Math.PI / 2, 0, 0]}
          material={mat.bone}
        >
          <cylinderGeometry args={[0.0055, 0.0055, 0.004, 16]} />
        </mesh>
      ))}

      {/* Neck (half-round back) + heel */}
      <mesh
        geometry={parts.neck}
        position={[0, 0.84, TOP - 0.002]}
        material={mat.mahogany}
      />
      <mesh
        geometry={parts.heel}
        position={[0, 0.5, -0.006]}
        scale={[0.048, 0.075, 0.062]}
        material={mat.mahogany}
      />

      {/* Fretboard, frets, inlays */}
      <mesh
        geometry={parts.board}
        position={[0, BOARD_END_Y, BOARD_Z - 0.006]}
        material={mat.rosewood}
      />
      {parts.frets.map((y) => (
        <mesh key={y} position={[0, y, BOARD_Z + 0.001]} rotation={[0, 0, Math.PI / 2]} material={mat.nickel}>
          <cylinderGeometry args={[0.0022, 0.0022, parts.fretWidthAt(y), 8]} />
        </mesh>
      ))}
      {parts.inlays.map((d) => (
        <mesh key={`${d.x}-${d.y}`} position={[d.x, d.y, BOARD_Z + 0.0004]} material={mat.pearl}>
          <circleGeometry args={[0.0075, 24]} />
        </mesh>
      ))}

      {/* Nut */}
      <mesh position={[0, NUT_Y, BOARD_Z + 0.003]} material={mat.bone}>
        <boxGeometry args={[0.09, 0.008, 0.01]} />
      </mesh>

      {/* Headstock — angled back a touch, with tuners */}
      <group position={[0, NUT_Y + 0.004, BOARD_Z - 0.014]} rotation={[-0.22, 0, 0]}>
        <mesh geometry={parts.headstock} material={mat.sides} />
        {[0.055, 0.115, 0.175].map((y) =>
          [-1, 1].map((side) => (
            <group key={`${y}-${side}`} position={[side * 0.038, y, 0]}>
              <mesh position={[0, 0, 0.022]} rotation={[Math.PI / 2, 0, 0]} material={mat.brass}>
                <cylinderGeometry args={[0.0075, 0.009, 0.02, 16]} />
              </mesh>
              <mesh position={[side * 0.05, 0, -0.018]} rotation={[0, 0, Math.PI / 2]} material={mat.brass}>
                <cylinderGeometry args={[0.004, 0.004, 0.05, 10]} />
              </mesh>
              <mesh position={[side * 0.08, 0, -0.018]} scale={[1, 1, 0.45]} material={mat.brass}>
                <sphereGeometry args={[0.016, 20, 14]} />
              </mesh>
            </group>
          ))
        )}
      </group>

      {/* Strings */}
      {parts.strings.map((s, i) => (
        <mesh key={i} geometry={s.geo} material={s.wound ? mat.bronze : mat.nickel} />
      ))}
    </group>
  );
});
