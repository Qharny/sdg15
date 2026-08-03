import * as THREE from "three";
import { Terrain } from "./terrain.js";
import { TreeManager } from "./trees.js";
import { AnimalManager } from "./animals.js";
import { LoggerManager } from "./loggers.js";
import { PoacherManager } from "./poachers.js";
import { ChatBubbleManager } from "./chatBubbles.js";
import { ProjectileManager } from "./projectiles.js";
import { PlayerController } from "./player.js";
import { UI } from "./ui.js";
import { AudioManager } from "./audio.js";
import { EnvironmentManager } from "./environment.js";
import { FireManager } from "./fire.js";
import { WeedManager } from "./weeds.js";
import { AchievementManager } from "./achievements.js";
import { Minimap } from "./minimap.js";
import { PlayerAvatar } from "./playerAvatar.js";
import { TouchControls, isTouchDevice } from "./touchControls.js";
import { randRange } from "./utils.js";
import { SkillManager, renderSkillTree } from "./skills.js";
import {
  recordEntry, getRangerName, setRangerName, renderLeaderboard,
  downloadJSON, copyToClipboard, importJSON,
} from "./leaderboard.js";
import {
  applyAccessibilityClasses, mountAccessibilitySettings, threatColor,
} from "./accessibility.js";
import {
  LEVELS, getUnlockedLevel, unlockLevel, consumePendingLevel, setPendingLevel,
  getBestResult, recordResult, getBestEndlessDays, recordEndlessDays,
} from "./levels.js";

const DAY_LENGTH = 100; // seconds per in-game day

const VIEW_MODE_KEY = "sdg15_view_mode";
// Cycle order for the [V] key. Each entry drives how _updateViewCamera()
// places the render camera relative to the logical (mouse-look) camera.
const VIEW_MODES = [
  { id: "first", label: "First Person" },
  { id: "third", label: "Third Person" },
  { id: "shoulder", label: "Over-the-Shoulder" },
];

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

const WEATHER_TOASTS = {
  clear: "The sky clears up. \u{2600}\u{FE0F}",
  rain: "\u{1F327}\u{FE0F} Rain rolls in - plants grow faster and your canteen refills quicker.",
  drought: "\u{1F525} A drought grips the valley - the land dries out fast and fire risk climbs.",
};

class Game {
  constructor(level, levelIndex) {
    this.level = level;
    this.levelIndex = levelIndex;
    this.canvas = document.getElementById("scene");
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this._lastEscalateDay = 1;
    this._crackleAccum = 0;

    this._initScene();
    this._initSky();
    this._initWorld();
    this._initSandParticles();

    this.environment = new EnvironmentManager();
    this.achievements = new AchievementManager();

    this.ui = new UI();
    this.ui.setLevelInfo(level, levelIndex);
    this.audio = new AudioManager();
    this.player = new PlayerController(
      this.camera, this.renderer.domElement,
      this.terrain, this.trees, this.loggers, this.projectiles, this.ui, this.audio, level
    );
    this.player.fireManager = this.fire;
    this.player.poacherManager = this.poachers;
    this.player.weedManager = this.weeds;
    this.player.onPlant = () => this.achievements.notePlanted();

    this.skills = new SkillManager();
    this.skills.applyAll(this.player);

    if (isTouchDevice()) this.touchControls = new TouchControls(this.player);

    this.avatar = new PlayerAvatar(this.scene);
    const savedView = VIEW_MODES.findIndex((m) => m.id === localStorage.getItem(VIEW_MODE_KEY));
    this.viewModeIndex = savedView >= 0 ? savedView : 0;
    this.player.onViewToggle = () => this._cycleView();

    this.loggers.onTreeLost = () => {
      this.ui.toast("A tree was cut down! \u{26A0}\u{FE0F}", 2200);
      this.audio.alert();
    };

    this.poachers.onAnimalLost = () => {
      this.ui.toast("A poacher caught one of your animals! \u{1F578}\u{FE0F}", 2200);
      this.audio.poacherAlert();
    };

    // A single seed-pod can hit either a logger or a poacher - ProjectileManager
    // tells us which manager owned the unit it hit so the toast/achievement
    // credit goes to the right threat type.
    this.projectiles.onHit = (pos, mgr) => {
      if (mgr === this.poachers) {
        this.ui.toast("Poacher scared off - good aim!", 2000);
        this.achievements.notePoacherStopped();
        this.ui.bumpConfronted();
      } else if (mgr === this.weeds) {
        this.ui.toast("Invasive patch cleared! \u{1F33F}", 1800);
        this.achievements.noteWeedCleared();
      } else {
        this.ui.toast("Logger scared off - keep patrolling your forest!", 2000);
        this.achievements.noteLoggerStopped();
        this.ui.bumpConfronted();
      }
      this.audio.chime();
    };

    this.fire.onIgnite = () => {
      this.ui.toast("A wildfire has started! \u{1F525} Douse it with [Q] before it spreads.", 2600);
      this.audio.alert();
    };
    this.fire.onExtinguish = () => this.achievements.noteFireExtinguished();
    this.fire.onBurnedOut = () => this.ui.toast("A tree burned down... \u{1F525}", 2000);

    this.weeds.onSpawn = () => {
      this.ui.toast("Invasive weeds have taken root! Shoot them with \u{1F3AF} Click/F before they spread.", 2600);
    };

    this.terrain.onMudslide = () => {
      this.ui.toast("A mudslide tore down the slope! \u{1F327}\u{FE0F}\u{26F0}\u{FE0F}", 2400);
      this.audio.alert();
    };

    this.environment.onWeatherChange = (state) => {
      this.ui.toast(WEATHER_TOASTS[state] ?? "The weather shifts.", 3000);
      this.audio.setRain(state === "rain");
    };
    this.environment.onSeasonChange = (season) => {
      this.ui.toast(`${season.icon} ${season.name} arrives.`, 2600);
    };

    this.achievements.onUnlock = (def) => {
      this.skills.grantPoint();
      this.ui.toast(`\u{1F3C6} Achievement unlocked: ${def.name} - ${def.desc} (+1 skill point \u{1F33F})`, 4200);
      this.audio.fanfare();
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
    this.ui.onDefeatRetry(() => {
      setPendingLevel(this.levelIndex);
      location.reload();
    });
    this.ui.onDefeatLevelSelect(() => location.reload());
    this.ui.onManualOpen(() => this._openManual());
    this.ui.onManualClose(() => this._closeManual());
    this.ui.onSkillsOpen(() => this._openSkills());
    this.ui.onSkillsClose(() => this._closeSkills());
    this.ui.onLeaderboardOpen(() => this._openLeaderboard());
    this.ui.onLeaderboardClose(() => this._closeLeaderboard());
    this.ui.onSettingsOpen(() => this._openSettings());
    this.ui.onSettingsClose(() => this._closeSettings());

    // The pause screen previously had nothing wired to its "click to
    // resume" text - clicking the canvas itself re-requests pointer lock,
    // which the start-screen overlay naturally blocks until dismissed.
    this.renderer.domElement.addEventListener("click", () => {
      if (!this.player.locked && !this.ui.manualOpen && !this.ui.wonAlready && !this.ui.lostAlready) this._resume();
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

    // this.camera is the "logical" player - mouse-look, movement, aiming and
    // AI all read its position/quaternion regardless of view mode. What's
    // actually rendered is this.viewCamera, which _updateViewCamera() places
    // relative to this.camera each frame (identical to it in first person,
    // pulled back behind the (invisible-in-FP) player avatar otherwise).
    this.viewCamera = new THREE.PerspectiveCamera(
      this.camera.fov, this.camera.aspect, this.camera.near, this.camera.far
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
    this.poachers = new PoacherManager(this.scene, this.terrain, this.animals, this.level);
    this.chat = new ChatBubbleManager(this.loggers.loggers);
    this.poacherChat = new ChatBubbleManager(this.poachers.poachers);
    this.fire = new FireManager(this.scene, this.terrain, this.trees);
    this.weeds = new WeedManager(this.scene, this.terrain);
    this.projectiles = new ProjectileManager(this.scene, this.terrain, [this.loggers, this.poachers, this.weeds]);
    this.minimap = new Minimap(this.terrain);
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

  _updateFireAudio(dt) {
    this._crackleAccum += dt;
    if (this.fire.count() > 0 && this._crackleAccum > 1.1) {
      this._crackleAccum = 0;
      this.audio.crackle();
    }
  }

  _cycleView() {
    this.viewModeIndex = (this.viewModeIndex + 1) % VIEW_MODES.length;
    const mode = VIEW_MODES[this.viewModeIndex];
    localStorage.setItem(VIEW_MODE_KEY, mode.id);
    this.ui.toast(`\u{1F3A5} View: ${mode.label} [V]`, 1600);
  }

  // Places this.viewCamera relative to the logical this.camera (mouse-look
  // stays authoritative for aiming/AI regardless of view mode) and updates
  // the third-person avatar to match. A short sweep along the eye->camera
  // line keeps the render camera from clipping through hills.
  _updateViewCamera() {
    const mode = VIEW_MODES[this.viewModeIndex].id;
    const cam = this.camera;

    this.viewCamera.fov = cam.fov;
    this.viewCamera.aspect = cam.aspect;
    this.viewCamera.near = cam.near;
    this.viewCamera.far = cam.far;
    this.viewCamera.updateProjectionMatrix();

    if (mode === "first") {
      this.avatar.setVisible(false);
      this.viewCamera.position.copy(cam.position);
      this.viewCamera.quaternion.copy(cam.quaternion);
      return;
    }

    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    const yaw = Math.atan2(forward.x, -forward.z);
    const groundY = this.terrain.groundHeight(cam.position.x, cam.position.z);

    this.avatar.setVisible(true);
    this.avatar.update(cam.position.x, cam.position.z, yaw, groundY, this.player.bobPhase, this.player.bobBlend);

    const desired = new THREE.Vector3();
    if (mode === "shoulder") {
      const right = new THREE.Vector3().crossVectors(forward, cam.up).normalize();
      desired.copy(cam.position).addScaledVector(forward, -2.4).addScaledVector(right, 0.55);
      desired.y += 0.5;
    } else {
      desired.copy(cam.position).addScaledVector(forward, -5.5);
      desired.y += 2;
    }

    const resolved = this._resolveViewCollision(cam.position, desired);
    const half = this.terrain.half - 1;
    resolved.x = Math.min(Math.max(resolved.x, -half), half);
    resolved.z = Math.min(Math.max(resolved.z, -half), half);
    resolved.y = Math.max(resolved.y, this.terrain.groundHeight(resolved.x, resolved.z) + 0.5);

    this.viewCamera.position.copy(resolved);
    this.viewCamera.lookAt(
      mode === "shoulder" ? cam.position.clone().addScaledVector(forward, 3) : cam.position
    );
  }

  // Samples a few points along the eye->desired-camera line and pulls the
  // camera back to just before the terrain (hills/mountains) would poke
  // through the view, instead of letting it clip into the hillside.
  _resolveViewCollision(eye, desired) {
    const steps = 6;
    const sample = new THREE.Vector3();
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      sample.copy(eye).lerp(desired, t);
      const lineY = eye.y + (desired.y - eye.y) * t;
      const groundY = this.terrain.groundHeight(sample.x, sample.z);
      if (groundY + 0.4 > lineY) {
        const backT = (i - 1) / steps;
        return eye.clone().lerp(desired, backT);
      }
    }
    return desired.clone();
  }

  _updateMinimap(dt) {
    const threats = [];
    for (const lg of this.loggers.loggers) {
      if (lg.active) threats.push({ x: lg.mesh.position.x, z: lg.mesh.position.z, color: threatColor("logger") });
    }
    for (const p of this.poachers.poachers) {
      if (p.active) threats.push({ x: p.mesh.position.x, z: p.mesh.position.z, color: threatColor("poacher") });
    }
    for (const f of this.fire.activeCells()) {
      const { x, z } = this.terrain.worldPos(f.col, f.row);
      threats.push({ x, z, color: threatColor("fire") });
    }
    for (const w of this.weeds.activeCells()) {
      const { x, z } = this.terrain.worldPos(w.col, w.row);
      threats.push({ x, z, color: threatColor("weed") });
    }

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const yaw = Math.atan2(dir.x, -dir.z);
    this.minimap.update(dt, this.camera.position, yaw, threats);
  }

  _resume() {
    this.player.lock();
    this.audio.start();
  }

  _openManual() {
    this.ui.showManual();
    this.player.unlock();
  }

  _closeManual() {
    this.ui.hideManual();
    // Only auto-resume if the game was already underway (start screen
    // dismissed) - opening the manual out of curiosity from the start
    // screen shouldn't silently launch the game on close.
    this._resumeIfUnderway();
  }

  _resumeIfUnderway() {
    const alreadyStarted = this.ui.el.start.classList.contains("hidden");
    if (!this.ui.wonAlready && !this.ui.lostAlready && alreadyStarted) this._resume();
  }

  // Re-renders the skill list each time it's opened and after every
  // purchase, so the "Upgrade" buttons reflect the player's current point
  // balance and any newly-maxed nodes immediately.
  _refreshSkillsUI() {
    this.ui.renderSkillsInto(this.skills, (id) => {
      if (this.skills.upgrade(id)) {
        this.skills.applyAll(this.player);
        this.audio.chime();
      }
      this._refreshSkillsUI();
    });
  }

  _openSkills() {
    this._refreshSkillsUI();
    this.ui.showSkills();
    this.player.unlock();
  }

  _closeSkills() {
    this.ui.hideSkills();
    this._resumeIfUnderway();
  }

  _openLeaderboard() {
    this.ui.showLeaderboard();
    this.player.unlock();
  }

  _closeLeaderboard() {
    this.ui.hideLeaderboard();
    this._resumeIfUnderway();
  }

  _openSettings() {
    this.ui.showSettings();
    this.player.unlock();
  }

  _closeSettings() {
    this.ui.hideSettings();
    this._resumeIfUnderway();
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

    if (this.level.endless && this.day !== this._lastEscalateDay) {
      this._lastEscalateDay = this.day;
      this.terrain.escalate(this.level.escalateFactor ?? 1.05);
    }

    this.environment.update(dt, this.day);
    const envMul = this.environment.getMultipliers();
    this.player.envWaterMultiplier = envMul.waterRegen;

    this.terrain.update(dt, this.trees, envMul);
    this.trees.update(dt);
    this.animals.update(dt, this.loggers, this.camera.position);
    this.loggers.update(dt);
    this.poachers.update(dt);
    this.fire.update(dt, envMul.fireChance);
    this.weeds.update(dt, envMul.desertSpread);
    this.projectiles.update(dt);
    this.player.update(dt);

    // Render camera is placed relative to the (just-moved) logical camera,
    // so this has to run after player.update() and before anything that
    // bills itself toward the actual on-screen camera.
    this._updateViewCamera();
    this.loggers.faceBillboards(this.viewCamera.quaternion);
    this.poachers.faceBillboards(this.viewCamera.quaternion);
    this.chat.update(this.viewCamera, this.renderer);
    this.poacherChat.update(this.viewCamera, this.renderer);

    this._updateFireAudio(dt);
    this._updateMinimap(dt);

    const forestPct = this.terrain.forestCoverPct();
    const biodiversity = this.animals.biodiversityIndex();

    if (this.player.seeds >= this.player.maxSeeds) this.achievements.noteMaxSeeds();
    if (forestPct >= 50 && biodiversity >= 50) this.achievements.notePerfectBalance();

    this.ui.update({
      forestPct,
      biodiversity,
      day: this.day,
      seeds: this.player.seeds,
      maxSeeds: this.player.maxSeeds,
      water: this.player.water,
      maxWater: this.player.maxWater,
      plantType: this.player.plantType,
      weatherLabel: this.environment.weatherLabel(),
      seasonLabel: this.environment.seasonLabel(),
      skillPoints: this.skills.points,
    });
    this.ui.updatePrompt(this.player.target);

    if (this.level.endless) {
      if (!this.ui.lostAlready && this.terrain.desertPct() >= (this.level.collapseDesertPct ?? 85)) {
        const isNewBest = recordEndlessDays(this.day);
        this.achievements.noteEndlessDays(getBestEndlessDays());
        recordEntry({
          name: getRangerName(), levelName: this.level.name, levelIndex: this.levelIndex,
          endless: true, days: this.day,
        });
        this.ui.showDefeat({ day: this.day, bestDays: getBestEndlessDays(), isNewBest });
      }
    } else if (forestPct >= this.level.winForestPct && biodiversity >= this.level.winBiodiversityPct) {
      let isNewBest = false;
      if (!this.ui.wonAlready) {
        unlockLevel(this.levelIndex + 1);
        this.achievements.noteLevelCleared(this.levelIndex + 1);
        isNewBest = recordResult(this.levelIndex, this.day);
        recordEntry({
          name: getRangerName(), levelName: this.level.name, levelIndex: this.levelIndex,
          endless: false, days: this.day, forestPct, biodiversity,
        });
      }
      this.ui.showVictory({ forestPct, biodiversity, day: this.day }, {
        levelIndex: this.levelIndex,
        levelName: this.level.name,
        hasNext: this.levelIndex + 1 < LEVELS.length,
        nextName: LEVELS[this.levelIndex + 1]?.name,
        bestDay: getBestResult(this.levelIndex),
        isNewBest,
      });
    }

    this.renderer.render(this.scene, this.viewCamera);
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

  // Accessibility, Ranger Skills and Leaderboard are all reachable from the
  // start screen too, before any Game/UI instance exists - wired directly
  // against the DOM here (same pattern the manual button above already
  // uses) rather than through the UI class.
  applyAccessibilityClasses();
  mountAccessibilitySettings(
    document.getElementById("settings-colorblind"),
    document.getElementById("settings-high-contrast")
  );
  const settingsScreen = document.getElementById("settings-screen");
  document.getElementById("btn-settings-start").addEventListener("click", () => settingsScreen.classList.remove("hidden"));
  document.getElementById("btn-settings-close").addEventListener("click", () => settingsScreen.classList.add("hidden"));

  const skillsScreen = document.getElementById("skills-screen");
  const skillsPointsEl = document.getElementById("skills-points");
  const skillsListEl = document.getElementById("skills-list");
  const standaloneSkills = new SkillManager();
  function refreshStandaloneSkills() {
    renderSkillTree(skillsPointsEl, skillsListEl, standaloneSkills, (id) => {
      standaloneSkills.upgrade(id);
      refreshStandaloneSkills();
    });
  }
  document.getElementById("btn-skills-start").addEventListener("click", () => {
    refreshStandaloneSkills();
    skillsScreen.classList.remove("hidden");
  });
  document.getElementById("btn-skills-close").addEventListener("click", () => skillsScreen.classList.add("hidden"));

  const leaderboardScreen = document.getElementById("leaderboard-screen");
  const leaderboardListEl = document.getElementById("leaderboard-list");
  const nameInput = document.getElementById("leaderboard-name-input");
  const importText = document.getElementById("leaderboard-import-text");
  const importMsg = document.getElementById("leaderboard-import-msg");
  nameInput.value = getRangerName();
  nameInput.addEventListener("change", () => { nameInput.value = setRangerName(nameInput.value); });
  document.getElementById("btn-leaderboard-start").addEventListener("click", () => {
    renderLeaderboard(leaderboardListEl);
    leaderboardScreen.classList.remove("hidden");
  });
  document.getElementById("btn-leaderboard-close").addEventListener("click", () => leaderboardScreen.classList.add("hidden"));
  document.getElementById("btn-leaderboard-export").addEventListener("click", () => downloadJSON());
  document.getElementById("btn-leaderboard-copy").addEventListener("click", async () => {
    try {
      await copyToClipboard();
      importMsg.textContent = "Copied to clipboard.";
    } catch {
      importMsg.textContent = "Couldn't access the clipboard - try Export instead.";
    }
  });
  function handleImport(text) {
    try {
      const n = importJSON(text);
      renderLeaderboard(leaderboardListEl);
      importMsg.textContent = `Imported ${n} entr${n === 1 ? "y" : "ies"}.`;
    } catch (err) {
      importMsg.textContent = err.message;
    }
  }
  document.getElementById("btn-leaderboard-import").addEventListener("click", () => {
    handleImport(importText.value);
    importText.value = "";
  });
  const fileInput = document.getElementById("leaderboard-file-input");
  document.getElementById("btn-leaderboard-import-file").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleImport(reader.result);
    reader.readAsText(file);
    e.target.value = "";
  });

  const unlocked = getUnlockedLevel();

  function bestLineFor(lvl, index) {
    if (lvl.endless) {
      const best = getBestEndlessDays();
      return best > 0 ? `<span class="level-card-best">Best: ${best} day${best === 1 ? "" : "s"} survived</span>` : "";
    }
    const best = getBestResult(index);
    return best !== null ? `<span class="level-card-best">Best: Day ${best}</span>` : "";
  }

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
        ${locked ? "" : bestLineFor(lvl, i)}
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
