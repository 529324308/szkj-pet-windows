// SPDX-License-Identifier: GPL-3.0-only
// Derived from ElloboDK/KeyCat, web/cat.js. Modified for SZKJ Pet.
// 猫本体（移植自 KeyCat web/cat.js）：大圆头、短豆身、尾巴、后爪与两条手臂。
import * as THREE from 'three';
import { K } from './core.js';

export function initCat() {
  const { V, mix, smooth } = K;
  const fur = {
    head: K.furMaterial('HEAD'), body: K.furMaterial('BODY'), tail: K.furMaterial('TAIL'),
    ears: [K.furMaterial('EAR', -1), K.furMaterial('EAR', 1)], arms: [K.furMaterial('ARM', -1), K.furMaterial('ARM', 1)],
  };
  const rimMat = K.back('#f6f3e8');
  rimMat.depthWrite = false;
  const armRimMat = K.withArmRootPush(K.back('#8a8984'));
  const pawMat = K.flat('#f7f6f0');
  const pawRimMat = K.back('#8f8f8a');
  pawRimMat.depthWrite = false;
  const overlay = color => new THREE.MeshBasicMaterial({ color, depthTest: false });
  const toeMat = overlay('#b9b7ae');
  const shineMat = overlay('#ffffff');
  const eyeMats = [overlay('#dcb64a'), overlay('#dcb64a')];
  const lidMat = overlay('#dcb64a');
  const pupilMat = overlay('#141414');
  const whiskerMat = overlay('#dedcd4');
  const noseMat = overlay('#2a2a2a');
  const mouthMat = overlay('#2a2a2a');
  const blushMat = new THREE.MeshBasicMaterial({ color: '#f08a8a', transparent: true, opacity: 0, depthTest: false });

  const body = new THREE.Group();
  const HOME = V(0.02, 0, 0.05);
  body.position.copy(HOME);
  K.scene.add(body);

  const BODY_H = 1.32;
  const outline = new THREE.CatmullRomCurve3([[0, 0], [0.44, 0.005], [0.58, 0.08], [0.63, 0.26], [0.615, 0.48],
    [0.565, 0.7], [0.5, 0.9], [0.43, 1.06], [0.34, 1.2], [0.2, 1.29], [0, BODY_H]].map(([r, y]) => V(r, y, 0)),
    false, 'centripetal');
  const profile = outline.getSpacedPoints(48).map(q => new THREE.Vector2(Math.max(0, q.x), q.y));
  profile[0].x = 0; profile[profile.length - 1].x = 0;
  const bodyGeo = new THREE.LatheGeometry(profile, 72);
  bodyGeo.setAttribute('rest', bodyGeo.attributes.position.clone());
  const bodyMesh = new THREE.Mesh(bodyGeo, fur.body);
  bodyMesh.scale.set(1, 1, 0.82);
  const rimGeo = bodyGeo.clone();
  const bodyRim = new THREE.Mesh(rimGeo, rimMat);
  bodyRim.scale.set(1.045, 1.018, 0.86);
  bodyRim.renderOrder = -1;
  body.add(bodyRim, bodyMesh);

  const bend = { x: 0, z: 0, squash: 0 };
  const spineWeight = y => smooth(0.15, BODY_H, y) ** 1.6;
  const sink = y => smooth(0.2, BODY_H, y);
  const rest = [bodyGeo, rimGeo].map(g => Float32Array.from(g.attributes.position.array));
  function bendBody() {
    [[bodyGeo, bodyMesh], [rimGeo, bodyRim]].forEach(([g, mesh], gi) => {
      const src = rest[gi], pos = g.attributes.position.array, sx = mesh.scale.x, sz = mesh.scale.z;
      for (let i = 0; i < pos.length; i += 3) {
        const y = src[i + 1], w = spineWeight(y);
        pos[i] = src[i] + bend.x * w / sx;
        pos[i + 1] = y * (1 - bend.squash * sink(y));
        pos[i + 2] = src[i + 2] + bend.z * w / sz;
      }
      g.attributes.position.needsUpdate = true;
      g.computeBoundingSphere();
    });
  }

  function placeCollar() {
    if (!collar.visible) return;
    const y = COLLAR_Y - 0.3 * K.clamp(headPivot.rotation.x + 0.1, 0, 0.6);
    const s = radiusAt(y) / collarR;
    collar.scale.set(s, 1, s);
    const w = spineWeight(y), dw = (spineWeight(y + 0.01) - spineWeight(y - 0.01)) / 0.02;
    collar.position.set(bend.x * w, y * (1 - bend.squash * sink(y)), bend.z * w);
    const tx = K.clamp(Math.atan(bend.z * dw) * 0.5, -0.18, 0.18), tz = K.clamp(-Math.atan(bend.x * dw) * 0.5, -0.18, 0.18);
    collar.rotation.set(tx, 0, tz);
    bell.rotation.set(-tx, 0, -tz);
  }
  function attach(local, out) {
    const w = spineWeight(local.y);
    body.updateMatrixWorld();
    return out.set(local.x + bend.x * w, local.y * (1 - bend.squash * sink(local.y)), local.z + bend.z * w)
      .applyMatrix4(body.matrixWorld);
  }

  const pawGeo = new THREE.SphereGeometry(1, 32, 20);
  {
    const q = pawGeo.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const x = q.getX(i), y = q.getY(i), z = q.getZ(i);
      q.setXYZ(i, x * (1 + 0.12 * z), y < 0 ? y * 0.45 : y, z);
    }
  }
  const toeGeo = new THREE.PlaneGeometry(0.03, 0.34);
  toeGeo.rotateX(-Math.PI / 2);
  function makePaw(parent, order) {
    const paw = new THREE.Mesh(pawGeo, pawMat);
    paw.renderOrder = order + 2;
    const rim = new THREE.Mesh(pawGeo, pawRimMat);
    rim.renderOrder = order - 2;
    for (const x of [-0.3, 0.3]) {
      const toe = new THREE.Mesh(toeGeo, toeMat);
      toe.position.set(x, 0.66, 0.72);
      toe.renderOrder = order + 3;
      paw.add(toe);
    }
    parent.add(rim, paw);
    return { paw, rim };
  }
  const hind = [-1, 1].map(s => {
    const { paw, rim } = makePaw(body, 0);
    paw.scale.set(0.17, 0.1, 0.15);
    paw.position.set(s * 0.44, 0.06, 0.4);
    paw.rotation.y = s * 0.25;
    rim.scale.set(0.186, 0.114, 0.166);
    rim.position.copy(paw.position);
    rim.rotation.copy(paw.rotation);
    return paw;
  });

  const headPivot = new THREE.Group();
  headPivot.position.set(0, BODY_H - 0.12, 0.06);
  body.add(headPivot);

  const COLLAR_Y = 1.13;
  const outlinePts = outline.getSpacedPoints(400);
  const radiusAt = y => outlinePts.reduce((best, q) => Math.abs(q.y - y) < Math.abs(best.y - y) ? q : best).x;
  const collarR = radiusAt(COLLAR_Y);
  const COLLAR_LIFT = 0.07;
  const [collarMat, collarRimMat, bellMat, bellRimMat] = [K.flat('#d9483b'), K.back('#1d1d1b'), K.flat('#e8b93a'), K.back('#1d1d1b')]
    .map(m => K.towardEye(m, COLLAR_LIFT));
  const collar = new THREE.Group();
  const band = K.limb(collar, { segments: 40, radial: 8, fill: collarMat, outline: collarRimMat, order: 1,
    edge: t => 0.01 * smooth(0, 0.22, Math.min(t, 1 - t)) });
  band.update((t, out) => {
    const a = mix(-1.3, 1.3, t);
    return out.set(Math.sin(a) * (collarR + 0.004), 0.012 * (1 - Math.cos(a)), Math.cos(a) * (collarR + 0.004) * 0.82);
  }, t => 0.032 * (0.25 + 0.75 * smooth(0, 0.22, Math.min(t, 1 - t))));
  const bell = new THREE.Group();
  {
    const R_BELL = 0.064;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(R_BELL, 24, 16), bellMat);
    const ballRim = new THREE.Mesh(new THREE.SphereGeometry(R_BELL + 0.012, 24, 16), bellRimMat);
    const decal = color => {
      const m = K.towardEye(K.flat(color), COLLAR_LIFT);
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
      return m;
    };
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.013), decal('#1d1d1b'));
    slit.position.set(0, -0.022, Math.sqrt(R_BELL ** 2 - 0.022 ** 2) + 0.002);
    slit.rotation.x = -0.33;
    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.015, 12), decal('#fff6d8'));
    glint.position.set(-0.022, 0.024, Math.sqrt(R_BELL ** 2 - 0.022 ** 2 - 0.024 ** 2) + 0.002);
    glint.rotation.set(-0.35, -0.35, 0);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.007, 8, 16), K.towardEye(K.flat('#1d1d1b'), COLLAR_LIFT));
    loop.position.y = R_BELL + 0.01;
    const hang = new THREE.Group();
    hang.position.y = -(R_BELL + 0.018);
    hang.add(ballRim, ball, slit, glint, loop);
    bell.add(hang);
    bell.position.set(0, -0.012, (collarR + 0.04) * 0.82);
  }
  collar.add(bell);
  collar.visible = false;
  body.add(collar);
  const head = new THREE.Group();
  head.position.set(0, 0.42, 0.04);
  headPivot.add(head);
  const R = V(0.56, 0.47, 0.47);
  const headGeo = new THREE.SphereGeometry(1, 64, 44);
  const p = headGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const cheek = 1 + 0.08 * Math.exp(-(((y + 0.38) / 0.4) ** 2)) - 0.08 * (y + 0.2);
    p.setXYZ(i, p.getX(i) * cheek, y > 0 ? y * (1 - 0.06 * y) : y * 0.96, p.getZ(i));
  }
  headGeo.computeVertexNormals();
  const headMesh = new THREE.Mesh(headGeo, fur.head);
  headMesh.scale.copy(R);
  const headRim = new THREE.Mesh(headGeo, rimMat);
  headRim.scale.set(R.x + 0.024, R.y + 0.024, R.z + 0.02);
  headRim.renderOrder = -1;
  const chinMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#151515') }, uWidth: { value: 0.05 } },
    side: THREE.BackSide,
    vertexShader: `
      uniform float uWidth;
      void main() {
        float w = uWidth * (1.0 - smoothstep(-0.55, 0.05, position.y));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * w, 1.0);
      }`,
    fragmentShader: `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`,
  });
  const chinLine = new THREE.Mesh(headGeo, chinMat);
  chinLine.scale.copy(R);
  head.add(headRim, chinLine, headMesh);

  const earPts = [[0.28, -0.06], [0.255, 0.02], [0.225, 0.1], [0.185, 0.19], [0.135, 0.27], [0.08, 0.33], [0.035, 0.36], [0, 0.37]];
  const earLathe = grow => {
    const pts = earPts.map(([r, y], i) => new THREE.Vector2(r + grow, y + grow * (i / (earPts.length - 1)) ** 2));
    pts.unshift(new THREE.Vector2(0, -0.06));
    return new THREE.LatheGeometry(new THREE.SplineCurve(pts).getSpacedPoints(30), 40);
  };
  const earGeo = earLathe(0), earRimGeo = earLathe(0.026);
  const ears = [-1, 1].map(s => {
    const g = new THREE.Group();
    g.position.set(s * 0.26, 0.21, -0.06);
    g.rotation.set(-0.12, 0, -s * 0.2);
    g.scale.set(1, 1.12, 1);
    const e = new THREE.Mesh(earGeo, fur.ears[s < 0 ? 0 : 1]);
    e.scale.set(1, 1, 0.5);
    const r = new THREE.Mesh(earRimGeo, rimMat);
    r.scale.set(1, 1, 0.5 + 0.06);
    r.renderOrder = -1;
    g.add(r, e);
    head.add(g);
    return { group: g, mesh: e, s };
  });

  const disc = new THREE.CircleGeometry(1, 36);
  const eyes = [-1, 1].map(s => {
    const lx = s * 0.235, ly = 0.04;
    const lz = R.z * Math.sqrt(Math.max(0, 1 - (lx / R.x) ** 2 - (ly / R.y) ** 2));
    const g = new THREE.Group();
    g.position.set(lx, ly, lz + 0.005);
    const normal = V(lx / (R.x * R.x), ly / (R.y * R.y), lz / (R.z * R.z)).normalize();
    g.quaternion.setFromUnitVectors(V(0, 0, 1), normal);
    const eyeMat = eyeMats[s < 0 ? 0 : 1];
    const iris = new THREE.Mesh(disc, eyeMat);
    iris.scale.set(0.155, 0.14, 1);
    iris.renderOrder = 10;
    const pupil = new THREE.Mesh(disc, pupilMat);
    pupil.scale.set(0.05, 0.11, 1);
    pupil.position.z = 0.002;
    pupil.renderOrder = 11;
    const shine = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(disc, shineMat);
      d.renderOrder = 12;
      shine.add(d);
    }
    const arc = new K.TaperTube(16, 6, lidMat, 11);
    arc.update((t, out) => out.set(mix(-0.12, 0.12, t), -0.045 * Math.sin(t * Math.PI), 0.004),
      t => 0.011 + 0.006 * Math.sin(t * Math.PI));
    arc.mesh.visible = false;
    g.add(iris, pupil, shine, arc.mesh);
    const blush = new THREE.Mesh(disc, blushMat);
    blush.scale.set(0.085, 0.048, 1);
    blush.position.set(s * 0.06, -0.15, 0.001);
    blush.renderOrder = 10;
    g.add(blush);
    head.add(g);
    return { s, group: g, iris, pupil, shine, arc: arc.mesh };
  });

  const whiskers = [];
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const tube = new K.TaperTube(10, 4, whiskerMat, 12);
    const y0 = -0.17 - i * 0.04, a = V(s * 0.31, y0, 0.4), c = V(s * 0.54, y0 + 0.012 - i * 0.014, 0.29),
      b = V(s * 0.74, y0 - 0.015 - i * 0.055, 0.13);
    tube.update((t, out) => out.set(
      (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
      (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
      (1 - t) ** 2 * a.z + 2 * (1 - t) * t * c.z + t * t * b.z), t => 0.006 * (1 - 0.5 * t));
    head.add(tube.mesh);
    whiskers.push(tube.mesh);
  }

  const faceZ = (x, y) => R.z * Math.sqrt(Math.max(0, 1 - (x / R.x) ** 2 - (y / R.y) ** 2));
  const face = new THREE.Group();
  {
    const NY = -0.15, nose = new THREE.Shape();
    nose.moveTo(-0.045, 0.012);
    nose.quadraticCurveTo(0, 0.026, 0.045, 0.012);
    nose.quadraticCurveTo(0.05, 0.004, 0.012, -0.024);
    nose.quadraticCurveTo(0, -0.032, -0.012, -0.024);
    nose.quadraticCurveTo(-0.05, 0.004, -0.045, 0.012);
    const noseMesh = new THREE.Mesh(new THREE.ShapeGeometry(nose, 10), noseMat);
    noseMesh.position.set(0, NY, faceZ(0, NY) + 0.006);
    noseMesh.quaternion.setFromUnitVectors(V(0, 0, 1), V(0, NY / (R.y * R.y), faceZ(0, NY) / (R.z * R.z)).normalize());
    noseMesh.renderOrder = 12;
    const mouth = new K.TaperTube(24, 4, mouthMat, 12);
    mouth.update((t, out) => {
      const x = mix(-0.07, 0.07, t), y = NY - 0.035 - 0.022 * Math.sin(Math.abs(x) / 0.07 * Math.PI);
      return out.set(x, y, faceZ(x, y) + 0.006);
    }, () => 0.0055);
    face.add(noseMesh, mouth.mesh);
  }
  head.add(face);

  const tailPts = [V(0.42, 0.42, -0.25), V(0.72, 0.28, -0.3), V(0.96, 0.36, -0.32), V(1.05, 0.56, -0.3),
    V(1.12, 0.7, -0.28), V(1.3, 0.7, -0.26)];
  const tailSleep = [V(0.42, 0.12, -0.25), V(0.85, 0.1, -0.15), V(1.05, 0.1, 0.1), V(1.0, 0.1, 0.35),
    V(0.82, 0.1, 0.5), V(0.6, 0.1, 0.55)];
  const tailThump = [V(0.42, 0.36, -0.25), V(0.7, 0.16, -0.24), V(0.94, 0.07, -0.14), V(1.12, 0.05, -0.02),
    V(1.28, 0.05, 0.06), V(1.42, 0.06, 0.1)];
  const tailCurve = new THREE.CatmullRomCurve3(tailPts.map(q => q.clone()), false, 'catmullrom', 0.5);
  const tail = K.limb(K.scene, { segments: 28, radial: 14, fill: fur.tail, outline: rimMat, edge: 0.022, capStart: false });
  const attached = V(0, 0, 0), loose = V(0, 0, 0), tmpTail = V(0, 0, 0);

  const arms = [-1, 1].map(s => {
    const limb = K.limb(K.scene, { segments: 24, radial: 18, fill: fur.arms[s < 0 ? 0 : 1], outline: armRimMat, order: 20,
      edge: t => mix(-0.03, 0.012, smooth(0.14, 0.42, t)) });
    const { paw, rim } = makePaw(K.scene, 20);
    return { s, limb, paw, rim, shoulderLocal: V(s * 0.27, 0.94, 0.22), shoulder: V(0, 0, 0),
      c1: V(0, 0, 0), c2: V(0, 0, 0), hand: V(0, 0, 0) };
  });

  const armRadius = t => mix(0.135, 0.092, smooth(0, 0.72, t)) + 0.014 * smooth(0.8, 1, t);
  function updateArm(arm, pawPos) {
    attach(arm.shoulderLocal, arm.shoulder);
    arm.hand.copy(pawPos);
    const a = arm.shoulder, b = arm.hand;
    const reach = a.distanceTo(b);
    const fold = K.clamp(1.4 - reach / 0.9, 0.25, 1);
    const swing = K.smooth(0.7, 1.3, reach);
    arm.c1.set(a.x + arm.s * 0.1 * fold + (b.x - a.x) * mix(0.15, 0.4, swing), a.y - reach * mix(0.32, 0.2, swing),
      a.z + 0.06 + (b.z - a.z) * 0.25);
    arm.c2.set(b.x - (b.x - a.x) * 0.12, b.y + reach * 0.3, b.z - (b.z - a.z) * 0.18);
    const { c1, c2 } = arm;
    arm.limb.update((t, out) => {
      const u = 1 - t;
      return out.set(
        u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
        u * u * u * a.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * b.z);
    }, armRadius);
    const yaw = Math.atan2(b.x - c2.x, b.z - c2.z);
    arm.paw.position.copy(b);
    arm.paw.scale.set(0.135, 0.085, 0.13);
    arm.paw.rotation.set(0, yaw, 0);
    arm.rim.position.copy(b);
    arm.rim.rotation.copy(arm.paw.rotation);
    arm.rim.scale.set(0.149, 0.097, 0.144);
  }

  const reachPath = [V(), V(), V(), V(), V()];
  function reachTail(root, tip) {
    reachPath[0].set(root.x + 0.36, 0.3, root.z + 0.14);
    reachPath[1].set(tip.x + 0.34, 0.31, mix(root.z, tip.z, 0.55));
    reachPath[2].set(tip.x + 0.24, 0.33, tip.z - 0.06);
    reachPath[3].set(tip.x + 0.11, mix(0.33, tip.y + 0.02, 0.5), tip.z + 0.02);
    reachPath[4].copy(tip);
  }

  function updateTail(time, sway, sleep, thump = 0, lift = 0, lash = 0, reach = 0, reachTip = null) {
    body.updateMatrixWorld();
    for (let i = 0; i < tailPts.length; i++) {
      const w = i / (tailPts.length - 1);
      const local = tailCurve.points[i].lerpVectors(tailPts[i], tailSleep[i], sleep);
      if (thump > 0) {
        tmpTail.copy(tailThump[i]);
        tmpTail.y += lift * 1.05 * w ** 1.4;
        tmpTail.x -= lift * 0.22 * w ** 2;
        tmpTail.z += lash * 0.35 * w ** 1.5;
        local.lerp(tmpTail, thump);
      }
      local.x += Math.sin(time * 1.6 + i * 0.7) * 0.04 * w * sway;
      local.y += Math.sin(time * 1.3 + i * 0.9) * 0.05 * w * w * sway;
      attach(local, attached);
      loose.copy(local).add(HOME).addScaledVector(body.position, 0.3).addScaledVector(HOME, -0.3);
      local.lerpVectors(attached, loose, K.smooth(0.1, 0.7, w));
    }
    if (reach > 0 && reachTip) {
      const pts = tailCurve.points;
      reachTail(pts[0], reachTip);
      for (let i = 1; i < pts.length; i++) pts[i].lerp(reachPath[i - 1], reach * (i === 1 ? 0.6 : 1));
    }
    tail.update((t, out) => tailCurve.getPoint(t, out), t => mix(0.085, 0.068, t) + 0.014 * K.smooth(0.8, 1, t));
  }

  const COATS = {
    black: { fur: '#151515', ink: '#151515', rim: '#f6f3e8', arm: '#8a8984', paw: '#f7f6f0', toe: '#b9b7ae', whisker: '#dedcd4', eye: 'gold' },
    tuxedo: { fur: '#1a1a1a', ink: '#151515', lid: '#e4c25a', rim: '#f6f3e8', arm: '#8a8984', paw: '#f8f7f2', toe: '#bcbab2', whisker: '#e8e6de', eye: 'green',
      light: '#f8f7f2', muzzle: 1, tuxedo: 1, nose: '#e7a0a0', mouth: '#9a8f88', inner: '#3a2e2e', innerAmt: 1, shade: 0.25 },
    orange: { fur: '#eda25a', ink: '#b8712f', lid: '#8a4a1f', rim: '#fff8ea', arm: '#b8712f', paw: '#fff6e8', toe: '#e0b991', whisker: '#fffaf0', eye: 'green',
      light: '#fff1dc', muzzle: 1, bib: 1, nose: '#e58a78', mouth: '#a5643a', inner: '#f4b6a2', innerAmt: 1, shade: 0.55,
      tabby: '#c46a2b' },
    grey: { fur: '#8995a4', ink: '#5f6a78', lid: '#3d4450', rim: '#f6f5f0', arm: '#5f6a78', paw: '#f2f1ec', toe: '#bfc3c8', whisker: '#f4f2ea', eye: 'amber',
      light: '#b8c1cc', muzzle: 0.8, bib: 0.6, nose: '#6d6f7d', mouth: '#56606d', inner: '#c9aeb4', innerAmt: 1, shade: 0.55,
      tabby: '#5e6a79' },
    white: { fur: '#fbf9f3', ink: '#c2b8a8', lid: '#8a7f72', rim: '#8b8172', arm: '#c9c1b2', paw: '#fbf9f3', toe: '#e0c9c2', whisker: '#b6ada0', eye: 'blue',
      nose: '#f0a3a3', mouth: '#c99c94', inner: '#f6c3c3', innerAmt: 1, shade: 0.5 },
    calico: { fur: '#fbf8f1', ink: '#c2b8a8', lid: '#6e5a4e', rim: '#8b8172', arm: '#c9c1b2', paw: '#fbf8f1', toe: '#e0c9c2', whisker: '#b6ada0', eye: 'gold',
      patchA: '#e5964a', patchB: '#2b2522', calico: 1, nose: '#eea29a', mouth: '#b08a80', inner: '#f2bcb6', innerAmt: 1, shade: 0.5 },
  };
  const EYES = { gold: '#dcb64a', green: '#93c255', blue: '#6eb2e6', amber: '#e59a32', copper: '#d9792f' };
  const SHINES = {
    none: [],
    classic: [[0.04, 0.05, 0.03], [-0.035, -0.045, 0.014]],
    sparkle: [[0.035, 0.045, 0.042], [-0.04, -0.045, 0.02], [0.06, -0.03, 0.011]],
  };
  const COLLARS = { red: '#d9483b', blue: '#4f8fd8', pink: '#ee8fb4', green: '#5fae6a' };
  const look = { style: '2d', coat: 'black', pattern: 'auto', eye: 'auto', shine: 'classic', blush: false, whiskers: true, collar: 'none' };
  function setLook(o) {
    Object.assign(look, o);
    const c = COATS[look.coat] || COATS.black;
    const striped = c.tabby && (look.pattern === 'tabby' || (look.pattern === 'auto' && look.coat === 'orange'));
    const solid = look.style === '3d';
    K.setFur({ ...c, dark: c.tabby || c.fur, stripes: striped ? 1 : 0, shade: solid ? c.shade : 0 });
    K.mouseProp.setStyle(look.style);
    chinLine.visible = !solid;
    chinMat.uniforms.uColor.value.set(c.ink || c.arm);
    rimMat.color.set(c.rim);
    armRimMat.color.set(c.arm);
    pawMat.color.set(c.paw);
    toeMat.color.set(c.toe);
    whiskerMat.color.set(c.whisker);
    noseMat.color.set(c.nose || c.fur);
    mouthMat.color.set(c.mouth || c.fur);
    face.visible = !!c.nose;
    const eye = look.eye === 'auto' ? c.eye : look.eye;
    eyeMats[0].color.set(EYES[eye === 'odd' ? 'blue' : eye] || EYES.gold);
    eyeMats[1].color.set(EYES[eye === 'odd' ? 'gold' : eye] || EYES.gold);
    lidMat.color.set(c.lid || eyeMats[0].color);
    for (const e of eyes) {
      const dots = SHINES[look.shine] || SHINES.classic;
      e.shine.children.forEach((d, i) => {
        d.visible = i < dots.length;
        if (d.visible) { d.position.set(e.s * dots[i][0], dots[i][1], 0.004); d.scale.set(dots[i][2], dots[i][2], 1); }
      });
    }
    for (const w of whiskers) w.visible = look.whiskers;
    collar.visible = look.collar in COLLARS;
    if (collar.visible) collarMat.color.set(COLLARS[look.collar]);
    placeCollar();
  }

  const NECK = headPivot.position.clone();
  function placeHead() {
    const w = spineWeight(NECK.y);
    headPivot.position.set(NECK.x + bend.x * w, NECK.y * (1 - bend.squash), NECK.z + bend.z * w);
  }

  K.cat = {
    body, home: HOME, headPivot, head, ears, eyes, whiskers, hind, arms, blushMat,
    bend, bendBody, attach, placeHead, placeCollar,
    tailTip: out => tailCurve.getPoint(1, out),
    petMeshes: [headMesh, ...ears.map(e => e.mesh)],
    dragMeshes: [bodyMesh, tail.body, ...arms.flatMap(a => [a.limb.body, a.paw]), ...hind],
    updateArm, updateTail, setLook, look,
  };
  setLook({});
}
