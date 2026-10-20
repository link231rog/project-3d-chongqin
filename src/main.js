import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as TWEEN from '@tweenjs/tween.js';
import { buildPeninsula, MODEL_SOURCES } from './peninsula.js';
import {
  RAFFLES_ANCHOR, RAFFLES_ROTATION_Y, RAFFLES_SCALE, RAFFLES_CRYSTAL,
  RAFFLES_TOWERS, RAFFLES_PODIUM, RAFFLES_PODIUM_BASE_Y, RAFFLES_BRIDGE, RAFFLES_BRIDGE_CENTRE,
  loftTowerGeometry, polygonCentroid, frontCorners
} from './raffles-layout.js';
import { buildZengjiayan } from './zengjiayan.js';
import { buildCityLights } from './city-lights.js';
import {
  classifyPointer, computeFocusPose, isDoubleTap, isTypingTarget, isVisibleInHierarchy
} from './camera-interaction.js';
import { createNavigationDemo } from './navigation.js';
import jialingWater from './jialing-water.json';

const cameraTweens = new TWEEN.Group();
const environmentTweens = new TWEEN.Group();
const cameraOffset = new THREE.Vector3();
const cameraSpherical = new THREE.Spherical();
const cameraTranslation = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraAxis = new THREE.Vector3();
const trainLookTarget = new THREE.Vector3();

/* ==========================================================================
   Global Configuration & State
   ========================================================================== */
const CONFIG = {
  scale: 1,
  environments: {
    sunset: {
      name: '两江晚霞',
      skyColor: 0x665c99,
      horizonColor: 0xffac70,
      cloudColor: 0xffc3a0,
      cloudCover: 0.58,
      exposure: 1.08,
      sunColor: 0xffb56b,
      sunIntensity: 2.0,
      sunPos: new THREE.Vector3(-85, 24, -90),
      ambientColor: 0xc5a4bb,
      ambientIntensity: 0.92,
      nightLights: 0.55
    },
    cyberpunk: {
      name: '赛博山城',
      skyColor: 0x070913,
      horizonColor: 0x252044,
      cloudColor: 0x343453,
      cloudCover: 0.3,
      exposure: 1.08,
      sunColor: 0x38bdf8,
      sunIntensity: 0.5,
      sunPos: new THREE.Vector3(30, 60, -40),
      ambientColor: 0x222c40,
      ambientIntensity: 0.4,
      nightLights: 1.0
    },
    daylight: {
      name: '明朗微缩',
      skyColor: 0xd8eafd,
      horizonColor: 0xf1f7ff,
      cloudColor: 0xffffff,
      cloudCover: 0.42,
      exposure: 1.08,
      sunColor: 0xfffbeb,
      sunIntensity: 2.5,
      sunPos: new THREE.Vector3(75, 95, 65),
      ambientColor: 0xc7dcf5,
      ambientIntensity: 0.95,
      nightLights: 0.02
    }
  },
  currentEnv: 'daylight',
  autoRotate: false,
  animateBoats: true,
  animateTraffic: true,
  animateWaves: true
};

// Application State
let scene, camera, renderer, controls;
let sunLight, ambientLight;
let waterMesh, waterMaterial;
let skyMesh, skyMaterial;
let district;
let animatedBoats = [];
let animatedCars = [];
let cableCarObj = null;
let cablewayCurve = null;
let metroTrainObj = null;
let interactiveObjects = [];
let raycaster, mouse;
let hoveredObject = null;
let buildingNightEmissives = [];
let navigation = null;
let cityLights = null;

const container = document.getElementById('canvas-container');
const tooltip = document.getElementById('landmark-tooltip');
const tooltipTitle = document.getElementById('tooltip-title');
const tooltipContent = document.getElementById('tooltip-content');

/* ==========================================================================
   Init Scene & Setup
   ========================================================================== */
async function init() {
  // 1. Scene
  scene = new THREE.Scene();
  window.__scene = scene;
  window.__camera = camera;
  const env = CONFIG.environments[CONFIG.currentEnv];
  scene.background = new THREE.Color(env.skyColor);

  // Set theme class on body
  document.body.classList.toggle('light-theme', CONFIG.currentEnv === 'daylight');

  camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.5, 6000);
  camera.position.set(78, 58, 86);
  window.__camera = camera;
  window.__THREE = THREE;
  // 3. Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  window.__renderer = renderer;
  container.appendChild(renderer.domElement);

  // 4. OrbitControls (city-builder: left pans, right orbits, wheel zooms to cursor)
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't look under the plinth
  controls.minDistance = 4;
  controls.maxDistance = 2500;
  controls.target.set(0, 20, 4);
  controls.autoRotate = CONFIG.autoRotate;
  controls.autoRotateSpeed = 0.45;
  controls.screenSpacePanning = false; // Pan parallel to the ground, not the screen
  controls.zoomToCursor = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  window.__controls = controls;
  window.__cameraTweens = cameraTweens;

  // 5. Lighting
  district = await buildPeninsula(scene, interactiveObjects, buildingNightEmissives);
  camera.position.copy(district.raffles).add(new THREE.Vector3(94.2, 39.2, 51.9));
  controls.target.copy(district.raffles).add(new THREE.Vector3(-13.8, 10.2, 5.9));
  setupLighting(env);
  buildWeatherSky(env);

  // 6. Build Diorama Model
  buildPlinth();
  buildWaterConfluence();
  buildRafflesCity();
  buildQiansimenBridge();
  buildDongshuimenBridge();
  district.zengjiayan = buildZengjiayan(scene, district, interactiveObjects, buildingNightEmissives);
  buildYangtzeCableway();
  buildShipsAndDocks();
  buildTrafficSystem();
  cityLights = buildCityLights(scene, district, buildingNightEmissives, {
    qiansimen: qiansimenConfig, dongshuimen: dongshuimenConfig
  });
  window.__cityLights = cityLights;
  if (CONFIG.currentEnv === 'daylight' && cityLights?.nightGroup) {
    cityLights.nightGroup.visible = false;
  }
  renderer.shadowMap.needsUpdate = true;
  const sourceStatus = document.getElementById('model-source-status');
  sourceStatus.textContent = `${district.data.buildings.length.toLocaleString()} 个已采集建筑轮廓 · ${district.data.roads.length.toLocaleString()} 段道路与步道。地形采用 ${district.elevation.elevations.length.toLocaleString()} 个 SRTM 高程样本，采样间隔约80—93米；原始卫星数据采集于2000年，不能代替现状地面测绘。缺失楼高、立面和植被细节仍为估算，尚未全部复原。`;
  buildingNightEmissives.forEach(item => {
    item.material[item.property ?? 'emissiveIntensity'] = env.nightLights * item.baseIntensity;
  });

  // 7. Interaction & Events
  setupInteractions();
  setupUI();
  setupPhotoBooth();
  setupKeyboardControls();

  // 8. Dismiss loader
  setTimeout(() => {
    const loader = document.getElementById('loading-screen');
    if (loader) loader.classList.add('fade-out');
  }, 600);

  // 9. Resize listener
  window.addEventListener('resize', onWindowResize);
}

/* ==========================================================================
   Lighting System
   ========================================================================== */
function setupLighting(env) {
  ambientLight = new THREE.AmbientLight(env.ambientColor, env.ambientIntensity);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(env.sunColor, env.sunIntensity);
  sunLight.position.copy(env.sunPos);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 1800;
  sunLight.shadow.camera.left = -600;
  sunLight.shadow.camera.right = 600;
  sunLight.shadow.camera.top = 600;
  sunLight.shadow.camera.bottom = -600;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.radius = 2.5;
  scene.add(sunLight);

  // Soft rim light for miniature plastic/clay gloss edge
  const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.28);
  rimLight.position.set(-80, 40, -80);
  scene.add(rimLight);
}

function buildWeatherSky(env) {
  skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    uniforms: {
      uTop: { value: new THREE.Color(env.skyColor) },
      uHorizon: { value: new THREE.Color(env.horizonColor) },
      uCloudColor: { value: new THREE.Color(env.cloudColor) },
      uCloudCover: { value: env.cloudCover },
      uSunColor: { value: new THREE.Color(env.sunColor) },
      uSunDirection: { value: env.sunPos.clone().normalize() },
      uSunVisibility: { value: CONFIG.currentEnv === 'cyberpunk' ? 0 : 1 },
      uTime: { value: 0 }
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop, uHorizon, uCloudColor, uSunColor, uSunDirection;
      uniform float uCloudCover, uSunVisibility, uTime;
      varying vec3 vDirection;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
      }
      float clouds(vec2 p) {
        return noise(p) * 0.55 + noise(p * 2.03) * 0.28 + noise(p * 4.07) * 0.17;
      }
      void main() {
        vec3 direction = normalize(vDirection);
        float height = smoothstep(-0.2, 0.85, direction.y);
        vec3 color = mix(uHorizon, uTop, pow(height, 0.65));
        vec2 cloudUV = direction.xz / max(direction.y + 0.35, 0.12);
        cloudUV = cloudUV * vec2(1.8, 5.0) + vec2(uTime * 0.008, uTime * 0.003);
        float cloudNoise = clouds(cloudUV);
        float cloudMask = smoothstep(1.0 - uCloudCover, 1.15 - uCloudCover, cloudNoise);
        cloudMask *= smoothstep(-0.12, 0.12, direction.y);
        float towardSun = max(dot(direction, normalize(uSunDirection)), 0.0);
        color += uSunColor * pow(towardSun, 48.0) * 0.32 * uSunVisibility;
        float sunDisc = smoothstep(cos(0.026), cos(0.02), towardSun);
        color = mix(color, uSunColor * 1.4, sunDisc * uSunVisibility);
        vec3 cloudLight = uCloudColor * mix(0.6, 1.15, cloudNoise);
        cloudLight += uSunColor * pow(towardSun, 8.0) * 0.25 * uSunVisibility;
        color = mix(color, cloudLight, cloudMask * 0.85);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `
  });
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial);
  skyMesh.renderOrder = -10;
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);
}

function updateEnvironment(envKey) {
  environmentTweens.removeAll();
  CONFIG.currentEnv = envKey;
  const env = CONFIG.environments[envKey];

  document.body.classList.toggle('light-theme', envKey === 'daylight');
  new TWEEN.Tween(renderer, environmentTweens).to({ toneMappingExposure: env.exposure }, 800).start();
  for (const [uniform, color] of [
    ['uTop', env.skyColor], ['uHorizon', env.horizonColor],
    ['uCloudColor', env.cloudColor], ['uSunColor', env.sunColor]
  ]) {
    new TWEEN.Tween(skyMaterial.uniforms[uniform].value, environmentTweens)
      .to(new THREE.Color(color), 800).start();
  }
  new TWEEN.Tween(skyMaterial.uniforms.uCloudCover, environmentTweens)
    .to({ value: env.cloudCover }, 800).start();
  new TWEEN.Tween(skyMaterial.uniforms.uSunDirection.value, environmentTweens)
    .to(env.sunPos.clone().normalize(), 800).start();
  new TWEEN.Tween(skyMaterial.uniforms.uSunVisibility, environmentTweens)
    .to({ value: envKey === 'cyberpunk' ? 0 : 1 }, 800).start();

  new TWEEN.Tween(scene.background, environmentTweens)
    .to(new THREE.Color(env.skyColor), 800)
    .start();

  new TWEEN.Tween(sunLight.color, environmentTweens)
    .to(new THREE.Color(env.sunColor), 800)
    .start();

  new TWEEN.Tween(sunLight.position, environmentTweens)
    .to(env.sunPos, 800)
    .onUpdate(() => {
      renderer.shadowMap.needsUpdate = true;
    })
    .onComplete(() => {
      renderer.shadowMap.needsUpdate = true;
    })
    .start();

  if (cityLights?.nightGroup) {
    if (env.nightLights > 0.04) {
      cityLights.nightGroup.visible = true;
    } else {
      setTimeout(() => {
        if (CONFIG.currentEnv === 'daylight' && cityLights?.nightGroup) {
          cityLights.nightGroup.visible = false;
        }
      }, 820);
    }
  }

  new TWEEN.Tween(sunLight, environmentTweens)
    .to({ intensity: env.sunIntensity }, 800)
    .start();

  new TWEEN.Tween(ambientLight.color, environmentTweens)
    .to(new THREE.Color(env.ambientColor), 800)
    .start();

  new TWEEN.Tween(ambientLight, environmentTweens)
    .to({ intensity: env.ambientIntensity }, 800)
    .start();

  // Update building night emissions
  buildingNightEmissives.forEach(item => {
    new TWEEN.Tween(item.material, environmentTweens)
      .to({ [item.property ?? 'emissiveIntensity']: env.nightLights * item.baseIntensity }, 800)
      .start();
  });

  // Update water material lighting tone
  if (waterMaterial) {
    new TWEEN.Tween(waterMaterial.uniforms.uNightFactor, environmentTweens)
      .to({ value: env.nightLights }, 800)
      .start();
    new TWEEN.Tween(waterMaterial.uniforms.uSkyReflection.value, environmentTweens)
      .to(new THREE.Color(env.horizonColor), 800).start();
    new TWEEN.Tween(waterMaterial.uniforms.uSunset, environmentTweens)
      .to({ value: envKey === 'sunset' ? 1 : 0 }, 800).start();
  }
}

/* ==========================================================================
   Plinth / Diorama Pedestal
   ========================================================================== */
function buildPlinth() {
  const plinthGroup = new THREE.Group();
  const size = district.bounds.getSize(new THREE.Vector3()).add(new THREE.Vector3(130, 0, 130));
  const center = district.bounds.getCenter(new THREE.Vector3());

  // Dark matte obsidian plinth base (museum exhibition pedestal)
  const baseGeo = new THREE.BoxGeometry(size.x, 10, size.z);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x11141c,
    roughness: 0.85,
    metalness: 0.2
  });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = -5.01;
  baseMesh.receiveShadow = false; // Prevents underwater shadow projection artifacts
  plinthGroup.add(baseMesh);

  // Brushed gold metal accent trim
  const rimGeo = new THREE.BoxGeometry(size.x + 1, 0.8, size.z + 1);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    roughness: 0.35,
    metalness: 0.85
  });
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.position.y = -0.6;
  plinthGroup.add(rimMesh);

  // Lower support pedestal
  const lowerGeo = new THREE.BoxGeometry(size.x + 4, 3, size.z + 4);
  const lowerMesh = new THREE.Mesh(lowerGeo, baseMat);
  lowerMesh.position.y = -10;
  plinthGroup.add(lowerMesh);

  plinthGroup.position.set(center.x, 0, center.z);
  scene.add(plinthGroup);
}

/* ==========================================================================
   Water & Confluence Shader (两江汇流 / 鸳鸯锅)
   ========================================================================== */
function buildWaterConfluence() {
  const size = district.bounds.getSize(new THREE.Vector3());
  const center = district.bounds.getCenter(new THREE.Vector3());
  const waterGeo = new THREE.PlaneGeometry(size.x + 128, size.z + 128);
  waterGeo.rotateX(-Math.PI / 2);

  const riverMaskCanvas = document.createElement('canvas');
  riverMaskCanvas.width = 2048;
  riverMaskCanvas.height = 1024;
  const mask = riverMaskCanvas.getContext('2d');
  mask.fillStyle = '#000';
  mask.fillRect(0, 0, riverMaskCanvas.width, riverMaskCanvas.height);
  mask.fillStyle = '#fff';
  for (const polygon of jialingWater.polygons) {
    mask.beginPath();
    for (const ring of [polygon.outer, ...polygon.holes]) {
      ring.forEach(([x, z], index) => {
        const px = (x - center.x + (size.x + 128) / 2) / (size.x + 128) * riverMaskCanvas.width;
        const py = (z - center.z + (size.z + 128) / 2) / (size.z + 128) * riverMaskCanvas.height;
        if (index === 0) mask.moveTo(px, py);
        else mask.lineTo(px, py);
      });
      mask.closePath();
    }
    mask.fill('evenodd');
  }
  const riverMask = new THREE.CanvasTexture(riverMaskCanvas);

  const waterVertexShader = `
    #include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
      vUv = uv;
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }
  `;

  const waterFragmentShader = `
    #include <logdepthbuf_pars_fragment>
    uniform float uTime;
    uniform vec3 uYangtzeColor;
    uniform vec3 uJialingColor;
    uniform sampler2D uJialingMask;
    uniform float uConfluenceX;
    uniform float uNightFactor;
    uniform vec3 uSkyReflection;
    uniform float uSunset;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float valueNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                 mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main() {
      #include <logdepthbuf_fragment>
      // Only the mapped upstream Jialing channel is green; downstream stays Yangtze brown.
      float upstream = 1.0 - smoothstep(uConfluenceX - 1.0, uConfluenceX + 1.0, vWorldPos.x);
      float jialing = texture2D(uJialingMask, vUv).r * upstream;
      vec3 waterColor = mix(uYangtzeColor, uJialingColor, jialing);
      // Broad, low-contrast flow has no view-dependent sparkle or moving surface vertices.
      // Noise is stretched along X so the current reads as streaks, not boiling.
      vec2 flow = vWorldPos.xz + vec2(uTime * 0.012, uTime * 0.008);
      float swirl = valueNoise(vec2(flow.x * 0.02, flow.y * 0.07)) * 0.6
                  + valueNoise(vec2(flow.x * 0.05, flow.y * 0.16)) * 0.4;
      waterColor *= 0.9 + swirl * 0.2;
      waterColor *= mix(1.0, 0.42, uNightFactor);
      // Per-fragment view vector; the plane has only four vertices, so an interpolated
      // view direction would wash out the grazing-angle sky reflection.
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float fresnel = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 1.6);
      // Add the sky sheen instead of mixing toward it, so the muddy hue survives.
      vec3 finalColor = waterColor + uSkyReflection * (0.04 + fresnel * 0.2) + uSunset * 0.04;

      gl_FragColor = vec4(finalColor, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  waterMaterial = new THREE.ShaderMaterial({
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uYangtzeColor: { value: new THREE.Color(0x6f5f3f) },
      uJialingColor: { value: new THREE.Color(0x1a6660) },
      uJialingMask: { value: riverMask },
      uConfluenceX: { value: district.tip.x },
      uNightFactor: { value: CONFIG.environments[CONFIG.currentEnv].nightLights },
      uSkyReflection: { value: new THREE.Color(CONFIG.environments[CONFIG.currentEnv].horizonColor) },
      uSunset: { value: CONFIG.currentEnv === 'sunset' ? 1 : 0 }
    },
    transparent: false,
    depthWrite: true
  });

  waterMesh = new THREE.Mesh(waterGeo, waterMaterial);
  waterMesh.position.set(center.x, 0.2, center.z);
  waterMesh.receiveShadow = false;
  scene.add(waterMesh);
}

/* ==========================================================================
   Yuzhong Peninsula (朝天门半岛阶梯地形与城台)
   ========================================================================== */

/* ==========================================================================
   Raffles City Chongqing (重庆来福士 - "朝天扬帆" & 水晶连廊)
   Tower footprints, podium outline and Crystal centreline come from the OSM
   ways in raffles-layout.js. Facade grid, crowns and deck details are still
   approximations; see docs/SOURCES.md.
   ========================================================================== */
function buildRafflesCity() {
  const rafflesGroup = new THREE.Group();

  const wallTextures = createCurtainWallTextures();
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTextures.map,
    emissiveMap: wallTextures.glow,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    metalness: 0.24,
    roughness: 0.46
  });

  // Plain glass for the Crystal and the observation decks.
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x6a95a6,
    metalness: 0.18,
    roughness: 0.4,
    transmission: 0.1,
    thickness: 1.2,
    reflectivity: 0.6,
    clearcoat: 0.35
  });

  const podiumMat = new THREE.MeshStandardMaterial({ color: 0x83929b, metalness: 0.1, roughness: 0.8 });
  const podiumGlowMat = new THREE.MeshStandardMaterial({
    color: 0x927c60,
    emissive: 0xffba6e,
    emissiveIntensity: 0.5
  });

  // Podium follows the surveyed outline. The roof is the tower base at y 20; the base
  // reaches below the ground under the outline so the slab does not float on the slope.
  const podium = extrudePlan(RAFFLES_PODIUM, 20 - RAFFLES_PODIUM_BASE_Y, RAFFLES_PODIUM_BASE_Y, podiumMat);
  rafflesGroup.add(podium);
  const podiumGlow = extrudePlan(RAFFLES_PODIUM, 1.6, 13.4, podiumGlowMat, 1.012);
  rafflesGroup.add(podiumGlow);
  buildingNightEmissives.push({ material: podiumGlowMat, baseIntensity: 1.2 });

  // Six 250 m towers (39 local) and the two 350 m gateway towers (58 local).
  // Heights keep the existing 0.435 vertical squash; the podium roof is local y = 20.
  const ledGeometries = [];
  const rearLedGeometries = [];
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x6c8b9a, emissive: 0x0284c7, emissiveIntensity: 1.0 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, emissive: 0xf59e0b, emissiveIntensity: 1.8 });
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false
  });

  for (const tower of RAFFLES_TOWERS) {
    const isRear = tower.height >= 350;
    const height = isRear ? 58 : 39;
    const segments = isRear ? 18 : 14;
    const taper = 0.16;
    const lean = 1.1;
    const loft = loftTowerGeometry(tower.footprint, {
      height, segments, taper, lean, floors: tower.levels || 46
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(loft.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(loft.uvs, 2));
    geometry.setIndex(loft.indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, wallMat);
    mesh.position.set(tower.centre.x, 20, tower.centre.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    rafflesGroup.add(mesh);

    if (isRear) {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.75, 3.0, 8), crownMat);
      crown.position.set(tower.centre.x, 20 + height - 1.5, tower.centre.z + loft.topShift);
      rafflesGroup.add(crown);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1.6, 10.0, 16, 1, true), beamMat);
      beam.position.set(tower.centre.x, 20 + height + 6.5, tower.centre.z + loft.topShift);
      rafflesGroup.add(beam);
    } else {
      // Crown rim follows the lofted roof plan instead of a bounding box.
      const top = tower.footprint.map(([x, z]) => [tower.centre.x + x * loft.topScale, tower.centre.z + z * loft.topScale + loft.topShift]);
      rafflesGroup.add(extrudePlan(top, 0.35, 20 + height - 0.35, rimMat, 0.99));
    }

    // LED ribbons trace the two river-facing corners up the sail curve.
    const targets = isRear ? rearLedGeometries : ledGeometries;
    for (const [cx, cz] of frontCorners(tower.footprint)) {
      for (let s = 0; s < segments; s++) {
        const t = s / segments;
        const k = 1 - taper * t;
        const shift = lean * Math.sin(t * Math.PI * 0.75);
        const strip = new THREE.BoxGeometry(0.16, height / segments * 1.02, 0.16);
        strip.translate(tower.centre.x + cx * k, 20 + height * t + height / segments * 0.5, tower.centre.z + cz * k + shift);
        targets.push(strip);
      }
    }
  }

  const ledMat = new THREE.MeshBasicMaterial({ color: 0x00eaff, toneMapped: false, transparent: true });
  const rearLedMat = new THREE.MeshBasicMaterial({ color: 0xff32b8, toneMapped: false, transparent: true });
  rafflesGroup.add(new THREE.Mesh(mergeGeometries(ledGeometries), ledMat));
  rafflesGroup.add(new THREE.Mesh(mergeGeometries(rearLedGeometries), rearLedMat));
  buildingNightEmissives.push(
    { material: wallMat, baseIntensity: 0.85 },
    { material: rimMat, baseIntensity: 1.5 },
    { material: crownMat, baseIntensity: 2.4 },
    { material: beamMat, property: 'opacity', baseIntensity: 0.35 },
    { material: ledMat, property: 'opacity', baseIntensity: 1 },
    { material: rearLedMat, property: 'opacity', baseIntensity: 1 }
  );

  // The Crystal Skybridge: 300 m arc through the four 250 m towers, 32.5 m wide
  // and 22.5 m deep (elliptical section), centred at 250 m above the podium roof.
  const bridgeCurve = new THREE.CatmullRomCurve3(
    RAFFLES_BRIDGE.map(([x, z]) => new THREE.Vector3(x, RAFFLES_CRYSTAL.y, z)), false, 'centripetal', 0.5
  );
  const radiusX = RAFFLES_CRYSTAL.width / 2;
  const radiusY = RAFFLES_CRYSTAL.height / 2;
  const bridgeGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xb6d2dc,
    metalness: 0.28,
    roughness: 0.26,
    transmission: 0.18,
    thickness: 1.2,
    clearcoat: 0.5,
    clearcoatRoughness: 0.35,
    emissive: 0x1d4f63,
    emissiveIntensity: 0.18
  });
  const interiorMat = new THREE.MeshStandardMaterial({
    color: 0x6f9c8a,
    emissive: 0xd9c98a,
    emissiveIntensity: 0.25
  });
  const bridgeMesh = new THREE.Mesh(sweepEllipse(bridgeCurve, 64, 18, radiusX, radiusY), bridgeGlassMat);
  const interiorMesh = new THREE.Mesh(sweepEllipse(bridgeCurve, 48, 12, radiusX * 0.72, radiusY * 0.72), interiorMat);
  rafflesGroup.add(bridgeMesh, interiorMesh);

  // The sweep is an open tube; close both ends so they do not read as holes.
  for (const t of [0, 1]) {
    const point = bridgeCurve.getPointAt(t);
    const tangent = bridgeCurve.getTangentAt(t);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(1, 18), bridgeGlassMat);
    cap.scale.set(radiusX, radiusY, 1);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t === 0 ? tangent.clone().negate() : tangent);
    cap.position.copy(point);
    rafflesGroup.add(cap);
  }

  // Neon rails along the Crystal edges.
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x00eaff, toneMapped: false, transparent: true });
  const pinkStripMat = new THREE.MeshBasicMaterial({ color: 0xff32b8, toneMapped: false, transparent: true });
  const railSpecs = [
    { dx: 0, dy: radiusY * 1.02, mat: stripMat, radius: 0.14 },
    { dx: 0, dy: -radiusY * 1.02, mat: stripMat, radius: 0.14 },
    { dx: radiusX * 1.02, dy: 0, mat: pinkStripMat, radius: 0.1 },
    { dx: -radiusX * 1.02, dy: 0, mat: stripMat, radius: 0.1 }
  ];
  for (const spec of railSpecs) {
    const rail = new THREE.Mesh(new THREE.TubeGeometry(offsetCurve(bridgeCurve, spec.dx, spec.dy), 64, spec.radius, 6, false), spec.mat);
    rafflesGroup.add(rail);
  }

  // CapitaLand/Chinanews: a half-round glass platform cantilevers from each end of the
  // Crystal (east and west), and the Exploration Deck sits on the Jialing (north) side.
  const deckGeo = new THREE.BoxGeometry(1.6, 0.4, 2.2);
  const deckEdgeMat = new THREE.LineBasicMaterial({ color: 0xff32b8, toneMapped: false, transparent: true });
  const deckEdgePoints = [
    [-0.8, 0.21, -1.1], [0.8, 0.21, -1.1], [0.8, 0.21, 1.1], [-0.8, 0.21, 1.1]
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  for (const t of [0, 1]) {
    const point = bridgeCurve.getPointAt(t);
    const tangent = bridgeCurve.getTangentAt(t);
    const deck = new THREE.Mesh(deckGeo, glassMat);
    // Overlap the shell by 0.25 so the cantilever is attached, not floating off the end.
    deck.position.copy(point).addScaledVector(tangent, t === 0 ? -0.55 : 0.55);
    deck.rotation.y = -Math.atan2(tangent.z, tangent.x);
    rafflesGroup.add(deck);
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(deckEdgePoints), deckEdgeMat);
    edge.position.copy(deck.position);
    edge.rotation.y = deck.rotation.y;
    rafflesGroup.add(edge);
  }

  const deckT = 0.58;
  const deckPoint = bridgeCurve.getPointAt(deckT);
  const deckTangent = bridgeCurve.getTangentAt(deckT);
  const deckSide = new THREE.Vector3().crossVectors(deckTangent, new THREE.Vector3(0, 1, 0)).normalize();
  const explorationDeck = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.3, 2.0), glassMat);
  // Inner edge sits 0.5 inside the shell instead of a 1.1 gap outside it.
  explorationDeck.position.copy(deckPoint).addScaledVector(deckSide, -(radiusX + 0.5));
  explorationDeck.rotation.y = -Math.atan2(deckTangent.z, deckTangent.x);
  rafflesGroup.add(explorationDeck);

  buildingNightEmissives.push(
    { material: bridgeGlassMat, baseIntensity: 0.5 },
    { material: interiorMat, baseIntensity: 0.8 },
    { material: stripMat, property: 'opacity', baseIntensity: 1 },
    { material: pinkStripMat, property: 'opacity', baseIntensity: 1 },
    { material: deckEdgeMat, property: 'opacity', baseIntensity: 1 }
  );

  // Landmark Hit Box for Interactive Tooltip
  const skybridgeHitBox = new THREE.Mesh(
    new THREE.BoxGeometry(30, 6, 6),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  skybridgeHitBox.position.set(RAFFLES_BRIDGE_CENTRE.x, RAFFLES_CRYSTAL.y, RAFFLES_BRIDGE_CENTRE.z);
  skybridgeHitBox.userData = {
    name: '重庆来福士 · 水晶连廊',
    desc: '横跨4栋250米高楼之上的“空中天街”，全长300米、重达1.2万吨，内设空中花园与270°两江交汇悬挑玻璃观景台。'
  };
  interactiveObjects.push(skybridgeHitBox);
  rafflesGroup.add(skybridgeHitBox);

  rafflesGroup.scale.set(RAFFLES_SCALE, 0.435, RAFFLES_SCALE);
  rafflesGroup.rotation.y = RAFFLES_ROTATION_Y;
  rafflesGroup.position.set(
    RAFFLES_ANCHOR.x,
    district.heightAt(RAFFLES_ANCHOR.x, RAFFLES_ANCHOR.z) - 10 * 0.435,
    RAFFLES_ANCHOR.z
  );
  rafflesGroup.userData.source = MODEL_SOURCES.raffles;
  scene.add(rafflesGroup);
}

// Extrude a plan polygon (x, z) upwards from y to y + depth.
function extrudePlan(polygon, depth, y, material, scale = 1) {
  const centre = polygonCentroid(polygon);
  const points = polygon.map(([x, z]) => new THREE.Vector2(
    centre.x + (x - centre.x) * scale,
    -(centre.z + (z - centre.z) * scale)
  ));
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  if (twice < 0) points.reverse();
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), { depth, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Sweep an elliptical section along a horizontal curve, keeping the section
// upright (no Frenet twist on a nearly planar path).
function sweepEllipse(curve, segments, radial, radiusX, radiusY) {
  const positions = [], uvs = [], indices = [];
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    side.crossVectors(tangent, up).normalize();
    for (let j = 0; j <= radial; j++) {
      const angle = j / radial * Math.PI * 2;
      const cos = Math.cos(angle) * radiusX;
      const sin = Math.sin(angle) * radiusY;
      positions.push(
        point.x + side.x * cos,
        point.y + sin,
        point.z + side.z * cos
      );
      uvs.push(t, j / radial);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      indices.push(a, a + radial + 2, a + 1, a, a + radial + 1, a + radial + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function offsetCurve(curve, dx, dy) {
  const points = [];
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    side.crossVectors(tangent, up).normalize();
    points.push(new THREE.Vector3(point.x + side.x * dx, point.y + dy, point.z + side.z * dx));
  }
  return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
}

// Curtain wall tile: 6 bays x 4 floors, tiled by the loft UVs (local units).
function createCurtainWallTextures() {
  const size = 256, cols = 6, rows = 4;
  const cellW = size / cols, cellH = size / rows;
  const wall = document.createElement('canvas');
  wall.width = wall.height = size;
  const ctx = wall.getContext('2d');
  ctx.fillStyle = '#8ea9b6';
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cellW, y = row * cellH;
      const tint = 0.88 + ((col * 7 + row * 13) % 5) * 0.04;
      const gradient = ctx.createLinearGradient(x, y, x, y + cellH);
      gradient.addColorStop(0, `rgba(${Math.round(156 * tint)}, ${Math.round(184 * tint)}, ${Math.round(198 * tint)}, 1)`);
      gradient.addColorStop(0.6, `rgba(${Math.round(132 * tint)}, ${Math.round(162 * tint)}, ${Math.round(178 * tint)}, 1)`);
      gradient.addColorStop(1, `rgba(${Math.round(104 * tint)}, ${Math.round(134 * tint)}, ${Math.round(150 * tint)}, 1)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(x + 1, y + 2, cellW - 2, cellH - 4);
    }
  }
  // Fine vertical mullions and the deep horizontal floor bands that read at a distance.
  ctx.strokeStyle = 'rgba(198, 214, 222, 0.75)';
  ctx.lineWidth = 2;
  for (let col = 0; col <= cols; col++) {
    ctx.beginPath();
    ctx.moveTo(col * cellW, 0);
    ctx.lineTo(col * cellW, size);
    ctx.stroke();
  }
  for (let row = 0; row <= rows; row++) {
    const y = row * cellH;
    ctx.fillStyle = '#d8e2e7';
    ctx.fillRect(0, y, size, 5);
    ctx.fillStyle = 'rgba(70, 96, 110, 0.55)';
    ctx.fillRect(0, y + 5, size, 3);
  }

  const glow = document.createElement('canvas');
  glow.width = glow.height = size;
  const glowCtx = glow.getContext('2d');
  glowCtx.fillStyle = '#000000';
  glowCtx.fillRect(0, 0, size, size);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((col * 5 + row * 3) % 7 > 2) continue;
      glowCtx.fillStyle = (col + row) % 2 ? '#ffd9a0' : '#cfefff';
      glowCtx.fillRect(col * cellW + 5, row * cellH + 6, cellW - 10, cellH - 12);
    }
  }

  const map = new THREE.CanvasTexture(wall);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const glowMap = new THREE.CanvasTexture(glow);
  glowMap.wrapS = glowMap.wrapT = THREE.RepeatWrapping;
  glowMap.colorSpace = THREE.SRGBColorSpace;
  return { map, glow: glowMap };
}

// Helper: Mathematically exact 3D Tension Cable spanning from p1 to p2
function createTensionCable(p1, p2, radius, material) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, len, 6);
  geo.translate(0, len / 2, 0);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(p1);
  mesh.lookAt(p2);
  return mesh;
}

// Global bridge geometry vectors for traffic routing
let qiansimenConfig = null;
let dongshuimenConfig = null;

function alignBridgeToMap(group, config, name) {
  const points = district.data.roads.filter(road => road[1].includes(name) && road[3] && road[3] !== 'no')
    .flatMap(road => road[4].map(([x, z]) => new THREE.Vector3(x, 0, z)));
  let first, last, longest = 0;
  for (const a of points) {
    for (const b of points) {
      const distance = a.distanceToSquared(b);
      if (distance > longest) { longest = distance; first = a; last = b; }
    }
  }
  if (!first || !last) throw new Error(`${name}缺少地图路线`);
  if (first.distanceToSquared(district.raffles) > last.distanceToSquared(district.raffles)) [first, last] = [last, first];
  const oldMid = config.pStart.clone().add(config.pEnd).multiplyScalar(0.5);
  const direction = last.clone().sub(first).normalize();
  const normal = new THREE.Vector3(-direction.z, 0, direction.x);
  const across = (24 / 12) / 5.6;
  const vertical = name === '东水门' ? (172.61 / 12) / 42 : 0.34;
  const newMid = first.clone().add(last).multiplyScalar(0.5).setY(oldMid.y * vertical);
  const oldBasis = new THREE.Matrix4().makeBasis(config.normalVec, new THREE.Vector3(0, 1, 0), config.spanDir);
  const newBasis = new THREE.Matrix4().makeBasis(normal, new THREE.Vector3(0, 1, 0), direction);
  const transform = new THREE.Matrix4().makeTranslation(newMid.x, newMid.y, newMid.z)
    .multiply(newBasis).scale(new THREE.Vector3(across, vertical, Math.sqrt(longest) / config.spanLen))
    .multiply(oldBasis.invert()).multiply(new THREE.Matrix4().makeTranslation(-oldMid.x, -oldMid.y, -oldMid.z));
  group.matrix.copy(transform);
  group.matrixAutoUpdate = false;
  group.matrixWorldNeedsUpdate = true;
  config.pStart.applyMatrix4(transform);
  config.pEnd.applyMatrix4(transform);
  config.spanVec.subVectors(config.pEnd, config.pStart);
  config.spanLen = config.spanVec.length();
  config.spanDir.copy(direction);
  config.normalVec.copy(normal);
  config.roadOffset = 1.25 * vertical;
  config.railY = 12.8 * vertical;
  group.userData.source = name === '东水门'
    ? 'https://dfz.cq.gov.cn/zqlswh/rwby_417819/202406/t20240605_13267997.html'
    : 'https://zfcxjw.cq.gov.cn/zjzj/tszj/qdcq/202211/t20221128_11339950.html';
}

/* ==========================================================================
   Bridges: Qiansimen Bridge & Dongshuimen Bridge (Chongqing "Two Rivers Bridges")
   ========================================================================== */
function buildQiansimenBridge() {
  const bridgeGroup = new THREE.Group();

  // Local construction coordinates are fitted to the OSM bridge route below.
  // Spans Jialing River from Yuzhong (Hongyadong/Cangbai Rd) to Jiangbei (Grand Theatre)
  const pStart = new THREE.Vector3(-18, 14.0, -12); // Yuzhong Abutment
  const pEnd   = new THREE.Vector3(-72, 14.0, -20); // Jiangbei Abutment
  const spanVec = new THREE.Vector3().subVectors(pEnd, pStart);
  const spanLen = spanVec.length();
  const spanDir = spanVec.clone().normalize();
  const normalVec = new THREE.Vector3(-spanDir.z, 0, spanDir.x).normalize();
  const midPoint = new THREE.Vector3().addVectors(pStart, pEnd).multiplyScalar(0.5);

  qiansimenConfig = { pStart, pEnd, spanVec, spanLen, spanDir, normalVec };

  // 1. Double-deck Bridge (Upper Highway + Lower Steel Truss for CRT Line 6)
  const deckW = 5.6;
  const deckH = 2.2;
  const deckGeo = new THREE.BoxGeometry(deckW, deckH, spanLen);
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.65,
    metalness: 0.2
  });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.copy(midPoint);
  deck.lookAt(pEnd);
  deck.castShadow = true;
  deck.receiveShadow = true;
  bridgeGroup.add(deck);

  // Upper Roadway Surface & Center Divider
  const roadGeo = new THREE.BoxGeometry(deckW * 0.96, 0.1, spanLen * 0.99);
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.position.set(0, deckH / 2 + 0.05, 0);
  deck.add(road);

  // Center Divider Strip (where single-plane stay cables anchor)
  const dividerGeo = new THREE.BoxGeometry(0.5, 0.4, spanLen * 0.98);
  const dividerMat = new THREE.MeshStandardMaterial({ color: 0xd93829 });
  const divider = new THREE.Mesh(dividerGeo, dividerMat);
  divider.position.set(0, deckH / 2 + 0.25, 0);
  deck.add(divider);

  // 2. The Iconic "Tian Suo" (天梭) Spindle Pylon Tower (Single Tower)
  // Located at ~60% span in the Jialing river navigation channel
  const pylonT = 0.58;
  const pylonPos = new THREE.Vector3().lerpVectors(pStart, pEnd, pylonT);

  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0xd93829, // Authentic Chongqing Bridge Red
    emissive: 0xff9a36, // warm gold night flood
    emissiveIntensity: 0,
    metalness: 0.35,
    roughness: 0.35
  });
  buildingNightEmissives.push({ material: pylonMat, baseIntensity: 1.2 });

  // Lower Pier Base in River
  const pierBaseGeo = new THREE.CylinderGeometry(2.2, 2.8, 14, 16);
  const pierBase = new THREE.Mesh(pierBaseGeo, pylonMat);
  pierBase.position.set(pylonPos.x, 7.0, pylonPos.z);
  pierBase.castShadow = true;
  bridgeGroup.add(pierBase);

  // Roadway Level Waist & Aperture
  const waistGeo = new THREE.CylinderGeometry(2.4, 2.2, 8, 16);
  const waist = new THREE.Mesh(waistGeo, pylonMat);
  waist.position.set(pylonPos.x, 16.0, pylonPos.z);
  bridgeGroup.add(waist);

  // Soaring Spindle Mast (Tapered upward to needle tip at y=44)
  const mastGeo = new THREE.CylinderGeometry(0.7, 2.4, 28, 16);
  const mast = new THREE.Mesh(mastGeo, pylonMat);
  mast.position.set(pylonPos.x, 30.0, pylonPos.z);
  mast.castShadow = true;
  bridgeGroup.add(mast);

  // 3. Authentic Single-Plane Stay Cables (单索面稀索体系)
  // All cables radiate from the upper tower mast down to the center median of the bridge deck
  const cableMat = new THREE.MeshBasicMaterial({ color: 0xfff3da });
  const numCables = 9;

  // Fore-stays (anchoring towards Yuzhong / Hongyadong)
  for (let i = 0; i < numCables; i++) {
    const cableFrac = (i + 1) / (numCables + 1);
    const towerY = 26.0 + cableFrac * 14.0; // Anchors along mast height
    const towerAnchor = new THREE.Vector3(pylonPos.x, towerY, pylonPos.z);

    const deckT = pylonT - 0.05 - cableFrac * 0.44; // Spread towards Yuzhong
    if (deckT > 0.02) {
      const deckAnchor = new THREE.Vector3().lerpVectors(pStart, pEnd, deckT);
      deckAnchor.y += 1.4; // Anchor onto the center divider
      const cable = createTensionCable(towerAnchor, deckAnchor, 0.07, cableMat);
      bridgeGroup.add(cable);
    }
  }

  // Back-stays (anchoring towards Jiangbei / Grand Theatre)
  for (let i = 0; i < numCables; i++) {
    const cableFrac = (i + 1) / (numCables + 1);
    const towerY = 26.0 + cableFrac * 14.0;
    const towerAnchor = new THREE.Vector3(pylonPos.x, towerY, pylonPos.z);

    const deckT = pylonT + 0.05 + cableFrac * 0.35; // Spread towards Jiangbei
    if (deckT < 0.98) {
      const deckAnchor = new THREE.Vector3().lerpVectors(pStart, pEnd, deckT);
      deckAnchor.y += 1.4;
      const cable = createTensionCable(towerAnchor, deckAnchor, 0.07, cableMat);
      bridgeGroup.add(cable);
    }
  }

  // 4. Lower Deck CRT Line 6 Train (重庆轨道交通6号线黄色列车)
  const trainGroup = new THREE.Group();
  const trainCarGeo = new THREE.BoxGeometry(1.6, 1.2, 5.0);
  const trainCarMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15, // CRT Yellow
    metalness: 0.6,
    roughness: 0.3
  });
  const trainWinMat = new THREE.MeshStandardMaterial({
    color: 0xbae6fd,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.8
  });
  buildingNightEmissives.push({ material: trainWinMat, baseIntensity: 1.2 });

  for (let tc = 0; tc < 3; tc++) {
    const car = new THREE.Mesh(trainCarGeo, trainCarMat);
    const zPos = (tc - 1) * 5.4;
    car.position.set(0, 0, zPos);

    // Passenger illuminated windows
    const winGeo = new THREE.BoxGeometry(1.65, 0.45, 4.2);
    const win = new THREE.Mesh(winGeo, trainWinMat);
    win.position.set(0, 0.1, zPos);
    trainGroup.add(car, win);
  }

  // Front Headlights (+Z forward)
  const trainHead = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false }));
  trainHead.position.set(0, 0, 5.4 + 2.55);
  // Rear Taillights (-Z rear)
  const trainTail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.1), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 1, depthWrite: false }));
  trainTail.position.set(0, 0, -5.4 - 2.55);
  buildingNightEmissives.push(
    { material: trainHead.material, property: 'opacity', baseIntensity: 1 },
    { material: trainTail.material, property: 'opacity', baseIntensity: 1 }
  );
  trainGroup.add(trainHead, trainTail);

  trainGroup.position.copy(pStart);
  trainGroup.position.y = 12.8;
  trainGroup.lookAt(pEnd);
  scene.add(trainGroup);
  metroTrainObj = trainGroup;
  metroTrainObj.scale.setScalar(0.25);

  // Landmark Hit Box
  const bridgeHitBox = new THREE.Mesh(
    new THREE.BoxGeometry(18, 35, 45),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  bridgeHitBox.position.copy(pylonPos);
  bridgeHitBox.userData = {
    name: '千厮门嘉陵江大桥',
    desc: '横跨嘉陵江连通渝中洪崖洞与江北嘴。采用世界首创“天梭型单索面”稀索钢桁梁体系，上层双向车流，下层轨道交通6号线飞渡江波。'
  };
  interactiveObjects.push(bridgeHitBox);
  bridgeGroup.add(bridgeHitBox);

  alignBridgeToMap(bridgeGroup, qiansimenConfig, '千厮门');
  scene.add(bridgeGroup);
}

function buildDongshuimenBridge() {
  const bridgeGroup = new THREE.Group();

  // Spans Yangtze River from Yuzhong (Wanglongmen) to Nan'an (Shangxinjie)
  const pStart = new THREE.Vector3(18, 14.0, -14);
  const pEnd   = new THREE.Vector3(72, 14.0, -24);
  const spanVec = new THREE.Vector3().subVectors(pEnd, pStart);
  const spanLen = spanVec.length();
  const spanDir = spanVec.clone().normalize();
  const normalVec = new THREE.Vector3(-spanDir.z, 0, spanDir.x).normalize();
  const midPoint = new THREE.Vector3().addVectors(pStart, pEnd).multiplyScalar(0.5);

  dongshuimenConfig = { pStart, pEnd, spanVec, spanLen, spanDir, normalVec };

  // Deck
  const deckW = 5.6;
  const deckH = 2.0;
  const deckGeo = new THREE.BoxGeometry(deckW, deckH, spanLen);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65 });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.copy(midPoint);
  deck.lookAt(pEnd);
  deck.castShadow = true;
  bridgeGroup.add(deck);

  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0xd93829,
    emissive: 0xff9a36,
    emissiveIntensity: 0,
    metalness: 0.35,
    roughness: 0.35
  });
  buildingNightEmissives.push({ material: pylonMat, baseIntensity: 1.15 });
  const cableMat = new THREE.MeshBasicMaterial({ color: 0xfff3da });
  // The north and south pylons are 162.49m and 172.61m respectively.
  for (const [pylonT, heightRatio] of [[0.2, 162.49 / 172.61], [0.8, 1]]) {
    const pylonPos = new THREE.Vector3().lerpVectors(pStart, pEnd, pylonT);
    const pylonBase = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 14 * heightRatio, 16), pylonMat);
    pylonBase.position.set(pylonPos.x, 7 * heightRatio, pylonPos.z);
    pylonBase.castShadow = true;
    const pylonMast = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 2.4, 28 * heightRatio, 16), pylonMat);
    pylonMast.position.set(pylonPos.x, 28 * heightRatio, pylonPos.z);
    pylonMast.castShadow = true;
    bridgeGroup.add(pylonBase, pylonMast);
    for (let i = 0; i < 8; i++) {
      const f = (i + 1) / 9;
      const towerAnchor = new THREE.Vector3(pylonPos.x, (25 + f * 12) * heightRatio, pylonPos.z);
      for (const side of [-1, 1]) {
        const reach = side < 0 ? pylonT : 1 - pylonT;
        const deckT = pylonT + side * (0.025 + f * Math.min(reach * 0.9, 0.29));
        const deckAnchor = new THREE.Vector3().lerpVectors(pStart, pEnd, deckT);
        deckAnchor.y += 1.3;
        bridgeGroup.add(createTensionCable(towerAnchor, deckAnchor, 0.06, cableMat));
      }
    }
  }

  alignBridgeToMap(bridgeGroup, dongshuimenConfig, '东水门');
  scene.add(bridgeGroup);
}

/* ==========================================================================
   Yangtze River Cableway (长江索道)
   ========================================================================== */
function buildYangtzeCableway() {
  const cablewayGroup = new THREE.Group();

  const northStation = district.anchor(106.5791543, 29.5606398);
  const southStation = district.project(106.5897965, 29.5555592);
  northStation.y += 3;
  southStation.y = northStation.y - 42 / 12;
  const cableMidpoint = northStation.clone().add(southStation).multiplyScalar(0.5);
  cableMidpoint.y -= 3;
  cablewayCurve = new THREE.QuadraticBezierCurve3(northStation, cableMidpoint, southStation);
  const cableGeo = new THREE.TubeGeometry(cablewayCurve, 32, 0.12, 6, false);
  const cableMat = new THREE.MeshBasicMaterial({ color: 0x64748b });
  const cable = new THREE.Mesh(cableGeo, cableMat);
  cablewayGroup.add(cable);

  // The Iconic Retro Orange-Red Cable Car Cabin
  cableCarObj = new THREE.Group();
  cableCarObj.scale.setScalar(0.22);
  const cabinGeo = new THREE.BoxGeometry(3.0, 2.2, 2.0);
  const cabinMat = new THREE.MeshStandardMaterial({
    color: 0xf97316, // Orange
    metalness: 0.5,
    roughness: 0.3
  });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);

  // Cabin Windows
  const windowGeo = new THREE.BoxGeometry(3.1, 0.9, 1.8);
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0xfef08a,
    emissiveIntensity: 0.6
  });
  buildingNightEmissives.push({ material: windowMat, baseIntensity: 1.2 });
  const cabinWindow = new THREE.Mesh(windowGeo, windowMat);
  cableCarObj.add(cabin, cabinWindow);

  // Hanger Arm
  const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8);
  const arm = new THREE.Mesh(armGeo, cableMat);
  arm.position.y = 2.0;
  cableCarObj.add(arm);

  cablewayCurve.getPoint(0.5, cableCarObj.position);
  cableCarObj.position.y -= 3.1 * 0.22;
  const cableDirection = cablewayCurve.getTangent(0.5);
  cableCarObj.rotation.y = -Math.atan2(cableDirection.z, cableDirection.x);
  cablewayGroup.add(cableCarObj);

  // Landmark Hit Box
  const cableHitBox = new THREE.Mesh(
    new THREE.BoxGeometry(10, 8, 10),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  cableHitBox.userData = {
    name: '长江索道',
    desc: '被誉为“万里长江第一条空中走廊”，国家4A级旅游景区，载着游人飞渡浩荡长江，体验山城独特的空中公共交通传奇。'
  };
  interactiveObjects.push(cableHitBox);
  cableCarObj.add(cableHitBox);

  scene.add(cablewayGroup);
}

/* ==========================================================================
   Mountain City Backdrop & Stilted Architecture (山城洪崖洞与高低叠落)
   ========================================================================== */

/* ==========================================================================
   Ships, Ferries & Wharf Pontoons (两江游轮与码头趸船)
   ========================================================================== */
function buildShipsAndDocks() {
  const shipsGroup = new THREE.Group();

  // Floating Wharf Pontoons (码头趸船) alongside Chaotianmen steps
  const dockGeo = new THREE.BoxGeometry(16, 1.5, 6);
  const dockMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5 });
  const dock1 = new THREE.Mesh(dockGeo, dockMat);
  dock1.position.set(-14, 1.0, 26);
  dock1.rotation.y = -0.5;
  const dock2 = new THREE.Mesh(dockGeo, dockMat);
  dock2.position.set(14, 1.0, 26);
  dock2.rotation.y = 0.5;
  shipsGroup.add(dock1, dock2);

  // Two-Rivers Sightseeing Cruises (两江游轮 - e.g. "朝天门号", "交运明珠号")
  // Cruise 1: Flagship Cruise sailing forward into the confluence
  const cruise1 = createCruiser(0xf8fafc, 0xd97706);
  cruise1.position.set(-8, 1.2, 42);
  cruise1.rotation.y = 0.2;
  shipsGroup.add(cruise1);
  animatedBoats.push({
    mesh: cruise1,
    baseX: -8,
    baseZ: 42,
    radius: 12,
    speed: 0.0008,
    heading: 0.2,
    bobSpeed: 1.8
  });

  // Cruise 2: Sailing along the Yangtze River
  const cruise2 = createCruiser(0x0284c7, 0xfacc15);
  cruise2.position.set(35, 1.2, 20);
  cruise2.rotation.y = -1.2;
  shipsGroup.add(cruise2);
  animatedBoats.push({
    mesh: cruise2,
    baseX: 35,
    baseZ: 20,
    radius: 16,
    speed: 0.0011,
    heading: -1.2,
    bobSpeed: 2.2
  });

  // Cruise 3: Moored at Chaotianmen Dock with glowing cabin windows
  const cruise3 = createCruiser(0xe2e8f0, 0xef4444);
  cruise3.position.set(-16, 1.2, 30);
  cruise3.rotation.y = -0.5;
  shipsGroup.add(cruise3);

  // Landmark Hit Box for Cruise & Wharf
  const shipHitBox = new THREE.Mesh(
    new THREE.BoxGeometry(22, 10, 22),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  shipHitBox.position.set(0, 5, 36);
  shipHitBox.userData = {
    name: '两江游轮 & 码头水域',
    desc: '朝天门作为长江黄金水道门户，汇集“朝天门号”、“交运明珠”等豪华游轮，夜游两江可饱览山城三维璀璨立体画卷。'
  };
  interactiveObjects.push(shipHitBox);
  shipsGroup.add(shipHitBox);

  shipsGroup.scale.setScalar(0.35);
  shipsGroup.position.copy(district.tip);
  scene.add(shipsGroup);
}

// Helper: Create Sleek Miniature River Cruise Ship
function createCruiser(hullColor, accentColor) {
  const boat = new THREE.Group();

  // Ship Hull
  const hullGeo = new THREE.BoxGeometry(4.2, 1.6, 12);
  const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.4 });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  boat.add(hull);

  // Deck Tiers
  const deck1Geo = new THREE.BoxGeometry(3.6, 1.2, 9);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const deck1 = new THREE.Mesh(deck1Geo, deckMat);
  deck1.position.set(0, 1.3, -0.5);
  boat.add(deck1);

  const deck2Geo = new THREE.BoxGeometry(2.8, 1.0, 6);
  const deck2 = new THREE.Mesh(deck2Geo, deckMat);
  deck2.position.set(0, 2.3, -1.0);
  boat.add(deck2);

  // Glowing Windows / Party Deck Lights
  const windowGeo = new THREE.BoxGeometry(3.7, 0.4, 8.5);
  const windowMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.9
  });
  const win = new THREE.Mesh(windowGeo, windowMat);
  win.position.set(0, 1.3, -0.5);
  boat.add(win);
  buildingNightEmissives.push({ material: windowMat, baseIntensity: 1.0 });

  // Funnel / Chimney
  const funnelGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.4, 8);
  const funnelMat = new THREE.MeshStandardMaterial({ color: accentColor });
  const funnel = new THREE.Mesh(funnelGeo, funnelMat);
  funnel.position.set(0, 3.2, -1.8);
  boat.add(funnel);

  boat.scale.set(0.85, 0.85, 0.85);
  return boat;
}

/* ==========================================================================
   Bridge Traffic & Riverside Cars (真实桥梁双向车流系统)
   ========================================================================== */
function buildTrafficSystem() {
  const trafficGroup = new THREE.Group();
  animatedCars = [];

  const carColors = [0xffffff, 0xfacc15, 0xef4444, 0x38bdf8, 0x94a3b8];
  const bodyGeo = new THREE.BoxGeometry(0.9, 0.45, 1.6);
  const bodyMaterials = carColors.map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  const headGeo = new THREE.BoxGeometry(0.7, 0.15, 0.1);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false });
  const tailGeo = new THREE.BoxGeometry(0.7, 0.12, 0.1);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 1, depthWrite: false });
  buildingNightEmissives.push(
    { material: headMat, property: 'opacity', baseIntensity: 1 },
    { material: tailMat, property: 'opacity', baseIntensity: 1 }
  );
  const bridgeLedMaterials = [0x00eaff, 0xff32b8].map(color => {
    const material = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true });
    buildingNightEmissives.push({ material, property: 'opacity', baseIntensity: 1 });
    return material;
  });

  // Helper to spawn traffic on a bridge
  function spawnBridgeTraffic(cfg, count) {
    if (!cfg) return;
    [-1, 1].forEach((side, index) => {
      const start = cfg.pStart.clone().addScaledVector(cfg.normalVec, side * 0.92);
      const end = cfg.pEnd.clone().addScaledVector(cfg.normalVec, side * 0.92);
      start.y += cfg.roadOffset;
      end.y += cfg.roadOffset;
      trafficGroup.add(createTensionCable(start, end, 0.035, bridgeLedMaterials[index]));
    });

    for (let i = 0; i < count; i++) {
      const isOutbound = i % 2 === 0; // Alternating lanes
      const laneOffset = isOutbound ? 0.45 : -0.45;
      const bodyMat = bodyMaterials[Math.floor(Math.random() * bodyMaterials.length)];

      const carGroup = new THREE.Group();
      carGroup.scale.setScalar(0.25);

      // Car Body
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.castShadow = false;
      carGroup.add(body);

      // Headlights (Bright White LED at front +Z)
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(0, 0, 0.8);
      carGroup.add(head);

      // Taillights (Bright Red at rear -Z)
      const tail = new THREE.Mesh(tailGeo, tailMat);
      tail.position.set(0, 0, -0.8);
      carGroup.add(tail);

      trafficGroup.add(carGroup);
      carGroup.rotation.y = Math.atan2(cfg.spanDir.x, cfg.spanDir.z) + (isOutbound ? 0 : Math.PI);

      animatedCars.push({
        mesh: carGroup,
        cfg,
        isOutbound,
        laneOffset,
        t: Math.random(),
        speed: 0.05 + Math.random() * 0.03
      });
    }
  }

  // 14 cars on Qiansimen Bridge across Jialing River
  spawnBridgeTraffic(qiansimenConfig, 14);

  // 10 cars on Dongshuimen Bridge across Yangtze River
  spawnBridgeTraffic(dongshuimenConfig, 10);

  scene.add(trafficGroup);
}

/* ==========================================================================
   Interaction & Landmark Picking
   ========================================================================== */
const FOCUS_DURATION = 700;
const lastHoverPoint = new THREE.Vector3();
const lastClickPoint = new THREE.Vector3();
let hasHoverPoint = false;
let hasClickPoint = false;
let focusMarker = null;
let selectionLocked = false;
let lastFocusAt = 0;

function ensureFocusMarker() {
  if (focusMarker) return focusMarker;
  focusMarker = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 4.4, 40),
    new THREE.MeshBasicMaterial({ color: 0x6fe6ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  focusMarker.rotation.x = -Math.PI / 2;
  focusMarker.renderOrder = 5;
  scene.add(focusMarker);
  return focusMarker;
}

function pickInteractive(clientX, clientY) {
  mouse.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  return raycaster.intersectObjects(interactiveObjects)
    .find(hit => isVisibleInHierarchy(hit.object)) ?? null;
}

function clearSelection() {
  selectionLocked = false;
  if (focusMarker) focusMarker.visible = false;
  tooltip.classList.add('hidden');
}

// Clicking only marks the point and locks the info card; the camera never moves.
function lockSelection(hit, clientX, clientY) {
  const data = hit.object.userData ?? {};
  if (!data.name) return;
  const marker = ensureFocusMarker();
  const groundY = district?.heightAt ? district.heightAt(hit.point.x, hit.point.z) : hit.point.y;
  marker.position.set(hit.point.x, groundY + 0.9, hit.point.z);
  marker.visible = true;
  selectionLocked = true;
  tooltipTitle.textContent = data.name;
  tooltipContent.textContent = `${data.desc ?? '已采集的公开资料地标。'}（位置标记，未逐栋高亮建筑）`;
  tooltip.style.left = `${clientX}px`;
  tooltip.style.top = `${clientY}px`;
  tooltip.classList.remove('hidden');
  lastClickPoint.copy(hit.point);
  hasClickPoint = true;
}

function focusCameraOn(point) {
  const pose = computeFocusPose(camera.position, controls.target, point, {
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
    minPolarAngle: 0.12,
    maxPolarAngle: controls.maxPolarAngle
  });
  stopCameraMotion();
  new TWEEN.Tween(camera.position, cameraTweens)
    .to(pose.position, FOCUS_DURATION)
    .easing(TWEEN.Easing.Cubic.InOut)
    .start();
  new TWEEN.Tween(controls.target, cameraTweens)
    .to(pose.target, FOCUS_DURATION)
    .easing(TWEEN.Easing.Cubic.InOut)
    .start();
  lastFocusAt = performance.now();
}

function setupInteractions() {
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  const canvas = renderer.domElement;
  const activePointers = new Map();
  let dragging = false;
  let tap = null;

  let hoverRaf = null;
  const updateHover = (e) => {
    if (selectionLocked || activePointers.size > 0 || dragging) return;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = null;
      if (selectionLocked || activePointers.size > 0 || dragging) return;
      const hit = pickInteractive(e.clientX, e.clientY);
      if (hit?.object.userData?.name) {
        hoveredObject = hit.object;
        lastHoverPoint.copy(hit.point);
        hasHoverPoint = true;
        document.body.style.cursor = 'pointer';
        tooltipTitle.textContent = hit.object.userData.name;
        tooltipContent.textContent = hit.object.userData.desc ?? '';
        tooltip.style.left = `${e.clientX}px`;
        tooltip.style.top = `${e.clientY}px`;
        tooltip.classList.remove('hidden');
      } else {
        hoveredObject = null;
        document.body.style.cursor = 'default';
        tooltip.classList.add('hidden');
      }
    });
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 1) e.preventDefault(); // stop middle-click autoscroll while panning
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (activePointers.size === 1) dragging = false;
    if (activePointers.size > 1) { dragging = true; tap = null; } // two-finger gestures are never taps
  });

  canvas.addEventListener('pointermove', (e) => {
    const start = activePointers.get(e.pointerId);
    if (start && !dragging && classifyPointer({
      startX: start.x, startY: start.y, endX: e.clientX, endY: e.clientY, pointerType: e.pointerType
    }) === 'drag') {
      dragging = true;
      tap = null;
      stopCameraMotion();
      if (!selectionLocked) tooltip.classList.add('hidden');
    }
    updateHover(e);
  });

  canvas.addEventListener('pointerup', (e) => {
    const start = activePointers.get(e.pointerId);
    activePointers.delete(e.pointerId);
    if (!start || e.button !== 0 || activePointers.size > 0) return;

    const gesture = classifyPointer({
      startX: start.x, startY: start.y, endX: e.clientX, endY: e.clientY, pointerType: e.pointerType
    });
    if (gesture !== 'click' || dragging) return;

    const hit = pickInteractive(e.clientX, e.clientY);
    if (e.pointerType === 'touch' && hit) {
      const now = performance.now();
      if (isDoubleTap(tap, { time: now, x: e.clientX, y: e.clientY })) {
        tap = null;
        focusCameraOn(hit.point);
        return;
      }
      tap = { time: now, x: e.clientX, y: e.clientY };
    }

    if (hit) lockSelection(hit, e.clientX, e.clientY);
    else clearSelection();
  });

  const endPointer = (e) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) dragging = false;
  };
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => {
    endPointer(e);
    if (selectionLocked) return;
    hoveredObject = null;
    document.body.style.cursor = 'default';
    tooltip.classList.add('hidden');
  });

  // Wheel zooms to the cursor (OrbitControls.zoomToCursor) and ends any preset move.
  canvas.addEventListener('wheel', stopCameraMotion, { passive: true });

  canvas.addEventListener('dblclick', (e) => {
    if (isTypingTarget(e.target) || performance.now() - lastFocusAt < 400) return;
    const hit = pickInteractive(e.clientX, e.clientY);
    if (hit) focusCameraOn(hit.point);
  });
}

/* ==========================================================================
   UI Controls & Viewpoint Presets
   ========================================================================= */
function setupUI() {
  document.querySelectorAll('.sidebar-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = `${button.dataset.sidebarLabel} · ${expanded ? '收起' : '展开'}`;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !expanded;
      button.parentElement.classList.toggle('is-collapsed', !expanded);
    });
  });

  // 1. Environment switchers
  const envBtns = document.querySelectorAll('.env-btn');
  envBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      envBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const env = btn.getAttribute('data-env');
      updateEnvironment(env);
    });
  });

  // 2. Camera Viewpoints
  const cityCenter = district.bounds.getCenter(new THREE.Vector3());
  const bridgeCenter = qiansimenConfig.pStart.clone().add(qiansimenConfig.pEnd).multiplyScalar(0.5);
  const cableCenter = cablewayCurve.getPoint(0.5);
  const viewPresets = {
    overview: { pos: cityCenter.clone().add(new THREE.Vector3(160, 200, 220)), target: cityCenter.clone().setY(8) },
    chaotianmen: { pos: district.raffles.clone().add(new THREE.Vector3(94.2, 39.2, 51.9)), target: district.raffles.clone().add(new THREE.Vector3(-13.8, 10.2, 5.9)) },
    confluence: { pos: district.tip.clone().add(new THREE.Vector3(110, 80, 60)), target: district.tip.clone().add(new THREE.Vector3(15, 0, -5)) },
    skybridge: { pos: district.raffles.clone().add(new THREE.Vector3(25, 32, 28)), target: district.raffles.clone().add(new THREE.Vector3(0, 21, 0)) },
    bridge: { pos: bridgeCenter.clone().add(new THREE.Vector3(25, 22, 32)), target: bridgeCenter },
    cablecar: { pos: cableCenter.clone().add(new THREE.Vector3(30, 18, 30)), target: cableCenter },
    jiefangbei: { pos: district.jiefangbei.clone().add(new THREE.Vector3(9, 8, 12)), target: district.jiefangbei.clone().add(new THREE.Vector3(0, 1, 0)) },
    auditorium: { pos: district.auditorium.clone().add(new THREE.Vector3(-16, 12, 20)), target: district.auditorium.clone().add(new THREE.Vector3(0, 2, 0)) },
    pipa: { pos: (district.parks['枇杷山公园'] || cityCenter).clone().add(new THREE.Vector3(20, 25, 28)), target: (district.parks['枇杷山公园'] || cityCenter).clone() },
    huguang: { pos: district.huguang.clone().add(new THREE.Vector3(12, 12, 17)), target: district.huguang.clone() },
    shibati: { pos: district.shibati.clone().add(new THREE.Vector3(17, 17, 22)), target: district.shibati.clone() },
    zengjiayan: { pos: district.zengjiayan.clone().add(new THREE.Vector3(32, 25, 35)), target: district.zengjiayan.clone() }
  };

  const camBtns = document.querySelectorAll('.cam-btn');
  camBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      camBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const viewKey = btn.getAttribute('data-view');
      const preset = viewPresets[viewKey];
      if (preset) {
        stopCameraMotion();

        new TWEEN.Tween(camera.position, cameraTweens)
          .to(preset.pos, 1400)
          .easing(TWEEN.Easing.Cubic.InOut)
          .start();

        new TWEEN.Tween(controls.target, cameraTweens)
          .to(preset.target, 1400)
          .easing(TWEEN.Easing.Cubic.InOut)
          .start();
      }
    });
  });

  // 3. Auto-rotate
  const autoRotateToggle = document.getElementById('toggle-autorotate');
  if (autoRotateToggle) {
    autoRotateToggle.checked = CONFIG.autoRotate;
    autoRotateToggle.addEventListener('change', (e) => {
      cameraTweens.removeAll();
      CONFIG.autoRotate = e.target.checked;
      controls.autoRotate = CONFIG.autoRotate;
    });
  }

  navigation = createNavigationDemo({
    scene, camera, controls, district, cameraTweens, stopCameraMotion
  });
  window.__navigation = navigation;
}

function setupPhotoBooth() {
  let openEditor;
  document.getElementById('photo-open').addEventListener('click', () => {
    openEditor ??= setupPhotoEditor();
    openEditor();
  });
}

function setupPhotoEditor() {
  const page = document.getElementById('photo-page');
  const openButton = document.getElementById('photo-open');
  const background = document.getElementById('photo-background');
  const viewSelect = document.getElementById('photo-view');
  const input = document.getElementById('photo-file');
  const layer = document.getElementById('photo-layer');
  const preview = document.getElementById('photo-preview');
  const scale = document.getElementById('photo-scale');
  const save = document.getElementById('photo-save');
  const remove = document.getElementById('photo-remove');
  const status = document.getElementById('photo-status');
  let photo = null;
  let photoURL = null;
  let loadVersion = 0;
  let drag = null;
  let x = 0.5;
  let y = 0.7;
  let previousAutoRotate = false;
  let capturing = false;

  const captureBackground = () => {
    if (!page.open) return;
    controls.update(0);
    skyMesh.position.copy(camera.position);
    renderer.render(scene, camera);
    background.width = renderer.domElement.width;
    background.height = renderer.domElement.height;
    background.getContext('2d').drawImage(renderer.domElement, 0, 0);
    capturing = false;
    save.disabled = !photo;
    status.textContent = '背景已定格。拖动人像，保存你的相框合影。';
  };

  const openEditor = () => {
    previousAutoRotate = CONFIG.autoRotate;
    stopCameraMotion();
    page.showModal();
    openButton.setAttribute('aria-expanded', 'true');
    viewSelect.value = '';
    if (!photo) document.getElementById('photo-demo').click();
    layer.hidden = !photo;
    captureBackground();
  };
  document.getElementById('photo-close').addEventListener('click', () => page.close());
  page.addEventListener('close', () => {
    openButton.setAttribute('aria-expanded', 'false');
    cameraTweens.removeAll();
    loadVersion++;
    drag = null;
    layer.hidden = true;
    capturing = false;
    CONFIG.autoRotate = previousAutoRotate;
    controls.autoRotate = previousAutoRotate;
    document.getElementById('toggle-autorotate').checked = previousAutoRotate;
  });

  const positionPhoto = () => {
    preview.style.left = `${x * 100}%`;
    preview.style.top = `${y * 100}%`;
    preview.style.width = `${scale.value}%`;
  };

  document.getElementById('photo-demo').addEventListener('click', () => {
    const demo = document.createElement('canvas');
    demo.width = demo.height = 512;
    const context = demo.getContext('2d');
    context.font = '400px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('🧑', 256, 270);
    loadVersion++;
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = null;
    photo = demo;
    preview.src = demo.toDataURL('image/png');
    x = 0.5;
    y = 0.7;
    scale.value = '26';
    positionPhoto();
    layer.hidden = false;
    scale.disabled = remove.disabled = false;
    save.disabled = capturing;
    status.textContent = '已使用 🧑 演示。拖动、缩放后可保存合影，也可上传自己的照片替换。';
  });

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      status.textContent = '请选择 PNG、JPG 或 WebP 图片。';
      input.value = '';
      return;
    }
    const version = ++loadVersion;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.src = url;
    status.textContent = '正在读取照片…';
    try {
      await image.decode();
      if (version !== loadVersion) {
        URL.revokeObjectURL(url);
        return;
      }
      if (photoURL) URL.revokeObjectURL(photoURL);
      photoURL = url;
      photo = image;
      preview.src = url;
      x = 0.5;
      y = 0.7;
      scale.value = '26';
      positionPhoto();
      layer.hidden = false;
      scale.disabled = remove.disabled = false;
      save.disabled = capturing;
      status.textContent = '照片已就绪。选择镜头，拖动照片后保存合影。';
    } catch {
      URL.revokeObjectURL(url);
      if (version === loadVersion) status.textContent = '图片无法读取，请换一张照片。';
    }
    if (version === loadVersion) input.value = '';
  });

  viewSelect.addEventListener('change', event => {
    capturing = true;
    save.disabled = true;
    status.textContent = '正在切换背景镜头…';
    if (event.target.value) {
      document.querySelector(`.cam-btn[data-view="${event.target.value}"]`).click();
      cameraTweens.getAll().at(-1).onComplete(captureBackground);
    } else {
      stopCameraMotion();
      captureBackground();
    }
  });
  scale.addEventListener('input', positionPhoto);

  preview.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    preview.focus({ preventScroll: true });
    drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x, y };
    preview.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  preview.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    x = Math.max(0, Math.min(1, drag.x + (event.clientX - drag.clientX) / layer.clientWidth));
    y = Math.max(0, Math.min(1, drag.y + (event.clientY - drag.clientY) / layer.clientHeight));
    positionPhoto();
  });
  preview.addEventListener('lostpointercapture', () => { drag = null; });
  preview.addEventListener('keydown', event => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.code];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    x = Math.max(0, Math.min(1, x + direction[0] * 0.01));
    y = Math.max(0, Math.min(1, y + direction[1] * 0.01));
    positionPhoto();
  });

  remove.addEventListener('click', () => {
    loadVersion++;
    layer.hidden = true;
    preview.removeAttribute('src');
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = null;
    photo = null;
    input.value = '';
    scale.disabled = save.disabled = remove.disabled = true;
    status.textContent = '照片已移除。';
  });

  save.addEventListener('click', () => {
    if (!photo || capturing) return;
    save.disabled = true;
    status.textContent = '正在生成合影…';
    try {
      const output = document.createElement('canvas');
      const frame = document.querySelector('.photo-frame');
      const frameRect = frame.getBoundingClientRect();
      const stageRect = background.getBoundingClientRect();
      const ratio = background.width / stageRect.width;
      const insetX = (stageRect.left - frameRect.left) * ratio;
      const insetY = (stageRect.top - frameRect.top) * ratio;
      output.width = Math.round(frameRect.width * ratio);
      output.height = Math.round(frameRect.height * ratio);
      const context = output.getContext('2d');
      context.fillStyle = '#fffdf7';
      context.fillRect(0, 0, output.width, output.height);
      context.drawImage(background, insetX, insetY);
      const rect = preview.getBoundingClientRect();
      context.save();
      context.beginPath();
      context.rect(insetX, insetY, background.width, background.height);
      context.clip();
      context.drawImage(photo, (rect.left - frameRect.left) * ratio,
        (rect.top - frameRect.top) * ratio, rect.width * ratio, rect.height * ratio);
      context.restore();
      frame.querySelectorAll('.photo-frame-caption > *').forEach(label => {
        const bounds = label.getBoundingClientRect();
        const style = getComputedStyle(label);
        context.fillStyle = style.color;
        context.font = `${style.fontWeight} ${parseFloat(style.fontSize) * ratio}px ${style.fontFamily}`;
        context.textBaseline = 'top';
        context.fillText(label.textContent, (bounds.left - frameRect.left) * ratio,
          (bounds.top - frameRect.top) * ratio);
      });
      output.toBlob(blob => {
        save.disabled = !photo;
        if (!blob) {
          status.textContent = '图片生成失败，请重试。';
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = '朝天门合影.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = '合影已生成，请查看浏览器下载。';
      }, 'image/png');
    } catch {
      save.disabled = !photo;
      status.textContent = '保存失败，请重试或使用较小的照片。';
    }
  });
  return openEditor;
}

/* ==========================================================================
   Keyboard Camera Navigation (方向键平滑调整相机镜头)
   ========================================================================== */
const keyState = {};
const PAN_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
const YAW_KEYS = ['KeyQ', 'KeyE'];

function stopCameraMotion() {
  cameraTweens.removeAll();
  CONFIG.autoRotate = false;
  controls.autoRotate = false;
  const toggle = document.getElementById('toggle-autorotate');
  if (toggle) toggle.checked = false;
}

function setupKeyboardControls() {
  const clearKeys = () => {
    for (const key in keyState) delete keyState[key];
    lastFrameTime = null;
  };
  window.addEventListener('blur', clearKeys);
  document.addEventListener('visibilitychange', clearKeys);
  document.addEventListener('focusin', clearKeys);
  window.addEventListener('keydown', (e) => {
    if (document.getElementById('photo-page').open) return;
    if (isTypingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      keyState[e.code] = true;
      return;
    }
    if (e.code === 'Escape') {
      clearSelection();
      return;
    }
    if (e.code === 'KeyF') {
      const point = hasHoverPoint ? lastHoverPoint : hasClickPoint ? lastClickPoint : null;
      if (point) focusCameraOn(point);
      e.preventDefault();
      return;
    }
    if (PAN_KEYS.includes(e.code) || YAW_KEYS.includes(e.code)) {
      keyState[e.code] = true;
      stopCameraMotion();
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (keyState[e.code]) {
      keyState[e.code] = false;
    }
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.needsUpdate = true;
}

/* ==========================================================================
   Animation Loop
   ========================================================================== */
let lastFrameTime = null;
let waveTime = 0;
let boatTime = 0;
let trafficTime = 0;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = lastFrameTime === null || document.hidden ? 0 : Math.min((now - lastFrameTime) * 0.001, 0.1);
  lastFrameTime = now;

  // Tween update
  cameraTweens.update(now, false);
  environmentTweens.update(now, false);
  skyMesh.position.copy(camera.position);
  skyMaterial.uniforms.uTime.value += delta;

  // Keyboard: WASD / arrows pan on the ground plane, Q/E orbit yaw around the target.
  const hasKey = PAN_KEYS.some(code => keyState[code]) || YAW_KEYS.some(code => keyState[code]);

  if (hasKey) {
    const speed = keyState['ShiftLeft'] || keyState['ShiftRight'] ? 2.4 : 1;

    const yaw = Number(!!keyState['KeyE']) - Number(!!keyState['KeyQ']);
    if (yaw) {
      const offset = cameraOffset.subVectors(camera.position, controls.target);
      const spherical = cameraSpherical.setFromVector3(offset);
      spherical.theta += yaw * 1.2 * speed * delta;
      offset.setFromSpherical(spherical);
      camera.position.addVectors(controls.target, offset);
    }

    const forwardAmount = Number(!!keyState['KeyW'] || !!keyState['ArrowUp']) -
      Number(!!keyState['KeyS'] || !!keyState['ArrowDown']);
    const rightAmount = Number(!!keyState['KeyD'] || !!keyState['ArrowRight']) -
      Number(!!keyState['KeyA'] || !!keyState['ArrowLeft']);

    if (forwardAmount || rightAmount) {
      camera.getWorldDirection(cameraAxis);
      cameraAxis.y = 0;
      if (cameraAxis.lengthSq() < 1e-6) cameraAxis.set(0, 0, -1);
      else cameraAxis.normalize();
      cameraRight.crossVectors(cameraAxis, camera.up).normalize();

      cameraTranslation.set(0, 0, 0)
        .addScaledVector(cameraAxis, forwardAmount)
        .addScaledVector(cameraRight, rightAmount);
      if (cameraTranslation.lengthSq() > 0) cameraTranslation.normalize();
      cameraTranslation.multiplyScalar(camera.position.distanceTo(controls.target) * 0.55 * speed * delta);

      camera.position.add(cameraTranslation);
      controls.target.add(cameraTranslation);
    }
  }

  // Controls update
  controls.update(delta);

  // 1. Water waves animation
  if (CONFIG.animateWaves && waterMaterial) {
    waveTime += delta;
    waterMaterial.uniforms.uTime.value = waveTime;
  }

  // 2. Ships cruising & bobbing animation
  if (CONFIG.animateBoats) {
    boatTime += delta;
    const elapsed = boatTime;
    animatedBoats.forEach(boatData => {
      boatData.mesh.position.y = 1.1 + Math.sin(elapsed * boatData.bobSpeed) * 0.15;
      boatData.mesh.rotation.z = Math.sin(elapsed * boatData.bobSpeed * 0.8) * 0.03;
      boatData.mesh.rotation.x = Math.cos(elapsed * boatData.bobSpeed * 0.6) * 0.02;

      const angle = elapsed * boatData.speed * 60;
      boatData.mesh.position.x = boatData.baseX + Math.sin(angle) * boatData.radius;
      boatData.mesh.position.z = boatData.baseZ + Math.cos(angle) * (boatData.radius * 0.6);
      boatData.mesh.rotation.y = boatData.heading + Math.cos(angle) * 0.3;
    });
  }

  // 3. Traffic animation on bridges
  if (CONFIG.animateTraffic) {
    trafficTime += delta;
    district.updateTransit?.(trafficTime);
    // Upper Highway Deck: Cars flowing strictly along bridge roadways
    animatedCars.forEach(car => {
      car.t = (car.t + car.speed * delta) % 1.0;
      const { pStart, pEnd, normalVec } = car.cfg;
      const tNorm = car.isOutbound ? car.t : (1.0 - car.t);

      const pos = car.mesh.position.lerpVectors(pStart, pEnd, tNorm);
      pos.addScaledVector(normalVec, car.laneOffset);
      pos.y = pStart.y + car.cfg.roadOffset;
    });

    // Lower Steel Truss: CRT Line 6 Train crossing Jialing River
    if (metroTrainObj && qiansimenConfig) {
      const trainCycle = (trafficTime * 0.05) % 2.0;
      const trainForward = trainCycle < 1.0;
      const trainT = trainForward ? trainCycle : (2.0 - trainCycle);

      const trainPos = metroTrainObj.position.lerpVectors(qiansimenConfig.pStart, qiansimenConfig.pEnd, trainT);
      trainPos.y = qiansimenConfig.railY;
      trainLookTarget.copy(trainPos).addScaledVector(qiansimenConfig.spanDir, trainForward ? 1 : -1);
      metroTrainObj.lookAt(trainLookTarget);
    }

    // Yangtze Cable Car gliding back and forth
    if (cableCarObj && cablewayCurve) {
      const cableProgress = (Math.sin(trafficTime * 0.5) + 1) * 0.5;
      cablewayCurve.getPoint(cableProgress, cableCarObj.position);
      cableCarObj.position.y -= 3.1 * 0.22;
    }
  }

  // Render Scene
  navigation?.update(delta);
  renderer.render(scene, camera);
}

// Kickoff
init().then(animate).catch(error => {
  console.error('渝中半岛模型加载失败', error);
  document.querySelector('.loader-status').textContent = '模型加载失败，请刷新页面重试。';
});
