import * as THREE from "three";
import { Terrain } from "./terrain.js";
import { TreeManager } from "./trees.js";
import { AnimalManager } from "./animals.js";
import { LoggerManager } from "./loggers.js";
import { ChatBubbleManager } from "./chatBubbles.js";
import { ProjectileManager } from "./projectiles.js";
import { PlayerController } from "./player.js";
import { UI } from "./ui.js";
import { AudioManager } from "./audio.js";
import { randRange } from "./utils.js";
import { LEVELS, getUnlockedLevel, unlockLevel, consumePendingLevel, setPendingLevel } from "./levels.js";

const DAY_LENGTH = 100; // seconds per in-game day

// Radial-gradient canvas texture for the sun's glow sprite - generated in
// code so no image asset needs to be fetched.
function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,250,225,1)");
  grad.addColorStop(0.35, "rgba(255,240,190,0.55)");
  grad.addColorStop(1, "rgba(255,240,190,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

class Game {
  constructor(level, levelIndex) {
    this.level = level;
    this.levelIndex = levelIndex;
    this.canvas = document.getElementById("scene");
    this.clock = new THREE.Clock();
    this.elapsed = 0;

    this._initScene();
    this._initSky();
    this._initWorld();
    this._initSandParticles();

    this.ui = new UI();
    this.ui.setLevelInfo(level, levelIndex);
    this.audio = new AudioManager();
    this.player = new PlayerController(
      this.camera, this.renderer.domElement,
      this.terrain, this.trees, this.loggers, this.projectiles, this.ui, this.audio, level
    );

    this.loggers.onTreeLost = () => {
      this.ui.toast("A tree was cut down! \u{26A0}\u{FE0F}", 2200);
      this.audio.alert();
    };

    this.projectiles.onHit = () => {
      this.ui.toast("Logger scared off - keep patrolling your forest!", 2000);
      this.ui.bumpConfronted();
      this.audio.chime();
    };

    this.player.onManualToggle = () => {
      if (this.ui.manualOpen) this._closeManual();
      else this._openManual();
    };

    this.ui.onResume(() => this._resume());
    this.ui.onRestart(() => {
      setPendingLevel(this.levelIndex);
      location.reload();
    });
    this.ui.onNextLevel(() => {
      unlockLevel(this.levelIndex + 1);
      setPendingLevel(this.levelIndex + 1);
      location.reload();
    });
    this.ui.onLevelSelect(() => location.reload());
    this.ui.onManualOpen(() => this._openManual());
    this.ui.onManualClose(() => this._closeManual());

    // The pause screen previously had nothing wired to its "click to
    // resume" text - clicking the canvas itself re-requests pointer lock,
    // which the start-screen overlay naturally blocks until dismissed.
    this.renderer.domElement.addEventListener("click", () => {
      if (!this.player.locked && !this.ui.manualOpen && !this.ui.wonAlready) this._resume();
    });

    window.addEventListener("resize", () => this._onResize());

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);

    // Level was already confirmed on the level-select screen (the click
    // that constructed this Game *is* the user gesture), so start playing
    // immediately instead of waiting for a separate "Play" button.
    this._resume();
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

  _initSky() {
    const geo = new THREE.SphereGeometry(300, 24, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        horizonColor: { value: new THREE.Color(0xbfe3ff) },
        zenithColor: { value: new THREE.Color(0x2a6fd8) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 horizonColor;
        uniform vec3 zenithColor;
        void main() {
          float h = normalize(vPos).y;
          float t = smoothstep(-0.15, 0.55, h);
          gl_FragColor = vec4(mix(horizonColor, zenithColor, t), 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);
    this.scene.background = null;

    const sunMat = new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.sunSprite = new THREE.Sprite(sunMat);
    this.sunSprite.scale.set(40, 40, 1);
    this.scene.add(this.sunSprite);
  }

  _initWorld() {
    this.terrain = new Terrain(this.scene, 46, 4.2, this.level);

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
    this.loggers = new LoggerManager(this.scene, this.terrain, this.trees, this.level);
    this.chat = new ChatBubbleManager(this.loggers);
    this.projectiles = new ProjectileManager(this.scene, this.terrain, this.loggers);
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

    const dayHorizon = new THREE.Color(0xbfe3ff);
    const dayZenith = new THREE.Color(0x2a6fd8);
    const nightHorizon = new THREE.Color(0x0f1b33);
    const nightZenith = new THREE.Color(0x03050c);
    const horizon = nightHorizon.clone().lerp(dayHorizon, height01);
    const zenith = nightZenith.clone().lerp(dayZenith, height01);

    this.sky.material.uniforms.horizonColor.value.copy(horizon);
    this.sky.material.uniforms.zenithColor.value.copy(zenith);
    this.sky.position.copy(camPos);
    this.scene.fog.color = horizon;

    const sunDir = this.sun.position.clone().sub(camPos).normalize();
    this.sunSprite.position.copy(camPos).addScaledVector(sunDir, 280);
    this.sunSprite.material.opacity = 0.25 + height01 * 0.75;

    this.day = Math.floor(this.elapsed / DAY_LENGTH) + 1;
  }

  _resume() {
    this.player.lock();
    this.audio.start();
  }

  _openManual() {
    this.ui.showManual();
    if (this.player.locked) document.exitPointerLock?.();
  }

  _closeManual() {
    this.ui.hideManual();
    // Only auto-resume if the game was already underway (start screen
    // dismissed) - opening the manual out of curiosity from the start
    // screen shouldn't silently launch the game on close.
    const alreadyStarted = this.ui.el.start.classList.contains("hidden");
    if (!this.ui.wonAlready && alreadyStarted) this._resume();
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
    this.chat.update(this.camera, this.renderer);
    this.projectiles.update(dt);
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

    if (forestPct >= this.level.winForestPct && biodiversity >= this.level.winBiodiversityPct) {
      if (!this.ui.wonAlready) unlockLevel(this.levelIndex + 1);
      this.ui.showVictory({ forestPct, biodiversity, day: this.day }, {
        levelIndex: this.levelIndex,
        levelName: this.level.name,
        hasNext: this.levelIndex + 1 < LEVELS.length,
        nextName: LEVELS[this.levelIndex + 1]?.name,
      });
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// --- Level-select bootstrap -------------------------------------------
// The heavy scene/world isn't built until a level is confirmed, so picking
// a level (or bouncing back from a victory screen's "Next level"/"Replay")
// never pays for a THREE.js init it won't use yet.
function initLevelSelect() {
  const introEl = document.getElementById("level-intro");
  const confirmEl = document.getElementById("level-confirm");
  const gridEl = document.getElementById("level-grid");
  const nameEl = document.getElementById("level-confirm-name");
  const taglineEl = document.getElementById("level-confirm-tagline");
  const goalEl = document.getElementById("level-confirm-goal");
  const playBtn = document.getElementById("btn-play-confirm");
  const backBtn = document.getElementById("btn-level-back");
  const manualBtn = document.getElementById("btn-manual-start");
  const manualScreen = document.getElementById("manual-screen");
  const manualCloseBtn = document.getElementById("btn-manual-close");

  const unlocked = getUnlockedLevel();

  function renderGrid() {
    gridEl.innerHTML = "";
    LEVELS.forEach((lvl, i) => {
      const locked = i > unlocked;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "level-card" + (locked ? " locked" : "");
      card.disabled = locked;
      card.innerHTML = `
        <span class="level-card-num">${locked ? "🔒" : i + 1}</span>
        <span class="level-card-name">${lvl.name}</span>
        <span class="level-card-tagline">${locked ? "Complete the previous level to unlock" : lvl.tagline}</span>
      `;
      if (!locked) card.addEventListener("click", () => showConfirm(i));
      gridEl.appendChild(card);
    });
  }

  function showConfirm(index) {
    const lvl = LEVELS[index];
    nameEl.textContent = `Level ${index + 1}: ${lvl.name}`;
    taglineEl.textContent = lvl.tagline;
    goalEl.textContent = `Goal: ${lvl.goalText}`;
    introEl.classList.add("hidden");
    confirmEl.classList.remove("hidden");
    playBtn.onclick = () => new Game(lvl, index);
  }

  backBtn.addEventListener("click", () => {
    confirmEl.classList.add("hidden");
    introEl.classList.remove("hidden");
  });

  manualBtn.addEventListener("click", () => manualScreen.classList.remove("hidden"));
  manualCloseBtn.addEventListener("click", () => manualScreen.classList.add("hidden"));

  renderGrid();

  const pending = consumePendingLevel();
  if (pending !== null && pending <= unlocked) showConfirm(pending);
}

window.addEventListener("DOMContentLoaded", initLevelSelect);
