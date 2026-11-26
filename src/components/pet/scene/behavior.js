// SPDX-License-Identifier: GPL-3.0-only
// Derived from ElloboDK/KeyCat, web/behavior.js. Modified for SZKJ Pet.
// 输入 → 动画状态 → 渲染（移植自 KeyCat web/behavior.js）。
// createBehavior() 返回宿主可调的 cat 接口与 destroy；窗口键鼠事件在挂件内直接监听。
import * as THREE from 'three';
import { K } from './core.js';
import { TUNING, TUNING_SCHEMA } from './tuning.js';

export function createBehavior() {
  const { V, mix, clamp, approach, smooth } = K;
  const { camera, scene, renderer, keyboard, mouseProp, cat } = K;

  let frozen = null;
  const now = () => frozen ?? performance.now() / 1000;

  const { Spring } = K;
  const opts = { privacy: false, sleepAfter: 60 };
  const S = {
    lastInput: now(), lastKey: -100, lastMouse: -100, mouseDown: false,
    cursor: null, cursorSeen: -100, petting: false, petUntil: 0, petX: 0,
    sleep: 0, asleep: false, wakeAt: -100, nextBlink: now() + 3, nextZ: 0,
    rub: 0, busyUntil: now() + 2, lastPaw: 'R', hit: 'none',
    excite: 0, strokes: [], tailPhase: 0,
    act: null, nextAct: now() + 4,
    annoy: 0, cross: false, crossSince: 0, thumpPhase: 0, thumpLift: 0, lastSlam: 0, petStart: -1,
    moves: [], mouseSpeed: 0, curiousUntil: -100,
  };
  const effects = [];
  const P = {
    shift: new Spring(0, 1.8, 0.72),
    hunch: new Spring(0, 1.6, 0.8),
    squash: new Spring(0, 2.2, 0.55),
    yaw: new Spring(0, 2.6, 0.7),
    pitch: new Spring(-0.28, 2.4, 0.68),
    roll: new Spring(0, 2.2, 0.6),
    gazeX: new Spring(0, 7, 0.9),
    gazeY: new Spring(0, 7, 0.9),
    ears: new Spring(0, 5, 0.35),
    cross: new Spring(0, 1.6, 0.9),
    curious: new Spring(0, 3.5, 0.75),
    desk: new Spring(0, 9, 0.35),
  };
  const paws = {
    L: { side: -1, pos: V(-0.36, 0.26, 0.68), from: V(), key: null, t0: -100, dur: 0.08, down: false },
    R: { side: 1, pos: V(0.36, 0.26, 0.68), from: V(), key: null, t0: -100, dur: 0.08, down: false },
  };
  for (const p of Object.values(paws)) { p.spring = new Spring(p.pos, 3.2, 0.78); p.last = p.pos.clone(); }
  const tailTap = { key: null, t0: -100, dur: 0.18, from: 0, down: false, landAt: -100, reach: 0, hover: 0.12, tip: V() };
  const popups = [], zs = [];
  const tmp = V(0, 0, 0), tmp2 = V(0, 0, 0);

  function poke(amount, t, force = false) {
    if (!TUNING.annoyOn && !force) return;
    S.annoy = clamp(S.annoy + amount, 0, 1);
    S.lastPoke = t;
  }

  function wake(t) {
    if (S.asleep || S.sleep > 0.3) { S.wakeAt = t; poke(TUNING.wakeAnnoy / 100, t); }
    S.asleep = false;
    S.lastInput = t;
    S.busyUntil = t + 3;
    S.act = null;
    S.nextAct = t + 4 + Math.random() * 4;
  }

  function mousing(t) { return S.mouseDown || t - S.lastMouse < 1.4; }

  function key(code, down) {
    const t = now();
    const k = keyboard.resolve(code);
    if (!k) return;
    if (!down) {
      if (tailTap.key === k) { tailTap.down = false; return; }
      k.down = false;
      for (const p of Object.values(paws)) if (p.key === k) p.down = false;
      return;
    }
    wake(t);
    if (k.down || (tailTap.key === k && tailTap.down)) return;
    if (k.code === 'Space' && !S.cross) {
      tailTap.from = tailTap.reach;
      tailTap.dur = mix(0.18, 0.07, tailTap.reach);
      tailTap.key = k;
      tailTap.t0 = t;
      tailTap.down = true;
      S.strokes.push(t);
      if (S.strokes.filter(s => t - s < 0.15).length >= TUNING.mashKeys) poke(0.3, t);
      return;
    }
    let side = keyboard.leftHand(code) ? 'R' : 'L';
    if (mousing(t)) side = 'R';
    const paw = paws[side];
    paw.from.copy(paw.pos);
    paw.key = k;
    paw.t0 = t;
    paw.dur = clamp(paw.pos.distanceTo(keyboard.keyTop(k, tmp)) * 0.09, 0.05, 0.1);
    paw.down = true;
    k.down = true;
    S.lastKey = t;
    S.lastPaw = side;
    S.strokes.push(t);
    if (S.strokes.filter(s => t - s < 0.15).length >= TUNING.mashKeys) poke(0.3, t);
    P.squash.kick(0.35);
    P.pitch.kick(0.9);
    if (code === 'CapsLock') setTimeout(() => key(code, false), 120);
    if (!opts.privacy) popup(k, t, paw.side, /^F\d+$/.test(code) ? code : k.label);
  }

  const fxSprite = (kind, order) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: K.fxTexture(kind), depthTest: false, transparent: true }));
    sprite.renderOrder = order;
    return sprite;
  };
  const angerMark = fxSprite('anger', 45);
  angerMark.visible = false;
  scene.add(angerMark);

  function slam(t) {
    S.lastSlam = t;
    const tip = cat.tailTip(V());
    tip.y = 0.08;
    const add = (kind, size, life, vel, order) => {
      const sprite = fxSprite(kind, order);
      sprite.position.copy(tip);
      scene.add(sprite);
      effects.push({ kind, sprite, t0: t, life, size, from: tip.clone(), vel });
    };
    add('bang', 0.36, 0.24, V(0, 0.15, 0), 42);
    for (const s of [-1, 0, 1]) add('dust', 0.13 + 0.04 * Math.random(), 0.5, V(s * 0.5 + 0.1, 0.3 + 0.15 * Math.random(), 0.1), 41);
    P.desk.kick(0.35);
    P.squash.kick(0.25);
  }

  function popup(k, t, side, label = k.label) {
    for (let i = popups.length - 1; i >= 0; i--) if (popups[i].key === k) { scene.remove(popups[i].sprite); popups.splice(i, 1); }
    const { tex, aspect } = K.labelTexture(label);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.renderOrder = 40;
    keyboard.keyTop(k, sprite.position).add(V(side * 0.3, 0.2, -0.1));
    sprite.userData.base = sprite.position.clone();
    sprite.userData.aspect = aspect;
    scene.add(sprite);
    popups.push({ key: k, sprite, t0: t, upAt: null });
  }

  function updateTailTap(t, dt) {
    const k = tailTap.key;
    if (!k) { tailTap.reach += (0 - tailTap.reach) * approach(10, dt); return; }
    const age = t - tailTap.t0, swinging = age < tailTap.dur;
    if (swinging) tailTap.reach = mix(tailTap.from, 1, smooth(0, 1, age / tailTap.dur));
    else if (tailTap.landAt < tailTap.t0) {
      tailTap.landAt = t;
      P.squash.kick(0.15);
      P.pitch.kick(0.4);
      if (!opts.privacy) popup(k, t, 1);
    }
    const pressing = !swinging && (tailTap.down || t - tailTap.landAt < 0.09);
    k.down = pressing;
    let hover = 0.12;
    if (swinging) hover = 0.12 + Math.sin(age / tailTap.dur * Math.PI) * 0.1 * (1 - tailTap.from);
    else if (pressing) hover = 0;
    tailTap.hover += (hover - tailTap.hover) * approach(swinging ? 60 : pressing ? 70 : 18, dt);
    if (!pressing && !swinging && t - tailTap.landAt > 0.8) { tailTap.key = null; return; }
    S.busyUntil = Math.max(S.busyUntil, t + 1);
  }

  function updatePaw(name, paw, t, dt) {
    const k = paw.key;
    const strikeAge = t - paw.t0;
    if (k && (paw.down || strikeAge < paw.dur + 0.06)) {
      const top = keyboard.keyTop(k, tmp2);
      const hover = tmp.copy(top).add(V(0, 0.12, 0));
      const press = top.clone().add(V(0, 0.07, 0));
      if (strikeAge < paw.dur) {
        const u = smooth(0, 1, strikeAge / paw.dur);
        paw.pos.lerpVectors(paw.from, hover, u);
        paw.pos.y += Math.sin(Math.sqrt(u) * Math.PI) * clamp(paw.from.distanceTo(hover) * 0.3, 0.04, 0.2);
      } else if (paw.down) {
        paw.pos.lerpVectors(hover, press, clamp((strikeAge - paw.dur) / 0.035, 0, 1));
      } else {
        paw.pos.lerp(hover, approach(30, dt));
      }
      paw.spring.x.copy(paw.pos);
      if (dt > 0) paw.spring.v.subVectors(paw.pos, paw.last).divideScalar(dt).multiplyScalar(0.5);
      paw.last.copy(paw.pos);
      return;
    }
    let target, hz = 3.2, damping = 0.78;
    if (name === 'L' && mousing(t)) {
      target = mouseProp.top(tmp);
      hz = t - S.lastMouse < 0.05 || S.mouseDown ? 9 : 6;
      damping = 0.9;
    } else if (k && t - paw.t0 < 0.45) {
      target = keyboard.keyTop(k, tmp).add(V(0, 0.13, 0));
      hz = 5;
    } else if (t - S.lastKey < 1.2) {
      target = cat.attach(tmp2.set(paw.side * 0.55, 0.6, 0.44), tmp);
      hz = 3.6;
    } else {
      const arm = cat.arms[paw.side < 0 ? 0 : 1];
      cat.attach(arm.shoulderLocal, arm.shoulder);
      target = tmp.set(arm.shoulder.x + paw.side * 0.02, 0.26, 0.68);
      hz = 2.4;
    }
    paw.spring.hz = hz;
    paw.spring.damping = damping;
    paw.pos.copy(paw.spring.step(target, dt));
    paw.last.copy(paw.pos);
  }

  function screen(p, out) {
    tmp.copy(p).project(camera);
    const w = K.stage.clientWidth, h = K.stage.clientHeight;
    return out.set((tmp.x + 1) / 2 * w, (1 - tmp.y) / 2 * h, 0);
  }

  function update(t, dt) {
    const idle = t - S.lastInput;
    if (!S.asleep && !S.petting && idle > opts.sleepAfter) S.asleep = true;
    S.sleep += ((S.asleep ? 1 : 0) - S.sleep) * approach(S.asleep ? 1.2 : 6, dt);
    if (S.petting) S.petUntil = t + 0.25;
    const pet = t < S.petUntil;

    keyboard.update(dt);
    mouseProp.update(dt, S.mouseDown);
    updatePaw('L', paws.L, t, dt);
    updatePaw('R', paws.R, t, dt);
    updateTailTap(t, dt);

    while (S.strokes.length && t - S.strokes[0] > 2) S.strokes.shift();
    const busyness = clamp(S.strokes.length / 8, 0, 1);
    S.excite = Math.max(S.excite * Math.exp(-dt / 1.5), busyness, mousing(t) ? 0.6 : 0);

    const rate = S.strokes.length / 2;
    if (rate > TUNING.typeRate) poke((rate - TUNING.typeRate) * 0.05 * dt, t);
    if (S.petting && S.petStart >= 0 && t - S.petStart > TUNING.petLimit) poke(0.3 * dt, t);
    if (t - (S.lastPoke || 0) > 2) S.annoy = Math.max(0, S.annoy - TUNING.calmRate / 100 * dt);
    const crossAt = TUNING.crossAt / 100;
    if (!S.cross && S.annoy >= crossAt) { S.cross = true; S.crossSince = t; S.thumpPhase = 0; S.act = null; }
    if (S.cross && S.annoy < crossAt * 0.42 && t - S.crossSince > 3) S.cross = false;
    if (S.asleep) S.cross = false;

    while (S.moves.length && t - S.moves[0][0] > 0.2) S.moves.shift();
    S.mouseSpeed = S.moves.reduce((sum, m) => sum + m[1], 0) / 0.2;
    if (TUNING.curiousOn && !S.asleep && S.mouseSpeed > TUNING.curiousSpeed) S.curiousUntil = t + TUNING.curiousHold;
    const curiousNow = t < S.curiousUntil && !S.asleep;
    P.curious.step(curiousNow ? 1 : 0, dt);
    const curious = clamp(P.curious.x, 0, 1);
    P.cross.step(S.cross && !curiousNow ? 1 : 0, dt);
    const cross = clamp(P.cross.x, 0, 1);
    if (S.cross || curiousNow) S.busyUntil = Math.max(S.busyUntil, t + 1);

    const idleFor = t - S.lastInput;
    if (S.act && t > S.act.t0 + S.act.dur) S.act = null;
    if (!S.act && t > S.nextAct && idleFor > 2.5 && !S.asleep && !pet && !S.cross && !curiousNow) {
      const kinds = ['tilt', 'tilt', 'ear', 'slowBlink', 'look', 'tail'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      S.act = { kind, t0: t, dur: { tilt: 1.8, ear: 0.4, slowBlink: 1.4, look: 2.2, tail: 1 }[kind], side: Math.random() < 0.5 ? -1 : 1 };
      S.nextAct = t + 4 + Math.random() * 5;
      S.busyUntil = Math.max(S.busyUntil, t + S.act.dur + 0.8);
    }
    const act = S.act, actU = act ? (t - act.t0) / act.dur : 0;
    const actEnv = act ? smooth(0, 0.25, actU) * (1 - smooth(0.7, 1, actU)) : 0;

    const striking = Object.values(paws).find(p => p.key && (p.down || t - p.t0 < 0.3));
    let shift = 0, hunch = 0, squash = 0;
    if (mousing(t)) {
      shift = (paws.L.pos.x - cat.home.x + 0.3) * 0.45;
      hunch = 0.1;
      squash = 0.07;
    } else if (striking) {
      const arm = cat.arms[striking.side < 0 ? 0 : 1];
      shift = (keyboard.keyTop(striking.key, tmp2).x - cat.home.x - arm.shoulderLocal.x) * 0.32;
      hunch = 0.16;
    }
    if (t - S.lastKey < 1.2) { hunch = Math.max(hunch, 0.12 + 0.06 * busyness); squash = Math.max(squash, 0.09 + 0.04 * busyness); }
    hunch += 0.1 * S.sleep;
    squash += 0.08 * S.sleep;
    hunch += 0.06 * curious;
    squash -= 0.04 * curious;
    shift += 0.06 * smooth(0, 1, tailTap.reach);
    P.shift.step(shift, dt);
    P.hunch.step(hunch, dt);
    P.squash.step(squash, dt);
    const breathe = Math.sin(t * mix(2.1, 1.1, S.sleep)) * mix(0.012, 0.02, S.sleep);
    cat.bend.x = P.shift.x;
    cat.bend.z = P.hunch.x;
    cat.bend.squash = P.squash.x;
    cat.body.position.x = cat.home.x;
    cat.body.rotation.set(0.05 * S.sleep, 0, -P.shift.x * 0.06);
    cat.body.scale.set(1 + breathe * 0.4, 1 + breathe, 1 + breathe * 0.4);
    cat.bendBody();
    cat.placeHead();

    const headScreen = screen(cat.head.getWorldPosition(tmp2), V());
    let focus = null;
    const typing = Object.values(paws).find(p => p.key && p.down);
    if (typing && t - S.lastKey < 0.6) focus = screen(keyboard.keyTop(typing.key, tmp2), V());
    else if (tailTap.key && t - tailTap.t0 < 0.6) focus = screen(tailTap.tip, V());
    else if (S.cursor) focus = V(S.cursor.x, S.cursor.y, 0);
    let lx = 0, ly = 0;
    if (focus) {
      lx = clamp((focus.x - headScreen.x) / 260, -1, 1);
      ly = clamp((focus.y - headScreen.y) / 220, -1, 1);
    }
    if (act && act.kind === 'look') { lx = mix(lx, act.side * 0.8, actEnv); ly = mix(ly, -0.3, actEnv); }
    if (pet || S.sleep > 0.5) { lx *= 0.2; ly *= 0.2; }
    P.gazeX.step(lx, dt);
    P.gazeY.step(ly, dt);

    const shake = t - S.wakeAt < 0.6 ? Math.sin((t - S.wakeAt) * 34) * 0.22 * (1 - (t - S.wakeAt) / 0.6) : 0;
    S.rub += ((pet ? 1 : 0) - S.rub) * approach(8, dt);
    const rubWave = Math.sin(t * 7.5) * 0.09 * S.rub;
    const petSide = clamp(S.petX, -1, 1);
    const huff = cross * (lx >= 0 ? -1 : 1) * 0.32;
    const follow = mix(0.3, 0.5, curious);
    P.yaw.step(mix(lx * follow, huff, cross) + petSide * 0.18 * S.rub, dt);
    P.pitch.step(ly * mix(0.12, 0.22, curious) * (1 - cross) - 0.28 + 0.5 * P.hunch.x + (mousing(t) ? 0.06 : 0) + 0.5 * S.sleep + 0.08 * cross, dt);
    let roll = 0;
    if (striking) roll = clamp(P.shift.x * 1.2, -0.18, 0.18);
    if (act && act.kind === 'tilt') roll += act.side * 0.26 * actEnv;
    if (S.cursor && !striking && !mousing(t) && t - S.cursorSeen > 1.2 && Math.abs(lx) < 0.5 && Math.abs(ly) < 0.6) roll += 0.12 * Math.sign(lx || 1);
    roll += 0.2 * curious * (lx >= 0 ? -1 : 1);
    P.roll.step(roll - petSide * 0.12 * S.rub + 0.08 * S.sleep, dt);
    cat.headPivot.rotation.set(P.pitch.x, -cat.body.rotation.y + P.yaw.x + shake, -P.yaw.x * 0.2 + rubWave);
    cat.head.rotation.z = P.roll.x - cat.body.rotation.z;
    cat.headPivot.position.x += rubWave * 0.4;
    cat.placeCollar();

    P.ears.step(0.1 * S.excite * (1 - cross) + 0.12 * curious - 0.22 * S.rub - 0.55 * cross, dt);
    for (const e of cat.ears) {
      const flick = act && act.kind === 'ear' && e.s === act.side ? Math.sin(actU * Math.PI * 3) * 0.3 * (1 - actU) : 0;
      e.group.rotation.z = -e.s * (0.2 - P.ears.x) + flick;
      e.group.rotation.x = -0.12 - 0.35 * cross + 0.12 * curious;
    }

    if (t > S.nextBlink + 0.15) S.nextBlink = t + 2.5 + Math.random() * 4;
    if (curiousNow && t > S.nextBlink - 0.2) S.nextBlink = t + 0.5;
    let blink = t > S.nextBlink ? Math.sin(clamp((t - S.nextBlink) / 0.15, 0, 1) * Math.PI) : 0;
    if (act && act.kind === 'slowBlink') blink = Math.max(blink, 0.85 * Math.sin(clamp(actU, 0, 1) * Math.PI));
    const closed = (pet && !S.cross) || S.sleep > 0.5;
    const dilate = Math.min(2.6, mix(1 + 0.25 * S.excite, TUNING.pupilSize / 100, curious) * (1 - 0.5 * cross));
    for (const e of cat.eyes) {
      e.iris.visible = e.pupil.visible = e.shine.visible = !closed;
      e.arc.visible = closed;
      e.group.scale.y = (1 - 0.9 * blink) * (1 - 0.42 * cross) * (1 + 0.1 * curious);
      e.group.scale.x = 1 + 0.06 * curious;
      let px = P.gazeX.x, py = P.gazeY.x;
      if (focus) {
        const es = screen(e.group.getWorldPosition(tmp2), V());
        px = clamp((focus.x - es.x) / 170, -1, 1);
        py = clamp((focus.y - es.y) / 170, -1, 1);
      }
      e.pupil.scale.x += (0.044 * dilate - e.pupil.scale.x) * approach(10, dt);
      e.pupil.scale.y += (0.11 - 0.012 * Math.max(0, dilate - 1.5) - e.pupil.scale.y) * approach(10, dt);
      const room = Math.max(0, e.iris.scale.x - e.pupil.scale.x - 0.012);
      e.pupil.position.x += (clamp(px * 0.07 - e.s * 0.012, -room, room) - e.pupil.position.x) * approach(22, dt);
      e.pupil.position.x = clamp(e.pupil.position.x, -room, room);
      e.pupil.position.y += (-py * 0.02 - e.pupil.position.y) * approach(22, dt);
    }
    cat.blushMat.opacity = Math.max(0.55 * S.rub, cat.look.blush ? 0.4 : 0) * (1 - cross);

    S.tailPhase += dt * (1 + 1.4 * S.excite + 2.5 * S.annoy + 3 * curious);
    const flickTail = act && act.kind === 'tail' ? Math.sin(actU * Math.PI) * 2 : 0;
    let lift = 0, lash = 0;
    if (cross > 0.05) {
      const prev = S.thumpPhase;
      S.thumpPhase += dt * TUNING.thumpRate;
      const beat = Math.floor(S.thumpPhase), u = S.thumpPhase - beat, resting = beat % 4 === 3;
      if (!resting) lift = u < 0.6 ? smooth(0, 0.6, u) : u < 0.72 ? 1 - ((u - 0.6) / 0.12) ** 2 : 0;
      lash = Math.sin(S.thumpPhase * Math.PI * 0.5) * 0.6;
      const slamAt = beat + 0.72;
      if (!resting && S.cross && prev < slamAt && S.thumpPhase >= slamAt) slam(t);
    }
    S.thumpLift += (lift - S.thumpLift) * approach(40, dt);
    if (tailTap.key) keyboard.keyTop(tailTap.key, tailTap.tip).add(V(0.36, 0.075 + tailTap.hover, -0.02));
    const reach = smooth(0, 1, tailTap.reach);
    cat.updateTail(S.tailPhase, (1 - S.sleep) * (1 + 0.6 * S.excite + flickTail + 1.5 * S.annoy) * (1 - cross) * (1 - 0.55 * curious) * (1 - reach), S.sleep,
      cross * (1 - reach), S.thumpLift, lash, reach, tailTap.tip);

    P.desk.step(0, dt);
    keyboard.group.position.y = 0.02 + P.desk.x;
    mouseProp.group.position.y += P.desk.x * 1.4;
    angerMark.visible = cross > 0.1;
    if (angerMark.visible) {
      cat.headPivot.updateMatrixWorld();
      angerMark.position.set(-0.42, 0.85, 0.2).applyMatrix4(cat.headPivot.matrixWorld);
      const pulse = 1 + 0.25 * Math.max(0, 1 - (t - S.lastSlam) / 0.25);
      angerMark.scale.setScalar(0.27 * cross * pulse);
      angerMark.material.opacity = cross;
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i], age = t - fx.t0, u = age / fx.life;
      if (u >= 1) { scene.remove(fx.sprite); effects.splice(i, 1); continue; }
      fx.sprite.position.copy(fx.from).addScaledVector(fx.vel, age);
      const s = fx.size * (fx.kind === 'bang' ? 0.5 + 0.7 * smooth(0, 0.3, u) : 0.6 + 0.9 * u);
      fx.sprite.scale.set(s, s, 1);
      fx.sprite.material.opacity = fx.kind === 'bang' ? 1 - smooth(0.5, 1, u) : 0.9 * (1 - u);
    }
    for (const arm of cat.arms) cat.updateArm(arm, arm.s < 0 ? paws.L.pos : paws.R.pos);

    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i], age = t - p.t0;
      if (!p.key.down && p.upAt === null) p.upAt = t;
      const fade = p.upAt === null ? 1 : clamp(1 - (t - p.upAt - 0.35) / 0.3, 0, 1);
      const pop = 0.6 + 0.4 * Math.min(1, age / 0.12);
      const h = 0.27 * pop;
      p.sprite.scale.set(h * p.sprite.userData.aspect, h, 1);
      p.sprite.position.copy(p.sprite.userData.base).add(V(0, 0.22 + 0.14 * smooth(0, 0.25, age), 0));
      p.sprite.material.opacity = fade;
      if (fade <= 0) { scene.remove(p.sprite); popups.splice(i, 1); }
    }

    if (S.sleep > 0.7 && t > S.nextZ) {
      S.nextZ = t + 1.3;
      const { tex } = K.labelTexture('Z', 'z');
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.renderOrder = 40;
      cat.head.getWorldPosition(sprite.position).add(V(0.45, 0.55, 0));
      sprite.userData.base = sprite.position.clone();
      scene.add(sprite);
      zs.push({ sprite, t0: t });
    }
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i], age = t - z.t0;
      const s = 0.16 + age * 0.08;
      z.sprite.scale.set(s, s, 1);
      z.sprite.position.copy(z.sprite.userData.base).add(V(Math.sin(age * 2.2) * 0.08 + age * 0.12, age * 0.32, 0));
      z.sprite.material.opacity = clamp(Math.min(age / 0.3, (2.6 - age) / 0.6), 0, 1);
      if (age > 2.6) { scene.remove(z.sprite); zs.splice(i, 1); }
    }

    if (pet || popups.length || zs.length || effects.length || cross > 0.02 || S.sleep > 0.02 && S.sleep < 0.98 || t - S.wakeAt < 0.7) {
      S.busyUntil = Math.max(S.busyUntil, t + 0.5);
    }
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const dragMeshes = [...cat.dragMeshes, ...keyboard.hitMeshes, ...mouseProp.hitMeshes];
  function hitTest(x, y) {
    const w = K.stage.clientWidth, h = K.stage.clientHeight;
    ndc.set(x / w * 2 - 1, -(y / h) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.intersectObjects(cat.petMeshes, false).length) return 'pet';
    if (ray.intersectObjects(dragMeshes, false).length) return 'drag';
    return 'none';
  }

  let last = now(), frame = 0, rafId = 0;
  function loop() {
    rafId = window.requestAnimationFrame(loop);
    S.ticks = (S.ticks || 0) + 1;
    if (frozen !== null) return;
    const t = now();
    const dt = Math.min(0.1, t - last);
    const busy = t < S.busyUntil;
    if (!busy && ++frame % 3 !== 0) return;
    last = t;
    update(t, dt);
    renderer.render(scene, camera);
    if (S.cursor) {
      const hit = hitTest(S.cursor.x, S.cursor.y);
      if (hit !== S.hit) {
        S.hit = hit;
        // 浏览器环境无宿主桥接，命中状态仅内部使用。
      }
    }
  }

  const catApi = {
    key(code, down) { key(code, down); },
    mouseMove(dx, dy) {
      const t = now();
      if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
      S.lastMouse = t;
      S.moves.push([t, Math.hypot(dx, dy)]);
      mouseProp.kick.x = clamp(mouseProp.kick.x + dx * 0.004, -0.16, 0.16);
      mouseProp.kick.z = clamp(mouseProp.kick.z + dy * 0.004, -0.12, 0.12);
      wake(t);
    },
    mouseButton(down) { const t = now(); S.mouseDown = down; S.lastMouse = t; wake(t); },
    cursor(x, y) {
      if (!S.cursor || Math.abs(S.cursor.x - x) + Math.abs(S.cursor.y - y) > 3) S.cursorSeen = now();
      S.cursor = { x, y };
      S.busyUntil = Math.max(S.busyUntil, now() + 0.6);
    },
    pet(down, x) {
      const t = now();
      S.petting = down;
      S.petStart = down ? (S.petStart < 0 ? t : S.petStart) : -1;
      if (down) {
        S.petUntil = t + 0.9;
        const hs = screen(cat.head.getWorldPosition(tmp2), V());
        S.petX = (x - hs.x) / 120;
        wake(t);
      }
    },
    options(o) {
      Object.assign(opts, o);
      if (o.tune) {
        for (const g of TUNING_SCHEMA) for (const it of g.items) TUNING[it.key] = it.key in o.tune ? o.tune[it.key] : it.def;
      }
      cat.setLook(Object.fromEntries(Object.entries(o).filter(([k]) => k in cat.look)));
      S.busyUntil = now() + 1;
    },
    sleepNow() { S.asleep = true; S.lastInput = now() - opts.sleepAfter; },
    annoyNow() { poke(1, now(), true); S.busyUntil = now() + 3; },
    curiousNow(seconds = 3) { const t = now(); S.curiousUntil = t + seconds; S.busyUntil = t + seconds + 1; wake(t); },
    reset() {
      S.mouseDown = false; S.lastMouse = -100; S.lastKey = -100; S.petting = false; S.petUntil = 0;
      S.asleep = false; S.sleep = 0; S.lastInput = now(); S.busyUntil = now() + 2;
      S.strokes = []; S.excite = 0; S.act = null; S.nextAct = now() + 4;
      S.annoy = 0; S.cross = false; S.petStart = -1; S.thumpLift = 0;
      S.moves = []; S.mouseSpeed = 0; S.curiousUntil = -100;
      P.cross.set(0); P.desk.set(0); P.curious.set(0);
      for (const fx of [...effects, ...zs, ...popups]) scene.remove(fx.sprite);
      effects.length = 0;
      zs.length = 0;
      popups.length = 0;
      keyboard.releaseAll();
      for (const k of ['shift', 'hunch', 'squash', 'yaw', 'roll', 'gazeX', 'gazeY', 'ears']) P[k].set(0);
      P.pitch.set(-0.28);
      for (const p of Object.values(paws)) { p.key = null; p.down = false; p.t0 = -100; }
      Object.assign(tailTap, { key: null, t0: -100, down: false, landAt: -100, reach: 0, hover: 0.12 });
    },
    hitTest,
    state: S,
  };

  // 窗口键鼠桥接：桌面端全局监听，坐标换算到挂件舞台。
  const onKeyDown = e => { if (!e.repeat) key(e.code, true); };
  const onKeyUp = e => key(e.code, false);
  const stageRel = e => {
    const r = K.stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onMouseMove = e => {
    const [x, y] = stageRel(e);
    catApi.cursor(x, y);
    catApi.mouseMove(e.movementX, e.movementY);
  };
  const onMouseDown = e => {
    const [x, y] = stageRel(e);
    if (hitTest(x, y) === 'pet') catApi.pet(true, x); else catApi.mouseButton(true);
  };
  const onMouseUp = () => { catApi.pet(false); catApi.mouseButton(false); };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);

  loop();

  function destroy() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
    cancelAnimationFrame(rafId);
  }

  return { cat: catApi, destroy };
}
