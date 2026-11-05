// Draws a plan with some quads of its domes painted red. A quad is picked by its direction from the sphere center:
// elevation (degrees, from the equator) and azimuth (degrees, 0 = front +z, positive toward +x).
import * as THREE from "three";
import { buildShapeGeometry } from "../vendor/packages/asset-format/src/geometry.ts";

function paintedView(plan: any, center: number[], pick: (elev: number, az: number) => boolean, from: number[], target: number[], half: number): string {
  const W = 800, H = 600;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#7fbf5a");
  scene.add(new THREE.HemisphereLight("#ffffff", "#8080a0", 2.0));
  const sun = new THREE.DirectionalLight("#ffffff", 1.5);
  sun.position.set(-0.4, 1, 0.6);
  scene.add(sun);
  const colors = new Map(plan.textures.map((s: any) => [s.name, s.color]));
  const c = new THREE.Vector3(...(center as [number, number, number]));
  for (const shape of plan.shapes) {
    const faces = Object.fromEntries(shape.faces.map((f: any) => [f.face, f.texture]));
    const { geometry, groups } = buildShapeGeometry({ tilt: 0, ...shape });
    const mesh = new THREE.Mesh(geometry);
    mesh.position.set(...(shape.position as [number, number, number]));
    mesh.rotation.order = "YXZ";
    mesh.rotation.set(THREE.MathUtils.degToRad(shape.tilt ?? 0), THREE.MathUtils.degToRad(shape.rotationY), 0);
    mesh.updateMatrixWorld();
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    const faceOf = (i: number) => groups.find((gr: any) => i >= gr.start && i < gr.start + gr.count)?.face;
    for (let i = 0; i < pos.count; i += 3) {
      const m = new THREE.Vector3();
      for (let k = 0; k < 3; k++) m.add(new THREE.Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrixWorld));
      m.divideScalar(3).sub(c);
      const elev = THREE.MathUtils.radToDeg(Math.asin(m.y / m.length()));
      const az = THREE.MathUtils.radToDeg(Math.atan2(m.x, m.z));
      const face = faceOf(i);
      const base = new THREE.Color((colors.get(faces[face]) as string) ?? "#ff00ff");
      const color = face === "side" && pick(elev, az) ? new THREE.Color("#e01818") : base;
      for (let k = 0; k < 3; k++) col.set([color.r, color.g, color.b], (i + k) * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.clearGroups();
    const painted = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    painted.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 10), new THREE.LineBasicMaterial({ color: "#303048" })));
    painted.position.copy(mesh.position);
    painted.rotation.copy(mesh.rotation);
    scene.add(painted);
  }
  const camera = new THREE.OrthographicCamera(-half, half, (half * H) / W, (-half * H) / W, 0.1, 400);
  const t = new THREE.Vector3(...(target as [number, number, number]));
  camera.position.copy(t).addScaledVector(new THREE.Vector3(...(from as [number, number, number])).normalize(), 50);
  camera.lookAt(t);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  renderer.dispose();
  return url;
}
Object.assign(window, { paintedView });

// The sphere of a plan with a door cut out of its mesh: the quads picked by (elevation, azimuth) around `center`
// turn around a hinge line along x at (hinge[0] = y, hinge[1] = z) by `angle` degrees (positive: the top falls forward).
// Flat colors (no texture): hull, inside, and a round porthole on the door (glass in a frame), placed by its
// elevation (degrees) on the front, with angular radii in degrees.
type Look = { hull: string; inside: string; frame: string; glass: string; portElev: number; frameDeg: number; glassDeg: number };
function porthole(base: string, look: Look, center: THREE.Vector3) {
  const m = new THREE.MeshLambertMaterial({ color: base });
  const e = THREE.MathUtils.degToRad(look.portElev);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCenter = { value: center };
    sh.uniforms.uAxis = { value: new THREE.Vector3(0, Math.sin(e), Math.cos(e)) };
    sh.uniforms.uFrame = { value: Math.cos(THREE.MathUtils.degToRad(look.frameDeg)) };
    sh.uniforms.uGlass = { value: Math.cos(THREE.MathUtils.degToRad(look.glassDeg)) };
    sh.uniforms.uFrameColor = { value: new THREE.Color(look.frame) };
    sh.uniforms.uGlassColor = { value: new THREE.Color(look.glass) };
    sh.vertexShader = "varying vec3 vObj;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvObj = position;");
    sh.fragmentShader = "varying vec3 vObj;\nuniform vec3 uCenter, uAxis, uFrameColor, uGlassColor;\nuniform float uFrame, uGlass;\n" +
      sh.fragmentShader.replace("vec4 diffuseColor = vec4( diffuse, opacity );",
        "float k = dot(normalize(vObj - uCenter), uAxis);\nvec3 col = k > uGlass ? uGlassColor : (k > uFrame ? uFrameColor : diffuse);\nvec4 diffuseColor = vec4( col, opacity );");
  };
  return m;
}

function doorView(plan: any, center: number[], box: number[], hinge: number[], angle: number, from: number[], target: number[], half: number, look: Look): string {
  const [eMin, eMax, aMax] = box;
  const W = 800, H = 600;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#7fbf5a");
  scene.add(new THREE.HemisphereLight("#ffffff", "#8080a0", 2.0));
  const sun = new THREE.DirectionalLight("#ffffff", 1.5);
  sun.position.set(-0.4, 1, 0.6);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: "#7fbf5a" }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const colors = new Map(plan.textures.map((s: any) => [s.name, s.color]));
  const c = new THREE.Vector3(...(center as [number, number, number]));
  const body: number[] = [], door: number[] = [];
  let hull = "#dfe4e6";
  for (const shape of plan.shapes) {
    const faces = Object.fromEntries(shape.faces.map((f: any) => [f.face, f.texture]));
    hull = (colors.get(faces.side) as string) ?? hull;
    const { geometry, groups } = buildShapeGeometry({ tilt: 0, ...shape });
    const mesh = new THREE.Mesh(geometry);
    mesh.position.set(...(shape.position as [number, number, number]));
    mesh.rotation.order = "YXZ";
    mesh.rotation.set(THREE.MathUtils.degToRad(shape.tilt ?? 0), THREE.MathUtils.degToRad(shape.rotationY), 0);
    mesh.updateMatrixWorld();
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.getAttribute("position");
    const faceOf = (i: number) => groups.find((gr: any) => i >= gr.start && i < gr.start + gr.count)?.face;
    for (let i = 0; i < pos.count; i += 3) {
      if (faceOf(i) !== "side") continue;   // the flat bottoms of the 2 halves are inside the sphere
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrixWorld));
      const m = v[0].clone().add(v[1]).add(v[2]).divideScalar(3).sub(c);
      const elev = THREE.MathUtils.radToDeg(Math.asin(m.y / m.length()));
      const az = THREE.MathUtils.radToDeg(Math.atan2(m.x, m.z));
      const target = elev > eMin && elev < eMax && Math.abs(az) < aMax ? door : body;
      for (const p of v) target.push(p.x, p.y, p.z);
    }
  }
  const make = (arr: number[], isDoor: boolean) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    const group = new THREE.Group();
    const outside = isDoor ? porthole(look.hull, look, c) : new THREE.MeshLambertMaterial({ color: look.hull });
    const inside = isDoor ? porthole(look.inside, look, c) : new THREE.MeshLambertMaterial({ color: look.inside });
    outside.side = THREE.FrontSide;
    inside.side = THREE.BackSide;
    group.add(new THREE.Mesh(g, outside), new THREE.Mesh(g, inside));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 40), new THREE.LineBasicMaterial({ color: "#26283a" })));
    return group;
  };
  scene.add(make(body, false));
  const pivot = new THREE.Group();
  pivot.position.set(0, hinge[0], hinge[1]);
  const doorMesh = make(door, true);
  doorMesh.position.set(0, -hinge[0], -hinge[1]);
  pivot.add(doorMesh);
  pivot.rotation.x = THREE.MathUtils.degToRad(angle);
  scene.add(pivot);
  const camera = new THREE.OrthographicCamera(-half, half, (half * H) / W, (-half * H) / W, 0.1, 400);
  const t = new THREE.Vector3(...(target as [number, number, number]));
  camera.position.copy(t).addScaledVector(new THREE.Vector3(...(from as [number, number, number])).normalize(), 50);
  camera.lookAt(t);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  renderer.dispose();
  return url;
}
Object.assign(window, { doorView });
