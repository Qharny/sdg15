import * as THREE from "three";
import { Terrain } from "./terrain.js";
import { TreeManager } from "./trees.js";
import { AnimalManager } from "./animals.js";
import { LoggerManager } from "./loggers.js";
import { PlayerController } from "./player.js";
import { UI } from "./ui.js";
import { randRange } from "./utils.js";

const DAY_LENGTH = 100; // seconds per in-game day
const WIN_FOREST_PCT = 55;
const WIN_BIODIVERSITY = 55;

class Game {
  constructor() {
    this.canvas = document.getElementById("scene");
    this.clock = new THREE.Clock();
    this.elapsed = 0;

    this._initScene();
    this._initWorld();
    this._initSandParticles();

    this.ui = new UI();
    this.player = new PlayerController(
      this.camera, this.renderer.domElement,
      this.terrain, this.trees, this.loggers, this.ui
    );

    this.loggers.onTreeLost = () => this.ui.toast("A tree was cut down! \u{26A0}\u{FE0F}", 2200);

    this.ui.onPlay(() => this.player.lock());
    this.ui.onRestart(() => location.reload());

    window.addEventListener("resize", () => this._onResize());

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fd1ff);
    this.scene.fog = new THREE.Fog(0x8fd1ff, 60, 210);

    this.camera = new THREE.PerspectiveCamera(
      72, window.innerWidth / window.innerHeight, 0.1, 400
    );

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x5b4a34, 0.75);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const d = 120;
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  _initWorld() {
    this.terrain = new Terrain(this.scene, 46, 4.2);

    // Base plane beneath the cell grid to avoid seeing through gaps.
    const baseGeo = new THREE.PlaneGeometry(this.terrain.half * 2.4, this.terrain.half * 2.4);
    baseGeo.rotateX(-Math.PI / 2);
    const baseMat = new THREE.MeshLambertMaterial({ color: 0x4a3b28 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.35;
    base.receiveShadow = true;
    this.scene.add(base);

    this.trees = new TreeManager(this.scene, this.terrain);
    this.animals = new AnimalManager(this.scene, this.terrain, this.trees);
    this.loggers = new LoggerManager(this.scene, this.terrain, this.trees);
  }

  _initSandParticles() {
    const count = 260;
    const positions = new Float32Array(count * 3);
    const half = this.terrain.half;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = randRange(-half * 0.55, half * 0.05);
      positions[i * 3 + 1] = randRange(0.2, 5);
      positions[i * 3 + 2] = randRange(-half * 0.55, half * 0.05);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xd8c48a, size: 0.18, transparent: true, opacity: 0.55 });
    this.sand = new THREE.Points(geo, mat);
    this.scene.add(this.sand);
  }

  _updateSandParticles(dt) {
    const pos = this.sand.geometry.attributes.position;
    const half = this.terrain.half;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) + dt * 1.4;
      let y = pos.getY(i) + Math.sin(this.elapsed + i) * 0.01;
      if (x > half * 0.05) x = -half * 0.55;
      pos.setX(i, x);
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  }

  _updateDayNight() {
    const cycle = (this.elapsed % DAY_LENGTH) / DAY_LENGTH;
    const angle = cycle * Math.PI * 2;
    const sunHeight = Math.sin(angle);
    const height01 = (Math.max(sunHeight, -0.4) + 0.4) / 1.4; // never fully dark

    const camPos = this.camera.position;
    this.sun.position.set(camPos.x + Math.cos(angle) * 60, 40 + sunHeight * 40, camPos.z + Math.sin(angle) * 60 * 0.4);
    this.sun.target.position.set(camPos.x, 0, camPos.z);
    this.sun.intensity = 0.5 + height01 * 1.2;
    this.hemi.intensity = 0.35 + height01 * 0.55;

    const day = new THREE.Color(0x8fd1ff);
    const night = new THREE.Color(0x1c2c4a);
    const sky = night.clone().lerp(day, height01);
    this.scene.background = sky;
    this.scene.fog.color = sky;

    this.day = Math.floor(this.elapsed / DAY_LENGTH) + 1;
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _animate() {
    requestAnimationFrame(this._animate);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;

    this._updateDayNight();
    this._updateSandParticles(dt);

    this.terrain.update(dt, this.trees);
    this.trees.update(dt);
    this.animals.update(dt, this.loggers, this.camera.position);
    this.loggers.update(dt);
    this.loggers.faceBillboards(this.camera.quaternion);
    this.player.update(dt);

    const forestPct = this.terrain.forestCoverPct();
    const biodiversity = this.animals.biodiversityIndex();

    this.ui.update({
      forestPct,
      biodiversity,
      day: this.day,
      seeds: this.player.seeds,
      maxSeeds: this.player.maxSeeds,
      water: this.player.water,
      maxWater: this.player.maxWater,
    });
    this.ui.updatePrompt(this.player.target);

    if (forestPct >= WIN_FOREST_PCT && biodiversity >= WIN_BIODIVERSITY) {
      this.ui.showVictory({ forestPct, biodiversity, day: this.day });
    }

    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener("DOMContentLoaded", () => new Game());
