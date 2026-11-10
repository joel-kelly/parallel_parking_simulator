import * as THREE from 'three';
import { RetroPass } from './post.js';
import { buildCar, buildProp, buildStreet, buildSpotMarker, buildPed, nightSkyTexture, greySkyTexture, EGA, box, mat } from './models.js';
import { Debris, Particles, Popups, Skids } from './effects.js';
import { CURB, SIDEWALK, SIDEWALK_H, BUILDING_DEPTH } from '../sim/level.js';
import { spotBounds } from '../sim/spot.js';
import { centreAhead } from '../sim/vehicles.js';

const BUILDING_FACE = CURB + SIDEWALK;
const PIXEL_HEIGHT = 300; // vertical resolution of the chunky render

const SCARE_WORDS = ['HEY!', 'WATCH IT!', 'MY LATTE!', 'I HAVE A LAWYER!', 'NOT TODAY!', 'MY HIP!', 'RUDE!'];
const HONK_WORDS = ['HONK!', 'MOVE IT!', 'HOOOONK', 'BEEEEP', 'COME ON!'];

export class View {
  constructor(canvas, popupLayer) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.post = new RetroPass(this.renderer);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 400);
    this.scene = new THREE.Scene();
    this.popups = new Popups(popupLayer, this.camera);
    this.camMode = 0;
    this.camLocked = false;
    this.shake = 0;
    this.flash = 0;
    this.tint = new THREE.Vector3(1, 1, 1);
    this.camPos = new THREE.Vector3(0, 8, 10);
    this.camLook = new THREE.Vector3();
    this.ega = true;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const scale = Math.max(1, h / PIXEL_HEIGHT);
    const rw = Math.round(w / scale), rh = Math.round(h / scale);
    this.renderer.setSize(rw, rh, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.post.setSize(rw, rh);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pxScale = rh / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    if (this.particles) this.particles.material.uniforms.scale.value = this.pxScale;
  }

  setEga(on) { this.ega = on; }

  // A full-screen flash in a colour (white by default).
  doFlash(strength, color = 0xffffff) {
    const c = new THREE.Color(color);
    this.tint.set(c.r, c.g, c.b);
    this.flash = Math.max(this.flash, strength);
  }

  // Builds all meshes for a fresh World.
  load(world) {
    this.world = world;
    const mods = world.mods;
    this.night = mods.has('night');
    this.foggy = mods.has('fog');
    this.rain = mods.has('rain');
    this.ice = mods.has('ice');
    this.camLocked = mods.has('blind');
    if (this.camLocked) this.camMode = 0;
    const scene = new THREE.Scene();
    this.scene = scene;

    // sky, light and weather
    if (this.night) {
      scene.background = nightSkyTexture();
      scene.fog = new THREE.Fog(0x000011, 30, 140);
      scene.add(new THREE.HemisphereLight(0x5555ff, 0x000000, 0.22));
      this.sun = new THREE.DirectionalLight(0x5555ff, 0.25);
    } else if (this.foggy) {
      scene.background = greySkyTexture();
      scene.fog = new THREE.Fog(0xaaaaaa, 4, 34);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.3));
      this.sun = new THREE.DirectionalLight(0xffffff, 0.8);
    } else if (this.rain) {
      scene.background = greySkyTexture();
      scene.fog = new THREE.Fog(0x555555, 50, 160);
      scene.add(new THREE.HemisphereLight(0xaaaaaa, 0x555555, 1.2));
      this.sun = new THREE.DirectionalLight(0xaaaaaa, 1.2);
    } else {
      scene.background = skyTexture();
      scene.fog = new THREE.Fog(this.ice ? 0xffffff : 0x55ffff, 90, 220);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.6));
      this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    }
    const sun = this.sun;
    sun.position.set(-30, 60, 25);
    sun.castShadow = !this.night;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 1; sc.far = 160;
    scene.add(sun, sun.target);

    const street = buildStreet(world.level, this.ice ? 'ice' : this.rain ? 'wet' : 'dry');
    scene.add(street.group);
    this.buildingViews = street.buildings;
    if (!this.night && !this.foggy) addClouds(scene, world.level, this.rain ? EGA.dgray : EGA.white);

    this.carViews = world.cars.map((c) => {
      const v = buildCar(c.spec, c.spec.color, c.spec.accent);
      scene.add(v.root);
      v.car = c;
      v.roll = 0;
      v.dist = 0;
      v.skidDist = 0;
      if (this.night) addHeadlights(v, c.spec, c.isPlayer ? 1 : 0.5);
      return v;
    });
    if (world.ai) {
      // tint the AI a colour the player isn't wearing
      const v = this.carViews.find((cv) => cv.car.isAI);
      const tint = mat(world.player.spec.color === EGA.lmagenta ? EGA.lcyan : EGA.lmagenta);
      v.body.traverse((o) => {
        if (o.isMesh && o.material.color && o.material.color.getHex() === world.ai.car.spec.color) o.material = tint;
      });
    }

    this.parkedViews = world.parked.map((p) => {
      const v = buildCar({ ...p.info, wheelbase: p.info.length * 0.62, rearOverhang: p.info.length * 0.19, wheelRadius: 0.32 }, p.info.color, EGA.white);
      v.root.position.set(p.body.x, 0, p.body.z);
      v.root.rotation.y = -p.body.a;
      scene.add(v.root);
      v.parked = p;
      v.smoke = 0;
      return v;
    });

    this.propViews = world.props.map((p) => {
      const g = buildProp(p.type);
      const y = Math.abs(p.body.z) > CURB ? SIDEWALK_H : 0;
      g.position.set(p.body.x, y, p.body.z);
      g.rotation.y = -p.body.a;
      scene.add(g);
      return { group: g, prop: p };
    });
    this.propByBody = new Map(this.propViews.map((v) => [v.prop, v]));

    // At night the lamp posts nearest the action actually light things up.
    if (this.night) {
      const focus = world.playerSpot ? world.playerSpot.cx : world.level.playerStart.x;
      const lamps = world.props.filter((p) => p.type === 'lamp').sort((a, b) => Math.abs(a.body.x - focus) - Math.abs(b.body.x - focus)).slice(0, 4);
      for (const l of lamps) {
        const pt = new THREE.PointLight(0xffff55, 120, 16, 1.6);
        pt.position.set(l.body.x, 4.0, l.body.z);
        scene.add(pt);
      }
    }

    this.pedViews = world.peds.list.map((p) => {
      const v = buildPed(p);
      scene.add(v.root);
      v.ped = p;
      return v;
    });

    this.markers = mods.has('hidden') ? [] : world.level.spots.map((s) => {
      const m = buildSpotMarker(s, s.owner === 'ai' ? EGA.lred : EGA.yellow);
      scene.add(m);
      m.userData.spot = s;
      return m;
    });

    this.debris = new Debris(scene);
    this.particles = new Particles(scene);
    this.particles.material.uniforms.scale.value = this.pxScale;
    this.skids = new Skids(scene);
    this.popups.clear();
    this.geysers = [];
    this.fires = [];
    this.time = 0;
    this.quakeT = 0;
    this.thunderT = 4 + Math.random() * 6;
    this.snapCamera();
  }

  snapCamera() {
    this.updateCamera(1, true);
  }

  // Returns false when the camera is locked by a modifier.
  cycleCamera() {
    if (this.camLocked) return false;
    this.camMode = (this.camMode + 1) % 3;
    return true;
  }

  // Converts sim events into effects. Audio is handled elsewhere.
  handle(e) {
    const P = this.particles;
    if (e.type === 'break') {
      const v = this.propByBody.get(e.prop);
      if (!v) return;
      const base = new THREE.Vector3(e.vx, 0, e.vz);
      if (e.prop.def.topple) {
        // trees and lamp posts tip over in the direction you hit them
        this.debris.topple(v.group, e.vx, e.vz, Math.hypot(e.vx, e.vz));
        if (e.prop.type === 'tree') this.debris.burst(e.x, 3, e.z, [EGA.green, EGA.lgreen], 10, 4);
      } else {
        this.debris.explode(v.group, base, 1 + Math.min(2, e.impact / 6));
        this.scene.remove(v.group);
      }
      P.sparks(e.x, 0.6, e.z, 8, 3);
      const name = e.prop.def.name;
      if (e.prop.type === 'hydrant') this.geysers.push({ x: e.prop.body.x, z: e.prop.body.z, t: 25 });
      if (e.prop.type === 'meter') P.coins(e.x, 1, e.z, 14);
      if (e.prop.type === 'portaloo') P.water(e.x, 1, e.z), this.debris.burst(e.x, 1, e.z, [EGA.lblue, EGA.blue, EGA.white], 14, 5);
      if (e.prop.type === 'fruit') this.debris.burst(e.x, 1, e.z, [EGA.lred, EGA.yellow, EGA.lgreen, 0xff8800], 20, 6, base.clone().normalize());
      if (e.prop.type === 'statue') { this.doFlash(0.5); this.shake = 1.2; }
      if (e.by && e.by.isPlayer) this.popups.add(`${name}! +$${e.value.toLocaleString()}${e.mult > 1 ? ` (x${e.mult})` : ''}`, e.x, 2, e.z, '#ff55ff', e.mult > 1 ? 1.2 : 1);
      this.shake = Math.max(this.shake, Math.min(0.5, e.impact * 0.04));
    } else if (e.type === 'ding') {
      if (e.impact > 0.6) P.sparks(e.x, 0.6, e.z, Math.round(4 + e.impact * 3), 2 + e.impact);
      if (e.car.isPlayer) {
        const words = e.impact > 6 ? ['KA-BLAM!', 'CRUNCH!!', 'OH NO.'] : e.impact > 2.5 ? ['CRUNCH!', 'BONK!', 'WHAM!'] : ['DING!', 'TINK!', 'BOOP.'];
        this.popups.add(words[Math.floor(Math.random() * words.length)], e.x, 1.6, e.z, e.impact > 2.5 ? '#ff5555' : '#ffff55', 1 + Math.min(1, e.impact / 6));
        this.shake = Math.max(this.shake, Math.min(0.8, e.impact * 0.06));
      }
    } else if (e.type === 'wreck') {
      const v = this.parkedViews.find((pv) => pv.parked === e.parked);
      if (v) {
        v.body.traverse((o) => { if (o.isMesh) o.material = charred(o.material); });
        // pop the wheels off for comedy
        for (const w of v.wheels) {
          this.debris.explode(w.pivot, new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6), 1.6);
        }
        v.wheels = [];
        v.body.position.y = -0.3;
      }
      this.debris.burst(e.x, 1, e.z, [EGA.dgray, EGA.black, EGA.lred], 18, 9);
      for (let i = 0; i < 40; i++) P.fire(e.x, 0.6 + Math.random(), e.z);
      for (let i = 0; i < 20; i++) P.smoke(e.x, 1.5, e.z, true);
      this.fires.push({ x: e.x, z: e.z, t: 12, parked: e.parked });
      this.popups.add(`KABOOM! +$${e.value.toLocaleString()}`, e.x, 2.5, e.z, '#ff5555', 1.6);
      this.doFlash(0.6, 0xffff55);
      this.shake = 1.0;
    } else if (e.type === 'facade') {
      const v = this.buildingViews[this.world.buildings.indexOf(e.building)];
      const out = new THREE.Vector3(-e.nx, 0, -e.nz).multiplyScalar(3 + e.impact * 0.5);
      this.debris.explode(v.facade, out, 1 + Math.min(1.5, e.impact / 8));
      v.hole.visible = true;
      this.debris.burst(e.x, 1.2, e.z, [EGA.lcyan, EGA.white], 24, 4 + e.impact * 0.5, new THREE.Vector3(-e.nx, 0.3, -e.nz));
      this.popups.add(`${v.info.name}: CLOSED! +$${e.value.toLocaleString()}`, e.x, 3, e.z, '#55ffff', 1.4);
      this.shake = Math.max(this.shake, 0.6);
    } else if (e.type === 'collapse') {
      const v = this.buildingViews[this.world.buildings.indexOf(e.building)];
      this.debris.explode(v.extras, new THREE.Vector3(0, 0, -v.info.dir * 4), 1.2);
      this.scene.remove(v.group);
      this.debris.collapse(v, v.info.color, this.particles);
      this.popups.add(`DEMOLISHED! +$${e.value.toLocaleString()}`, v.cx, v.h * 0.6, v.z - v.info.dir * 5, '#ff55ff', 2.2);
      this.doFlash(0.4);
      this.shake = 1.4;
    } else if (e.type === 'smash') {
      const dir = new THREE.Vector3(-e.nx, 0.2, -e.nz);
      this.debris.burst(e.x, 0.8, e.z, [EGA.lcyan, EGA.white, EGA.brown], Math.round(6 + e.impact * 2), 3 + e.impact * 0.6, dir);
      this.popups.add('SMASH!', e.x, 2, e.z, '#55ffff', 1.3);
      this.shake = Math.max(this.shake, 0.4);
    } else if (e.type === 'curb' && e.car.isPlayer) {
      this.popups.add('CURB HOP!', e.car.body.x, 1.8, e.car.body.z, '#ffffff');
      this.shake = Math.max(this.shake, 0.2);
    } else if (e.type === 'parked') {
      const b = e.car.body;
      P.confetti(b.x, 2, b.z, e.car.isPlayer ? 120 : 40);
      this.popups.add(e.car.isPlayer ? 'PARKED!' : 'THEY PARKED!', b.x, 3, b.z, e.car.isPlayer ? '#55ff55' : '#ff55ff', 2);
    } else if (e.type === 'honk') {
      this.popups.add(HONK_WORDS[Math.floor(Math.random() * HONK_WORDS.length)], e.x, 2.2, e.z, '#ff5555', 1.2);
    } else if (e.type === 'scare') {
      this.popups.add(SCARE_WORDS[Math.floor(Math.random() * SCARE_WORDS.length)], e.x, 2.4, e.z, '#ffffff', 1.1);
      P.sparks(e.x, 1, e.z, 4, 2);
    } else if (e.type === 'quake') {
      this.quakeT = e.duration;
      const b = this.world.player.body;
      this.popups.add('EARTHQUAKE!', b.x, 3.5, b.z, '#ffff55', 1.8);
    } else if (e.type === 'combo') {
      const colour = e.mult >= 6 ? '#ff55ff' : e.mult >= 3 ? '#ff5555' : '#ffff55';
      this.popups.add(`x${e.mult} COMBO!`, e.x, 3, e.z, colour, 1.3 + Math.min(1.5, e.combo * 0.08));
    } else if (e.type === 'creep') {
      this.popups.add('beep... beep...', e.x, 2, e.z, '#aaaaaa', 0.8);
    }
  }

  update(dt) {
    this.time += dt;
    const w = this.world;
    for (const v of this.carViews) this.syncCar(v, dt);
    for (const v of this.parkedViews) {
      const b = v.parked.body;
      v.root.position.set(b.x, 0, b.z);
      v.root.rotation.y = -b.a;
      if (v.parked.damage > 60 && !v.parked.wrecked && Math.random() < dt * 4) this.particles.smoke(b.x, 1.2, b.z);
    }
    for (const v of this.pedViews) this.syncPed(v, dt);
    for (const g of this.geysers) {
      g.t -= dt;
      for (let i = 0; i < 4; i++) this.particles.water(g.x, 0.5, g.z);
    }
    this.geysers = this.geysers.filter((g) => g.t > 0);
    for (const f of this.fires) {
      f.t -= dt;
      const b = f.parked.body;
      this.particles.fire(b.x, 1.0, b.z);
      if (Math.random() < 0.5) this.particles.smoke(b.x, 1.6, b.z, true);
    }
    this.fires = this.fires.filter((f) => f.t > 0);

    // player smoke when badly damaged; nitro flames when boosting
    const p = w.player;
    if (p.damage > 80 && Math.random() < dt * 8) {
      const fx = p.body.x + Math.cos(p.body.a) * p.spec.length * 0.4, fz = p.body.z + Math.sin(p.body.a) * p.spec.length * 0.4;
      this.particles.smoke(fx, p.spec.height * 0.8, fz, p.damage > 200);
    }
    if (p.nitroOn) {
      const bx = p.body.x - Math.cos(p.body.a) * p.spec.length * 0.52, bz = p.body.z - Math.sin(p.body.a) * p.spec.length * 0.52;
      for (let i = 0; i < 3; i++) this.particles.fire(bx, 0.5, bz);
      if (Math.random() < 0.5) this.particles.smoke(bx, 0.6, bz, true);
    }

    // weather
    if (this.rain || this.ice) this.weather(dt);

    for (const m of this.markers) {
      const s = m.userData.sign;
      s.position.y = 3.6 + Math.abs(Math.sin(this.time * 3)) * 0.6;
      s.rotation.y = this.time * 1.5;
      if (w.mods.has('shrink') && m.userData.spot.owner === 'player') {
        // the painted bay follows the shrinking gap
        const sp = m.userData.spot;
        const b = spotBounds(w, sp);
        const len = b.front - b.rear, cx = sp.cx + sp.dir * (b.front + b.rear) / 2;
        m.userData.lines.scale.x = Math.max(0.1, len / sp.length);
        m.userData.lines.position.x = cx;
        s.position.x = cx;
      }
    }

    this.debris.kick(w.cars);
    this.debris.update(dt);
    this.particles.update(dt);
    this.updateCamera(dt, false);
    this.popups.update(dt);

    // keep the sun's shadow box around the player
    this.sun.position.set(p.body.x - 30, 60, p.body.z + 25);
    this.sun.target.position.set(p.body.x, 0, p.body.z);

    this.flash = Math.max(0, this.flash - dt * 2.5);
    const u = this.post.material.uniforms;
    u.ega.value = this.ega ? 1 : 0;
    u.flash.value = this.flash;
    u.tint.value.copy(this.tint);
    this.post.render(this.scene, this.camera);
  }

  weather(dt) {
    const c = this.camera.position;
    const n = this.rain ? 14 : 5;
    for (let i = 0; i < n; i++) {
      const x = c.x + (Math.random() - 0.5) * 50, z = c.z + (Math.random() - 0.5) * 50, y = c.y + 6 + Math.random() * 10;
      if (this.rain) this.particles.emit(x, y, z, 0.6, -22, 0.3, Math.random() < 0.5 ? EGA.lcyan : EGA.lblue, 0.1, 1.0, { grav: 0, alpha: 0.7 });
      else this.particles.emit(x, y, z, (Math.random() - 0.5) * 1.2, -2.5, (Math.random() - 0.5) * 1.2, EGA.white, 0.22, 5, { grav: 0, drag: 0.2 });
    }
    if (this.rain) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) { this.thunderT = 8 + Math.random() * 14; this.doFlash(0.7, 0xffffff); this.thunder = true; }
    }
  }

  // The main loop polls this to play the thunder with the lightning.
  takeThunder() { const t = !!this.thunder; this.thunder = false; return t; }

  syncCar(v, dt) {
    const c = v.car, b = c.body;
    v.root.visible = !c.off;
    if (c.off) return;
    // ride height from wheels on the sidewalk
    const h = c.wheelH.map((x) => x * SIDEWALK_H);
    const front = (h[0] + h[1]) / 2, rear = (h[2] + h[3]) / 2;
    const right = (h[0] + h[3]) / 2, left = (h[1] + h[2]) / 2;
    const y = (front + rear) / 2;
    v.root.position.set(b.x, y, b.z);
    v.root.rotation.set(0, -b.a, 0);
    const pitch = Math.atan2(front - rear, c.spec.wheelbase);
    const roll = Math.atan2(right - left, c.spec.width);
    // body lean from acceleration and steering, for cartoon wobble
    const targetRoll = -c.speed * Math.tan(c.steer) * 0.012;
    v.roll += (targetRoll - v.roll) * Math.min(1, dt * 6);
    v.body.rotation.set(v.roll - roll, 0, pitch);
    v.dist += c.speed * dt;
    for (const w of v.wheels) {
      if (w.front) w.pivot.rotation.y = -c.steer;
      w.wheel.rotation.z = -v.dist / v.radius;
    }
    // tyre marks when sliding or when the handbrake is dragging at speed
    const sliding = Math.abs(c.slip) > 1.2 || (c.lastInput.handbrake && Math.abs(c.speed) > 2.5);
    if (sliding && (c.isPlayer || c.isAI)) {
      v.skidDist += Math.abs(c.speed) * dt;
      if (v.skidDist > 0.35) {
        v.skidDist = 0;
        const ca = Math.cos(b.a), sa = Math.sin(b.a);
        const rx = -centreAhead(c.spec), hw = c.spec.width / 2 - 0.15;
        for (const side of [hw, -hw]) {
          this.skids.mark(b.x + ca * rx - sa * side, b.z + sa * rx + ca * side, b.a, 0.45);
        }
        if (Math.random() < 0.6) this.particles.smoke(b.x + ca * rx, 0.2, b.z + sa * rx);
      }
    } else v.skidDist = 0.35;
  }

  syncPed(v, dt) {
    const p = v.ped;
    v.root.position.set(p.x, p.y + (Math.abs(p.z) > CURB ? SIDEWALK_H : 0), p.z);
    if (p.state === 'dive') {
      v.root.rotation.set(0, -p.diveA, 0);
      v.body.rotation.set(0, 0, -1.3);
      v.hips[0].rotation.z = v.hips[1].rotation.z = 0.6;
    } else {
      const facing = p.state === 'walk' ? (p.facing > 0 ? 0 : Math.PI) : (p.side > 0 ? Math.PI / 2 : -Math.PI / 2) * (p.state === 'wait' ? 0.3 : 1);
      v.root.rotation.set(0, -facing, 0);
      v.body.rotation.set(0, 0, p.state === 'wait' ? 0.25 : 0); // hunched over the phone
      const swing = p.state === 'wait' ? 0 : Math.sin(p.phase) * (p.speed > 2 ? 0.9 : 0.5);
      v.hips[0].rotation.z = swing;
      v.hips[1].rotation.z = -swing;
    }
  }

  updateCamera(dt, snap) {
    const p = this.world.player;
    const b = p.body;
    const fx = Math.cos(b.a), fz = Math.sin(b.a);
    const L = p.spec.length;
    let pos, look;
    if (this.camMode === 0) { // chase
      const back = 6 + L * 0.9;
      pos = new THREE.Vector3(b.x - fx * back, 4.2 + L * 0.35, b.z - fz * back);
      look = new THREE.Vector3(b.x + fx * 3, 0.8, b.z + fz * 3);
    } else if (this.camMode === 1) { // high chase view, good for judging gaps
      pos = new THREE.Vector3(b.x - fx * (4 + L), 11 + L, b.z - fz * (4 + L));
      look = new THREE.Vector3(b.x + fx * 2, 0, b.z + fz * 2);
    } else { // top down, street-aligned: driving direction to the right, curb at the bottom
      pos = new THREE.Vector3(b.x, 18 + L * 1.5, b.z + 0.01);
      look = new THREE.Vector3(b.x, 0, b.z);
    }
    this.camera.up.set(0, 1, 0);
    if (this.camMode === 2) this.camera.up.set(0, 0, -1);
    const k = snap ? 1 : 1 - Math.exp(-dt * (this.camMode === 0 ? 4 : 6));
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    if (this.camMode !== 2) this.avoidBuildings(this.camLook, this.camera.position);
    if (this.quakeT > 0) { this.quakeT -= dt; this.shake = Math.max(this.shake, 0.7); }
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2);
    }
    this.camera.lookAt(this.camLook);
  }

  // If a standing building sits between the car and the camera, pull the
  // camera in (and up) so it never ends up inside a wall.
  avoidBuildings(look, cam) {
    const steps = 16;
    let hit = 1;
    const p = new THREE.Vector3();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      p.lerpVectors(look, cam, t);
      if (this.insideBuilding(p.x, p.y, p.z)) { hit = (i - 1) / steps; break; }
    }
    if (hit < 1) {
      const t = Math.max(0.2, hit - 0.05);
      const raise = (1 - t) * 6;
      cam.lerpVectors(look, cam, t);
      cam.y += raise;
    }
  }

  insideBuilding(x, y, z) {
    const az = Math.abs(z), m = 0.4;
    if (az < BUILDING_FACE - m || az > BUILDING_FACE + BUILDING_DEPTH + m) return false;
    const dir = z > 0 ? 1 : -1;
    for (const b of this.world.buildings) {
      const i = b.info;
      if (b.collapsed || i.dir !== dir) continue;
      if (x >= i.x0 - m && x <= i.x1 + m && y < i.height + 0.8) return true;
    }
    return false;
  }

  // Garage / paint shop: the car on a turntable, drawn with the same retro look.
  renderShowcase(dt, spec, color, accent, sideLayout) {
    if (!this.show) {
      const scene = new THREE.Scene();
      scene.background = skyTexture();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.7));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(-8, 14, 10);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      scene.add(sun);
      const floor = box(80, 0.1, 80, EGA.dgray, 0, -0.05, 0);
      floor.castShadow = false;
      scene.add(floor);
      for (let i = -6; i <= 6; i++) { // floor tiles
        const l1 = box(80, 0.02, 0.08, EGA.lgray, 0, 0.01, i * 4, { basic: true });
        const l2 = box(0.08, 0.02, 80, EGA.lgray, i * 4, 0.01, 0, { basic: true });
        l1.castShadow = l2.castShadow = false;
        scene.add(l1, l2);
      }
      const table = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.25, 24), mat(EGA.yellow));
      disc.position.y = 0.12;
      disc.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(4.85, 4.95, 0.2, 24), mat(EGA.black));
      ring.position.y = 0.1;
      table.add(ring, disc);
      scene.add(table);
      this.show = { scene, table, cam: new THREE.PerspectiveCamera(38, 1, 0.3, 200), key: '', car: null, angle: 0.6 };
    }
    const S = this.show;
    const key = `${spec.id}:${color}:${accent}`;
    if (key !== S.key) {
      if (S.car) S.table.remove(S.car);
      const v = buildCar(spec, color, accent);
      v.root.position.y = 0.25;
      v.root.position.x = -(spec.length / 2 - spec.rearOverhang) + spec.wheelbase / 2; // centre on the table
      S.car = new THREE.Group();
      S.car.add(v.root);
      S.table.add(S.car);
      S.key = key;
    }
    S.angle += dt * 0.5;
    S.table.rotation.y = S.angle;
    const w = window.innerWidth, h = window.innerHeight;
    const cam = S.cam;
    cam.aspect = w / h;
    const dist = 6 + spec.length * 1.15;
    cam.position.set(dist * 0.8, 2.2 + spec.height * 0.6, dist * 0.6);
    cam.lookAt(0, spec.height * 0.45, 0);
    if (sideLayout) cam.setViewOffset(w, h, -w * 0.24, 0, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const u = this.post.material.uniforms;
    u.ega.value = this.ega ? 1 : 0;
    u.flash.value = 0;
    this.post.render(S.scene, cam);
  }

  // Simple idle render used behind menus.
  renderIdle(dt) {
    if (!this.world) return;
    this.time += dt;
    // slow cinematic pan down the middle of the street
    const lv = this.world.level;
    const span = lv.xMax - lv.xMin - 30;
    const x = lv.xMin + 15 + ((this.time * 2.5) % span);
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(x, 4.5 + Math.sin(this.time * 0.3), -1.5);
    this.camera.lookAt(x + 12, 1.2, 3);
    this.particles.update(dt);
    this.debris.update(dt);
    this.post.material.uniforms.ega.value = this.ega ? 1 : 0;
    this.post.material.uniforms.flash.value = 0;
    this.post.render(this.scene, this.camera);
  }
}

function addHeadlights(v, spec, strength) {
  const L = spec.length, W = spec.width;
  for (const side of [1, -1]) {
    const s = new THREE.SpotLight(0xffffaa, 260 * strength, 42, 0.42, 0.45, 1.4);
    s.position.set(L / 2, 0.7, side * W * 0.32);
    s.target.position.set(L / 2 + 16, -0.6, side * W * 0.5);
    s.castShadow = false;
    v.root.add(s, s.target);
    // a glowing lamp, so the lights read even when they're not lighting anything
    v.body.add(box(0.1, 0.22, 0.36, EGA.white, L / 2 + 0.05, 0.7, side * W * 0.32, { basic: true }));
  }
}

const charCache = new Map();
function charred(m) {
  if (!m.color) return m;
  const key = m.color.getHex();
  if (!charCache.has(key)) {
    const c = m.clone();
    c.color = m.color.clone().multiplyScalar(0.18);
    charCache.set(key, c);
  }
  return charCache.get(key);
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const bands = ['#0000aa', '#0000aa', '#5555ff', '#5555ff', '#55ffff', '#55ffff', '#ffffff'];
  bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(0, (i / bands.length) * 64, 4, 64 / bands.length + 1); });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addClouds(scene, level, color) {
  for (let i = 0; i < 18; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      g.add(box(4 + Math.random() * 5, 2 + Math.random() * 1.5, 3 + Math.random() * 3, color, k * 3 - n * 1.5, Math.random(), Math.random() * 2, { basic: true }));
    }
    g.position.set(level.xMin + Math.random() * (level.xMax - level.xMin), 35 + Math.random() * 20, (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 60));
    g.traverse((o) => { o.castShadow = false; });
    scene.add(g);
  }
}

export { centreAhead };
