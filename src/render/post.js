import * as THREE from 'three';

// Renders the scene at low resolution, then draws it to the screen with
// black depth outlines and (optionally) ordered dithering down to the
// 64-colour EGA palette (each channel snapped to 00/55/AA/FF).
export class RetroPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(4, 4),
    });
    this.target.depthTexture.type = THREE.UnsignedIntType;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        res: { value: new THREE.Vector2(4, 4) },
        near: { value: 0.1 },
        far: { value: 1000 },
        ega: { value: 1 },
        flash: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 res;
        uniform float near, far, ega, flash;
        varying vec2 vUv;
        float lin(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          float z = d * 2.0 - 1.0;
          return (2.0 * near * far) / (far + near - z * (far - near));
        }
        float bayer(vec2 p) {
          int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
          int i = x + y * 4;
          float m[16];
          m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
          m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
          for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0;
          return 0.0;
        }
        void main() {
          vec2 px = 1.0 / res;
          vec3 lc = texture2D(tColor, vUv).rgb;
          // render target is linear; convert to sRGB ourselves
          vec3 col = mix(lc * 12.92, 1.055 * pow(lc, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lc));
          float d = lin(vUv);
          float dl = lin(vUv - vec2(px.x, 0.0));
          float dr = lin(vUv + vec2(px.x, 0.0));
          float du = lin(vUv + vec2(0.0, px.y));
          float dd = lin(vUv - vec2(0.0, px.y));
          float edge = max(max(dl, dr), max(du, dd)) - d;
          float thr = 0.06 * d + 0.15;
          if (edge > thr && d < far * 0.6) col *= 0.08;
          if (ega > 0.5) {
            vec3 c = col;
            float b = bayer(gl_FragCoord.xy) - 0.5;
            c = floor(c * 3.0 + 0.5 + b * 0.9) / 3.0;
            col = clamp(c, 0.0, 1.0);
          }
          col = mix(col, vec3(1.0), flash);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    this.target.setSize(w, h);
    this.material.uniforms.res.value.set(w, h);
  }

  render(scene, camera) {
    const u = this.material.uniforms;
    u.near.value = camera.near;
    u.far.value = camera.far;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}
