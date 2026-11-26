// SPDX-License-Identifier: GPL-3.0-only
// Derived from ElloboDK/KeyCat, web/fur.js. Modified for SZKJ Pet.
// 毛色与斑纹（移植自 KeyCat web/fur.js）：底色 + 口鼻/围脖/虎斑/三花斑块 + 左上柔光。
// 斑纹按各部件静止姿态摆放，脊柱弯曲时不会移位。
import * as THREE from 'three';
import { K } from './core.js';

export function initFur() {
  const C = c => new THREE.Color(c);
  // 所有毛发材质共享这组 uniform，换毛色只需写一次。
  const U = {
    uFur: { value: C('#151515') },
    uLight: { value: C('#f7f4ea') },
    uDark: { value: C('#151515') },
    uPatchA: { value: C('#151515') },
    uPatchB: { value: C('#151515') },
    uInner: { value: C('#151515') },
    uStripes: { value: 0 },
    uMuzzle: { value: 0 },
    uBib: { value: 0 },
    uCalico: { value: 0 },
    uTuxedo: { value: 0 },
    uInnerAmt: { value: 0 },
    uShade: { value: 0 },
  };

  const vertex = `
    attribute vec3 rest;
    attribute float along;
    varying vec3 vRest;
    varying vec3 vNormal;
    varying float vAlong;
    void main() {
      #ifdef BODY
        vRest = rest;
      #else
        vRest = position;
      #endif
      vAlong = along;
      vNormal = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      #ifdef ARM
        ${K.ARM_ROOT_PUSH}
      #endif
      gl_Position = projectionMatrix * mv;
    }`;

  const fragment = `
    uniform vec3 uFur, uLight, uDark, uPatchA, uPatchB, uInner;
    uniform float uStripes, uMuzzle, uBib, uCalico, uTuxedo, uInnerAmt, uShade;
    varying vec3 vRest;
    varying vec3 vNormal;
    varying float vAlong;
    float blob(vec2 p, vec2 c, vec2 r) { return 1.0 - smoothstep(0.96, 1.0, length((p - c) / r)); }
    float blob3(vec3 p, vec3 c, float r) { return 1.0 - smoothstep(r * 0.97, r, length(p - c)); }
    float stroke(vec2 p, vec2 a, vec2 b, float w, float taper) {
      vec2 ab = b - a;
      float h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
      float r = w * mix(1.0, taper, h);
      return 1.0 - smoothstep(r * 0.88, r, length(p - a - ab * h));
    }
    float rings(float x, float n, float fill) {
      float f = fract(x * n);
      float d = abs(f - 0.5);
      return 1.0 - smoothstep(fill * 0.5 - 0.025, fill * 0.5, d);
    }
    void main() {
      vec3 col = uFur;
      vec3 p = vRest;
      float light = 0.0, dark = 0.0, inner = 0.0;
      #ifdef HEAD
        if (p.z > 0.0) {
          vec2 q = p.xy;
          float m = max(max(blob(q, vec2(-0.2, -0.47), vec2(0.27, 0.22)), blob(q, vec2(0.2, -0.47), vec2(0.27, 0.22))),
                        blob(q, vec2(0.0, -0.66), vec2(0.26, 0.18)));
          light = max(light, m * uMuzzle);
          float blaze = max(m, blob(q, vec2(0.0, -0.1), vec2(0.12, 0.42)) * step(q.y, 0.35));
          light = max(light, blaze * uTuxedo);
          float mk = stroke(q, vec2(0.0, 0.42), vec2(0.0, 0.85), 0.07, 0.55);
          mk = max(mk, stroke(vec2(abs(q.x), q.y), vec2(0.15, 0.4), vec2(0.27, 0.84), 0.06, 0.45));
          mk = max(mk, stroke(vec2(abs(q.x), q.y), vec2(0.72, 0.05), vec2(0.98, 0.16), 0.055, 0.4));
          mk = max(mk, stroke(vec2(abs(q.x), q.y), vec2(0.74, -0.16), vec2(0.99, -0.12), 0.05, 0.4));
          dark = max(dark, mk * uStripes);
        }
        float pa = blob3(p, vec3(-0.6, 0.7, 0.35), 0.62);
        float pb = blob3(p, vec3(0.72, 0.55, 0.1), 0.55);
      #endif
      #ifdef BODY
        float a = abs(atan(p.x, p.z));
        float bibW = mix(0.55, 0.85, smoothstep(0.75, 1.2, p.y));
        float bib = 1.0 - smoothstep(bibW * 0.96, bibW, a);
        light = max(light, bib * max(uBib, uTuxedo));
        float wave = p.y + 0.05 * sin(a * 3.0);
        float reach = smoothstep(0.62, 1.1, a);
        float band = rings(wave, 6.5, 0.36 * reach) * step(0.3, p.y) * step(p.y, 1.2);
        dark = max(dark, band * uStripes);
        float pa = blob3(p, vec3(-0.5, 0.95, -0.3), 0.55);
        float pb = blob3(p, vec3(0.55, 0.55, -0.15), 0.5) * (1.0 - bib);
      #endif
      #ifdef EAR
        float rMax = mix(0.28, 0.0, clamp((p.y + 0.06) / 0.43, 0.0, 1.0));
        inner = (1.0 - smoothstep(0.52, 0.58, abs(p.x) / max(rMax, 0.001))) * smoothstep(0.13, 0.14, p.y) * (1.0 - smoothstep(0.3, 0.31, p.y)) * step(0.0, p.z);
        #ifdef LEFT
          float pa = 1.0, pb = 0.0;
        #else
          float pa = 0.0, pb = 1.0;
        #endif
      #endif
      #ifdef TAIL
        dark = max(dark, rings(vAlong, 5.0, 0.42) * step(0.2, vAlong) * uStripes);
        dark = max(dark, smoothstep(0.9, 0.91, vAlong) * uStripes);
        float pa = rings(vAlong + 0.12, 1.0, 0.3), pb = 1.0 - pa;
      #endif
      #ifdef ARM
        dark = max(dark, rings(vAlong, 3.0, 0.38) * step(0.4, vAlong) * uStripes);
        float pa = 0.0, pb = 0.0;
      #endif
      col = mix(col, uPatchA, pa * uCalico);
      col = mix(col, uPatchB, pb * uCalico);
      col = mix(col, uDark, dark);
      col = mix(col, uLight, light);
      col = mix(col, uInner, inner * uInnerAmt);
      vec3 n = normalize(vNormal);
      float lit = dot(n, normalize(vec3(-0.35, 0.75, 0.55)));
      float edge = (1.0 - clamp(n.z, 0.0, 1.0)) * abs(n.x);
      col *= 1.0 + uShade * (0.18 * lit - 0.4 * edge * edge - 0.05);
      gl_FragColor = vec4(col, 1.0);
    }`;

  // part 取 'HEAD'/'BODY'/'EAR'/'TAIL'/'ARM'；side -1 为屏幕左侧。
  K.furMaterial = (part, side = 0) => {
    const defines = { [part]: 1 };
    if (side < 0) defines.LEFT = 1;
    return new THREE.ShaderMaterial({ uniforms: U, vertexShader: vertex, fragmentShader: fragment, defines });
  };

  K.setFur = f => {
    for (const k of ['fur', 'light', 'dark', 'patchA', 'patchB', 'inner']) U['u' + k[0].toUpperCase() + k.slice(1)].value.set(f[k] || f.fur);
    for (const k of ['stripes', 'muzzle', 'bib', 'calico', 'tuxedo', 'innerAmt', 'shade']) U['u' + k[0].toUpperCase() + k.slice(1)].value = f[k] || 0;
  };
}
