import * as THREE from 'three';
import './styles.css';

window.__CJ_MODULE_READY__ = true;
clearTimeout(window.__CJ_WATCHDOG__);

const $ = (id) => document.getElementById(id);
const dom = {
  world: $('world'), loading: $('loading'), progress: $('progressBar'), status: $('loadingStatus'), start: $('startButton'),
  startupError: $('startupError'), retry: $('retryButton'), hud: $('hud'), fatal: $('fatalError'), fatalMessage: $('fatalMessage'),
  trainName: $('trainName'), region: $('regionName'), altitude: $('altitudeValue'), fps: $('fpsValue'), speed: $('speedValue'),
  trainCounter: $('trainCounter'), operationMode: $('operationMode'), nextStation: $('nextStation'), stationDistance: $('stationDistance'),
  stationEta: $('stationEta'), routeProgress: $('routeProgress'), power: $('powerControl'), brake: $('brakeControl'),
  powerValue: $('powerValue'), brakeValue: $('brakeValue'), cameraButton: $('cameraButton'), cameraLabel: $('cameraLabel'),
  mapButton: $('mapButton'), settingsButton: $('settingsButton'), previousTrain: $('previousTrain'), nextTrain: $('nextTrain'),
  reverseButton: $('reverseButton'), autoButton: $('autoButton'), switchButton: $('switchButton'), switchLabel: $('switchLabel'),
  hornButton: $('hornButton'), mapPanel: $('mapPanel'), settingsPanel: $('settingsPanel'), routeMap: $('routeMap'),
  destinationList: $('destinationList'), quality: $('qualitySelect'), weather: $('weatherSelect'), time: $('timeSelect'),
  cinematic: $('cinematicToggle'), audio: $('audioToggle'), eventBanner: $('eventBanner'), eventTitle: $('eventTitle'),
};

const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
const weakDevice = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const initialQuality = isMobile ? (weakDevice ? 'low' : 'medium') : 'high';
const qualityProfiles = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 512, cloudLobes: 130, farIslands: 9, treeLimit: 220, trackSegments: 360, weatherParticles: 260, drawDistance: 3600 },
  medium: { pixelRatio: 1.3, shadows: true, shadowSize: 768, cloudLobes: 240, farIslands: 15, treeLimit: 420, trackSegments: 520, weatherParticles: 520, drawDistance: 4700 },
  high: { pixelRatio: 1.65, shadows: true, shadowSize: 1024, cloudLobes: 390, farIslands: 24, treeLimit: 720, trackSegments: 720, weatherParticles: 850, drawDistance: 6200 },
};

const cameraModes = ['CHASE', 'LOCOMOTIVE POV', 'PASSENGER WINDOW', 'SIDE CINEMATIC', 'ORBIT', "BIRD'S-EYE", 'MAP', 'SKY CINEMATIC'];
const routeNames = ['MEADOW LINE', 'CROWN LINE', 'TEMPEST LINE'];

const state = {
  quality: initialQuality, started: false, paused: false, selectedTrain: 0, cameraMode: 0, orbitYaw: Math.PI, orbitPitch: 0.26,
  orbitDistance: 56, dragging: false, pointerX: 0, pointerY: 0, weather: 'clear', timeMode: 'cycle', timeOfDay: 0.31,
  cinematics: true, audioEnabled: true, pendingRoute: 0, lastFrame: performance.now(), elapsed: 0, frames: 0, fpsTime: 0,
  mapOpen: false, settingsOpen: false, lastScenicKey: '', eventTimer: 0, cameraShake: 0,
};

let renderer;
let scene;
let camera;
let clock;
let sun;
let hemisphere;
let skyMaterial;
let starField;
let cloudOcean;
let cloudInstances;
let weatherPoints;
let weatherPositions;
let weatherVelocity;
let routes = [];
let trains = [];
let signals = [];
let stations = [];
let aurelion;
let audioSystem;

const worldGroups = {
  world: new THREE.Group(), tracks: new THREE.Group(), islands: new THREE.Group(), buildings: new THREE.Group(),
  vegetation: new THREE.Group(), clouds: new THREE.Group(), details: new THREE.Group(), creatures: new THREE.Group(),
};

let randomSeed = 93617;
function random() {
  randomSeed = (randomSeed * 16807) % 2147483647;
  return (randomSeed - 1) / 2147483646;
}
function range(min, max) { return min + (max - min) * random(); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, value) { const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function wrap01(value) { return ((value % 1) + 1) % 1; }

function setProgress(percent, message) {
  dom.progress.style.width = `${percent}%`;
  dom.status.textContent = message;
}

function showFatal(error) {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  dom.fatalMessage.textContent = message || 'Unknown rendering error.';
  dom.fatal.classList.remove('hidden');
  dom.status.textContent = 'The journey could not be prepared.';
  dom.startupError.textContent = message;
  dom.startupError.classList.remove('hidden');
  dom.retry.classList.remove('hidden');
}

function canUseWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch { return false; }
}

function colorMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: options.roughness ?? 0.82, metalness: options.metalness ?? 0.02, flatShading: options.flatShading ?? false, ...options });
}

const materials = {};
function createMaterials() {
  Object.assign(materials, {
    rail: colorMaterial(0x4c5658, { roughness: 0.3, metalness: 0.74 }), railTop: colorMaterial(0xa5b2ad, { roughness: 0.2, metalness: 0.84 }),
    sleeper: colorMaterial(0x60412e, { roughness: 0.96 }), darkWood: colorMaterial(0x3f3028), brass: colorMaterial(0xc79a48, { roughness: 0.34, metalness: 0.63 }),
    stone: colorMaterial(0x717b72, { flatShading: true }), paleStone: colorMaterial(0xa6a690, { flatShading: true }),
    rock: colorMaterial(0x687268, { flatShading: true }), rockWarm: colorMaterial(0x816f5e, { flatShading: true }), rockCold: colorMaterial(0x74818b, { flatShading: true }),
    grass: colorMaterial(0x779957, { flatShading: true }), gardenGrass: colorMaterial(0x68a36a, { flatShading: true }), mangoGrass: colorMaterial(0xb5954f, { flatShading: true }),
    frostGrass: colorMaterial(0xd9e4dd, { flatShading: true }), stormGrass: colorMaterial(0x596b62, { flatShading: true }),
    plaster: colorMaterial(0xe8ddbd), plasterWarm: colorMaterial(0xefd4a4), teal: colorMaterial(0x376f72), terracotta: colorMaterial(0xa9563f),
    navy: colorMaterial(0x2d4859), red: colorMaterial(0x893f36), green: colorMaterial(0x466944), purple: colorMaterial(0x5e4b70), goldPaint: colorMaterial(0xb8883f),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xa7deea, transparent: true, opacity: 0.38, roughness: 0.16, metalness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    window: new THREE.MeshStandardMaterial({ color: 0xffdc81, emissive: 0xffa93a, emissiveIntensity: 0.6, roughness: 0.34 }),
    treeTrunk: colorMaterial(0x5d4130), pine: colorMaterial(0x315f4b, { flatShading: true }), leaf: colorMaterial(0x5f8d4b, { flatShading: true }),
    leafGold: colorMaterial(0xb8793f, { flatShading: true }), snow: colorMaterial(0xe8f0ed, { flatShading: true }),
    water: new THREE.MeshPhysicalMaterial({ color: 0x62b7ca, transparent: true, opacity: 0.76, roughness: 0.18, metalness: 0.05, depthWrite: false }),
    signalPost: colorMaterial(0x374247, { metalness: 0.45 }), signalDark: colorMaterial(0x151b1d),
    redLight: new THREE.MeshBasicMaterial({ color: 0xff4f3e }), yellowLight: new THREE.MeshBasicMaterial({ color: 0xffc75c }), greenLight: new THREE.MeshBasicMaterial({ color: 0x66e38e }),
  });
}

function createRouteDefinitions() {
  const hub = new THREE.Vector3(0, 338, 0);
  const definitions = [
    {
      name: routeNames[0], color: '#e7c26d', station: 'Sunset Orchard', regions: ['Grand Cloud Junction', 'Sunlit Meadow Isles', 'Folded Gardens', 'Mango Tide'],
      points: [hub, new THREE.Vector3(-360, 315, 210), new THREE.Vector3(-820, 275, 610), new THREE.Vector3(-1290, 225, 510), new THREE.Vector3(-1500, 185, 20), new THREE.Vector3(-1320, 210, -540), new THREE.Vector3(-850, 270, -900), new THREE.Vector3(-280, 350, -1040), new THREE.Vector3(350, 405, -830), new THREE.Vector3(650, 382, -380), hub.clone()],
      landmarks: [{ u: 0.23, name: 'Sunset Orchard' }, { u: 0.49, name: 'Folded Gardens' }, { u: 0.73, name: 'Mango Tide' }],
    },
    {
      name: routeNames[1], color: '#9ad6da', station: 'Frost Crown', regions: ['Grand Cloud Junction', 'Cloud Harbor', 'Whispering Pines', 'Frost Crown', 'Celestial Heights'],
      points: [hub, new THREE.Vector3(260, 375, 260), new THREE.Vector3(610, 445, 610), new THREE.Vector3(960, 555, 870), new THREE.Vector3(1280, 690, 600), new THREE.Vector3(1390, 780, 90), new THREE.Vector3(1160, 735, -440), new THREE.Vector3(720, 640, -700), new THREE.Vector3(320, 500, -440), hub.clone()],
      landmarks: [{ u: 0.18, name: 'Cloud Harbor' }, { u: 0.43, name: 'Pinewatch' }, { u: 0.65, name: 'Frost Crown' }],
    },
    {
      name: routeNames[2], color: '#cc8f86', station: 'Thunder Pass', regions: ['Grand Cloud Junction', 'Cloud Harbor', 'Thunder Pass', 'Celestial Heights'],
      points: [hub, new THREE.Vector3(230, 325, -270), new THREE.Vector3(580, 300, -680), new THREE.Vector3(930, 270, -1100), new THREE.Vector3(1330, 340, -940), new THREE.Vector3(1550, 440, -440), new THREE.Vector3(1370, 485, 180), new THREE.Vector3(900, 415, 390), new THREE.Vector3(430, 365, 190), hub.clone()],
      landmarks: [{ u: 0.27, name: 'Cloud Harbor' }, { u: 0.5, name: 'Thunder Pass' }, { u: 0.77, name: 'Celestial Gate' }],
    },
  ];
  return definitions.map((definition, index) => {
    const curve = new THREE.CatmullRomCurve3(definition.points, false, 'catmullrom', 0.32);
    return { ...definition, index, curve, length: curve.getLength() };
  });
}

function offsetCurve(baseCurve, offset, samples = 420) {
  const points = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let index = 0; index <= samples; index += 1) {
    const u = index / samples;
    const point = baseCurve.getPointAt(u);
    const tangent = baseCurve.getTangentAt(u).normalize();
    const side = new THREE.Vector3().crossVectors(up, tangent).normalize();
    points.push(point.add(side.multiplyScalar(offset)));
  }
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.4);
}

function poseOnRoute(routeIndex, u, lateral = 0, vertical = 0) {
  const route = routes[routeIndex];
  const safeU = clamp(u, 0, 1);
  const position = route.curve.getPointAt(safeU);
  const tangent = route.curve.getTangentAt(safeU).normalize();
  const side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
  position.addScaledVector(side, lateral);
  position.y += vertical;
  return { position, tangent, side };
}

function createTrackNetwork() {
  const profile = qualityProfiles[state.quality];
  let sleeperCount = 0;
  routes.forEach((route) => { sleeperCount += Math.ceil(route.length / 6.3); });
  const sleeperGeometry = new THREE.BoxGeometry(6.4, 0.38, 0.72);
  const sleeperMesh = new THREE.InstancedMesh(sleeperGeometry, materials.sleeper, sleeperCount);
  sleeperMesh.receiveShadow = profile.shadows;
  const dummy = new THREE.Object3D();
  let sleeperIndex = 0;

  routes.forEach((route) => {
    const railSegments = profile.trackSegments;
    [-2.05, 2.05].forEach((offset) => {
      const railCurve = offsetCurve(route.curve, offset, Math.floor(railSegments * 0.72));
      const rail = new THREE.Mesh(new THREE.TubeGeometry(railCurve, railSegments, 0.23, 5, false), materials.railTop);
      rail.castShadow = profile.shadows;
      rail.receiveShadow = profile.shadows;
      worldGroups.tracks.add(rail);
    });
    const totalSleepers = Math.ceil(route.length / 6.3);
    for (let index = 0; index < totalSleepers; index += 1) {
      const u = index / Math.max(1, totalSleepers - 1);
      const { position, tangent } = poseOnRoute(route.index, u, 0, -0.3);
      dummy.position.copy(position);
      dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      sleeperMesh.setMatrixAt(sleeperIndex, dummy.matrix);
      sleeperIndex += 1;
    }
  });
  sleeperMesh.instanceMatrix.needsUpdate = true;
  worldGroups.tracks.add(sleeperMesh);
  createBridge(0, 0.5, 0.67, 'stone');
  createBridge(1, 0.47, 0.61, 'steel');
  createBridge(2, 0.27, 0.48, 'suspension');
  createJunctionDetails();
  createSignals();
}

function createBridge(routeIndex, fromU, toU, style) {
  const route = routes[routeIndex];
  const span = (toU - fromU) * route.length;
  const bays = Math.max(5, Math.floor(span / 42));
  for (let index = 0; index <= bays; index += 1) {
    const u = lerp(fromU, toU, index / bays);
    const { position, tangent, side } = poseOnRoute(routeIndex, u, 0, -2.2);
    const height = style === 'stone' ? range(24, 58) : range(50, 120);
    const supportMaterial = style === 'steel' ? materials.signalPost : style === 'suspension' ? materials.brass : materials.paleStone;
    if (index % 2 === 0 || style === 'stone') {
      const support = new THREE.Mesh(new THREE.BoxGeometry(style === 'stone' ? 8 : 2.2, height, style === 'stone' ? 8 : 2.2), supportMaterial);
      support.position.copy(position).add(new THREE.Vector3(0, -height / 2, 0));
      support.castShadow = state.quality !== 'low';
      worldGroups.details.add(support);
      if (style !== 'stone') {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(12, 0.8, 0.8), supportMaterial);
        cross.position.copy(position).add(new THREE.Vector3(0, -height * 0.48, 0));
        cross.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), side);
        worldGroups.details.add(cross);
      }
    }
    if (style === 'suspension' && index % 3 === 0) {
      [-1, 1].forEach((direction) => {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(1.2, 18, 1.2), materials.brass);
        tower.position.copy(position).addScaledVector(side, direction * 5).add(new THREE.Vector3(0, 8, 0));
        worldGroups.details.add(tower);
      });
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.6, Math.max(8, span / bays + 2)), materials.darkWood);
    deck.position.copy(position).add(new THREE.Vector3(0, -1.25, 0));
    deck.rotation.y = Math.atan2(tangent.x, tangent.z);
    worldGroups.details.add(deck);
  }
}

function createJunctionDetails() {
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const { position, side } = poseOnRoute(routeIndex, 0.022, 0, 0);
    const leverBase = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 3.2), materials.signalDark);
    leverBase.position.copy(position).addScaledVector(side, 5.2).add(new THREE.Vector3(0, 0.5, 0));
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.8, 0.35), routeIndex === state.pendingRoute ? materials.brass : materials.rail);
    lever.position.copy(leverBase.position).add(new THREE.Vector3(0, 2, 0));
    lever.rotation.z = (routeIndex - 1) * 0.24;
    lever.userData.routeIndex = routeIndex;
    worldGroups.details.add(leverBase, lever);
  }
}

function createSignals() {
  routes.forEach((route) => {
    const blocks = 10;
    for (let block = 0; block < blocks; block += 1) {
      const u = (block + 0.9) / blocks;
      const { position, tangent } = poseOnRoute(route.index, u, 6.4, 0);
      const signal = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 7, 8), materials.signalPost);
      post.position.y = 3.5;
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 0.85), materials.signalDark);
      head.position.y = 6.6;
      const lights = ['redLight', 'yellowLight', 'greenLight'].map((materialName, lightIndex) => {
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 7), materials[materialName]);
        light.position.set(0, 7.55 - lightIndex * 0.95, -0.48);
        signal.add(light);
        return light;
      });
      signal.add(post, head);
      signal.position.copy(position);
      signal.rotation.y = Math.atan2(tangent.x, tangent.z);
      signal.userData = { routeIndex: route.index, block, lights, state: 'green' };
      signals.push(signal);
      worldGroups.details.add(signal);
    }
  });
}

function createSkyAndAtmosphere() {
  skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x70bed8) },
      horizonColor: { value: new THREE.Color(0xcce9e6) },
      bottomColor: { value: new THREE.Color(0xf1d3ae) },
      sunColor: { value: new THREE.Color(0xfff3c2) },
      sunDirection: { value: new THREE.Vector3(-0.5, 0.45, -0.3).normalize() },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = normalize(world.xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      varying vec3 vWorld;
      void main() {
        float h = clamp(vWorld.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 color = h < 0.5 ? mix(bottomColor, horizonColor, h * 2.0) : mix(horizonColor, topColor, (h - 0.5) * 2.0);
        float sunGlow = pow(max(dot(vWorld, sunDirection), 0.0), 96.0) + 0.34 * pow(max(dot(vWorld, sunDirection), 0.0), 8.0);
        color += sunColor * sunGlow;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 18), skyMaterial);
  sky.frustumCulled = false;
  worldGroups.world.add(sky);

  const oceanMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0xf7f0db) }, opacity: { value: 0.78 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec2 vUv; uniform float time; uniform vec3 color; uniform float opacity;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){
        vec2 p=(vUv-.5)*13.0+vec2(time*.005,time*.002);
        float n=noise(p)+.55*noise(p*2.1)-.18*length(vUv-.5);
        float a=smoothstep(.2,.95,n)*opacity;
        gl_FragColor=vec4(color*(.9+n*.14),a);
      }
    `,
  });
  cloudOcean = new THREE.Mesh(new THREE.PlaneGeometry(6800, 6800), oceanMaterial);
  cloudOcean.rotation.x = -Math.PI / 2;
  cloudOcean.position.y = 72;
  cloudOcean.renderOrder = -2;
  worldGroups.clouds.add(cloudOcean);

  const starCount = state.quality === 'low' ? 280 : 700;
  const starPositions = new Float32Array(starCount * 3);
  for (let index = 0; index < starCount; index += 1) {
    const radius = range(1800, 3000);
    const theta = range(0, Math.PI * 2);
    const phi = range(0.12, 1.3);
    starPositions[index * 3] = Math.cos(theta) * Math.sin(phi) * radius;
    starPositions[index * 3 + 1] = Math.cos(phi) * radius + 600;
    starPositions[index * 3 + 2] = Math.sin(theta) * Math.sin(phi) * radius;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starField = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xfff1c1, size: 4, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true }));
  worldGroups.world.add(starField);
  createCloudBanks();
}

function createCloudBanks() {
  const count = qualityProfiles[state.quality].cloudLobes;
  const geometry = new THREE.SphereGeometry(1, state.quality === 'low' ? 7 : 10, 6);
  const cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xfff7df, transparent: true, opacity: 0.58, depthWrite: false, roughness: 1 });
  cloudInstances = new THREE.InstancedMesh(geometry, cloudMaterial, count);
  const dummy = new THREE.Object3D();
  const clusterCenters = [];
  const clusterCount = Math.ceil(count / 5);
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const layer = cluster % 3;
    clusterCenters.push(new THREE.Vector3(range(-2600, 2600), [95, 290, 720][layer] + range(-55, 55), range(-2600, 2600)));
  }
  for (let index = 0; index < count; index += 1) {
    const cluster = clusterCenters[Math.floor(index / 5) % clusterCenters.length];
    const layer = Math.floor(index / 5) % 3;
    const size = layer === 0 ? range(34, 82) : layer === 1 ? range(22, 58) : range(15, 42);
    dummy.position.copy(cluster).add(new THREE.Vector3(range(-95, 95), range(-16, 18), range(-55, 55)));
    dummy.scale.set(size * range(1.3, 2.1), size * range(0.23, 0.44), size * range(0.8, 1.35));
    dummy.rotation.y = range(0, Math.PI);
    dummy.updateMatrix();
    cloudInstances.setMatrixAt(index, dummy.matrix);
  }
  cloudInstances.instanceMatrix.needsUpdate = true;
  cloudInstances.frustumCulled = false;
  worldGroups.clouds.add(cloudInstances);
}

function createIslandGeometry(radius, depth, segments = 14) {
  const vertices = [];
  const indices = [];
  const ringDefinitions = [
    { y: 0, radius: 1 }, { y: -depth * 0.12, radius: 1.03 }, { y: -depth * 0.38, radius: 0.72 },
    { y: -depth * 0.72, radius: 0.4 }, { y: -depth, radius: 0.08 },
  ];
  const jitter = Array.from({ length: segments }, () => range(0.83, 1.14));
  ringDefinitions.forEach((ring, ringIndex) => {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const ringJitter = jitter[segment] * (1 + Math.sin(segment * 2.7 + ringIndex) * 0.035);
      vertices.push(Math.cos(angle) * radius * ring.radius * ringJitter, ring.y + Math.sin(segment * 1.9) * 0.8, Math.sin(angle) * radius * ring.radius * ringJitter * range(0.93, 1.05));
    }
  });
  for (let ring = 0; ring < ringDefinitions.length - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + next;
      const d = (ring + 1) * segments + segment;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createHouse(scale = 1, roofColor = 'terracotta', elaborate = false) {
  const house = new THREE.Group();
  const width = range(11, 18) * scale;
  const depth = range(9, 14) * scale;
  const height = range(10, 17) * scale;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), random() > 0.32 ? materials.plaster : materials.plasterWarm);
  walls.position.y = height / 2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(width, depth) * 0.72, height * 0.42, 4), materials[roofColor]);
  roof.position.y = height * 1.12;
  roof.rotation.y = Math.PI / 4;
  const door = new THREE.Mesh(new THREE.BoxGeometry(width * 0.2, height * 0.42, 0.3), materials.darkWood);
  door.position.set(width * 0.18, height * 0.21, depth * 0.51);
  house.add(walls, roof, door);
  [-0.24, 0.24].forEach((x) => {
    const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(width * 0.16, height * 0.2, 0.28), materials.window);
    windowMesh.position.set(width * x, height * 0.62, depth * 0.515);
    house.add(windowMesh);
  });
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(width * 0.11, height * 0.48, width * 0.11), materials.darkWood);
  chimney.position.set(-width * 0.25, height * 1.12, 0);
  house.add(chimney);
  if (elaborate) {
    const balcony = new THREE.Mesh(new THREE.BoxGeometry(width * 0.62, 0.55, depth * 0.28), materials.darkWood);
    balcony.position.set(0, height * 0.72, depth * 0.62);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.5, depth * 0.38), materials.teal);
    awning.position.set(0, height * 0.92, depth * 0.66);
    awning.rotation.x = -0.18;
    house.add(balcony, awning);
  }
  house.traverse((child) => { if (child.isMesh) { child.castShadow = state.quality !== 'low'; child.receiveShadow = true; } });
  return house;
}

const treePlacements = [];
function addTreePlacement(position, scale, type = 'leaf') { treePlacements.push({ position: position.clone(), scale, type }); }

function createFloatingIsland(options) {
  const { position, radius = 70, depth = radius * 0.9, biome = 'meadow', houses = 1, trees = 10, landmark = '' } = options;
  const group = new THREE.Group();
  group.position.copy(position);
  const rockMaterial = biome === 'frost' ? materials.rockCold : biome === 'mango' ? materials.rockWarm : materials.rock;
  const rock = new THREE.Mesh(createIslandGeometry(radius, depth, radius > 110 ? 18 : 14), rockMaterial);
  rock.castShadow = state.quality !== 'low';
  rock.receiveShadow = true;
  const grassMaterial = biome === 'frost' ? materials.frostGrass : biome === 'mango' ? materials.mangoGrass : biome === 'storm' ? materials.stormGrass : biome === 'garden' ? materials.gardenGrass : materials.grass;
  const top = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.98, radius > 110 ? 20 : 14), grassMaterial);
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.65;
  top.receiveShadow = true;
  group.add(rock, top);

  for (let index = 0; index < houses; index += 1) {
    const angle = range(0, Math.PI * 2);
    const distance = range(radius * 0.16, radius * 0.55);
    const roofColor = biome === 'frost' ? 'navy' : index % 2 ? 'teal' : 'terracotta';
    const house = createHouse(radius > 120 ? 1.18 : 0.8, roofColor, index === 0);
    house.position.set(Math.cos(angle) * distance, 0.8, Math.sin(angle) * distance);
    house.rotation.y = -angle + Math.PI * 0.5;
    group.add(house);
  }
  for (let index = 0; index < trees; index += 1) {
    const angle = range(0, Math.PI * 2);
    const distance = Math.sqrt(random()) * radius * 0.74;
    const local = new THREE.Vector3(Math.cos(angle) * distance, 1, Math.sin(angle) * distance);
    const worldPosition = local.add(position);
    const treeType = biome === 'frost' || biome === 'pine' ? 'pine' : biome === 'mango' ? 'gold' : 'leaf';
    addTreePlacement(worldPosition, range(0.72, 1.45) * (radius > 120 ? 1.25 : 1), treeType);
  }
  if (biome === 'garden') {
    for (let index = 0; index < 18; index += 1) {
      const flower = new THREE.Mesh(new THREE.SphereGeometry(range(0.7, 1.5), 6, 4), colorMaterial(index % 3 ? 0xe78378 : 0xf3d376, { flatShading: true }));
      flower.position.set(range(-radius * 0.7, radius * 0.7), 1.6, range(-radius * 0.7, radius * 0.7));
      group.add(flower);
    }
  }
  if (landmark) group.add(createLabelSprite(landmark, Math.max(18, radius * 0.25), new THREE.Vector3(0, 28, 0)));
  worldGroups.islands.add(group);
  return group;
}

function createLabelSprite(text, width, position) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(10,45,47,.84)';
  context.roundRect(5, 5, 502, 86, 18);
  context.fill();
  context.strokeStyle = 'rgba(247,230,188,.7)';
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = '#f7e9c8';
  context.font = '600 33px Georgia';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text.toUpperCase(), 256, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.position.copy(position);
  sprite.scale.set(width, width * 0.19, 1);
  return sprite;
}

function createVegetationInstances() {
  const limit = Math.min(treePlacements.length, qualityProfiles[state.quality].treeLimit);
  const trunkGeometry = new THREE.CylinderGeometry(0.65, 1.15, 7, 6);
  const leafGeometry = new THREE.ConeGeometry(4.8, 12, 7);
  const trunkMesh = new THREE.InstancedMesh(trunkGeometry, materials.treeTrunk, limit);
  const pineMesh = new THREE.InstancedMesh(leafGeometry, materials.pine, limit);
  const leafMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(4.2, 7, 5), materials.leaf, limit);
  const goldMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(4.5, 7, 5), materials.leafGold, limit);
  const dummy = new THREE.Object3D();
  let pineCount = 0;
  let leafCount = 0;
  let goldCount = 0;
  for (let index = 0; index < limit; index += 1) {
    const placement = treePlacements[index];
    dummy.position.copy(placement.position).add(new THREE.Vector3(0, 3.5 * placement.scale, 0));
    dummy.scale.setScalar(placement.scale);
    dummy.rotation.y = range(0, Math.PI * 2);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(index, dummy.matrix);
    dummy.position.y += 6.5 * placement.scale;
    dummy.updateMatrix();
    if (placement.type === 'pine') { pineMesh.setMatrixAt(pineCount, dummy.matrix); pineCount += 1; }
    else if (placement.type === 'gold') { goldMesh.setMatrixAt(goldCount, dummy.matrix); goldCount += 1; }
    else { leafMesh.setMatrixAt(leafCount, dummy.matrix); leafCount += 1; }
  }
  trunkMesh.count = limit;
  pineMesh.count = pineCount;
  leafMesh.count = leafCount;
  goldMesh.count = goldCount;
  [trunkMesh, pineMesh, leafMesh, goldMesh].forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = state.quality !== 'low'; worldGroups.vegetation.add(mesh); });
}

function makeWaterfall(position, height = 120, width = 13) {
  const geometry = new THREE.PlaneGeometry(width, height, 1, 12);
  const waterfall = new THREE.Mesh(geometry, materials.water);
  waterfall.position.copy(position).add(new THREE.Vector3(0, -height * 0.48, 0));
  waterfall.renderOrder = 1;
  worldGroups.details.add(waterfall);
}

function createStation(routeIndex, u, name, size = 'small', biome = 'meadow') {
  const { position, tangent, side } = poseOnRoute(routeIndex, u, 0, 0);
  const station = new THREE.Group();
  const platformLength = size === 'grand' ? 150 : 52;
  const platform = new THREE.Mesh(new THREE.BoxGeometry(size === 'grand' ? 30 : 14, 1.3, platformLength), materials.paleStone);
  platform.position.y = 0.25;
  const building = createHouse(size === 'grand' ? 1.65 : 0.86, biome === 'frost' ? 'navy' : 'teal', true);
  building.position.set(size === 'grand' ? 22 : 10, 1, 0);
  station.add(platform, building);
  if (size === 'grand') {
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(58, 0.7, 116), materials.glass);
    canopy.position.set(-10, 17, 0);
    canopy.rotation.z = -0.05;
    station.add(canopy);
    for (let index = -2; index <= 2; index += 1) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.7, 17, 117), materials.brass);
      rib.position.set(index * 12 - 10, 8.5, 0);
      station.add(rib);
    }
    const tower = new THREE.Mesh(new THREE.BoxGeometry(18, 58, 18), materials.plaster);
    tower.position.set(34, 29, -26);
    const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(15, 17, 6), materials.terracotta);
    towerRoof.position.set(34, 66, -26);
    const clockFace = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 0.7, 24), materials.window);
    clockFace.rotation.x = Math.PI / 2;
    clockFace.position.set(34, 47, -35.2);
    station.add(tower, towerRoof, clockFace);
  }
  station.add(createLabelSprite(name, size === 'grand' ? 42 : 24, new THREE.Vector3(0, size === 'grand' ? 29 : 17, -platformLength * 0.3)));
  station.position.copy(position).addScaledVector(side, size === 'grand' ? -18 : -8).add(new THREE.Vector3(0, -1.15, 0));
  station.rotation.y = Math.atan2(tangent.x, tangent.z);
  station.traverse((child) => { if (child.isMesh) { child.castShadow = state.quality !== 'low'; child.receiveShadow = true; } });
  worldGroups.buildings.add(station);
  const record = { routeIndex, u, name, position: position.clone(), biome };
  stations.push(record);
  return record;
}

function createWorldRegions() {
  const stationDefinitions = [
    [0, 0.008, 'Grand Cloud Junction', 'grand', 'meadow'], [0, 0.23, 'Sunset Orchard', 'small', 'meadow'],
    [0, 0.49, 'Folded Gardens', 'small', 'garden'], [0, 0.73, 'Mango Tide', 'small', 'mango'],
    [1, 0.18, 'Cloud Harbor', 'small', 'meadow'], [1, 0.43, 'Pinewatch', 'small', 'pine'],
    [1, 0.65, 'Frost Crown', 'small', 'frost'], [2, 0.5, 'Thunder Pass', 'small', 'storm'],
    [2, 0.77, 'Celestial Gate', 'small', 'meadow'],
  ];
  stationDefinitions.forEach((definition) => createStation(...definition));

  const islandDefinitions = [
    [0, 0.23, 96, 'meadow', 3, 20, 'SUNSET ORCHARD', 11], [0, 0.49, 125, 'garden', 4, 26, 'FOLDED GARDENS', -12],
    [0, 0.73, 105, 'mango', 4, 17, 'MANGO TIDE', 12], [1, 0.18, 135, 'meadow', 5, 22, 'CLOUD HARBOR', -12],
    [1, 0.43, 120, 'pine', 2, 34, 'PINEWATCH', 12], [1, 0.65, 170, 'frost', 4, 36, 'FROST CROWN', -15],
    [2, 0.5, 125, 'storm', 2, 18, 'THUNDER PASS', 14], [2, 0.77, 145, 'meadow', 3, 20, 'CELESTIAL GATE', -14],
  ];
  islandDefinitions.forEach(([routeIndex, u, radius, biome, houses, trees, landmark, lateral]) => {
    const pose = poseOnRoute(routeIndex, u, lateral, -3);
    createFloatingIsland({ position: pose.position, radius, depth: radius * range(0.75, 1.25), biome, houses, trees, landmark });
    if (biome === 'garden' || biome === 'meadow') makeWaterfall(pose.position.clone().add(pose.side.clone().multiplyScalar(radius * 0.62)), radius * 1.45, radius * 0.12);
  });

  const farCount = qualityProfiles[state.quality].farIslands;
  for (let index = 0; index < farCount; index += 1) {
    const angle = range(0, Math.PI * 2);
    const distance = range(700, 2500);
    const radius = range(26, 78);
    const biomeOptions = ['meadow', 'garden', 'mango', 'pine'];
    createFloatingIsland({
      position: new THREE.Vector3(Math.cos(angle) * distance, range(180, 670), Math.sin(angle) * distance), radius,
      depth: radius * range(0.75, 1.4), biome: biomeOptions[index % biomeOptions.length], houses: random() > 0.55 ? 1 : 0,
      trees: Math.floor(range(2, 10)),
    });
  }
  createFloatingIsland({ position: new THREE.Vector3(0, 333, 0), radius: 210, depth: 150, biome: 'meadow', houses: 8, trees: 35 });
  createVegetationInstances();
  createWindmillsAndObservatories();
}

function createWindmillsAndObservatories() {
  const locations = [poseOnRoute(0, 0.23, 75, 14), poseOnRoute(0, 0.73, -70, 18)];
  locations.forEach(({ position }) => {
    const windmill = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 7.2, 26, 8), materials.plaster);
    tower.position.y = 13;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 8, 8), materials.terracotta);
    roof.position.y = 30;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2, 12), materials.brass);
    hub.position.set(0, 23, 4.5);
    hub.rotation.x = Math.PI / 2;
    const blades = new THREE.Group();
    blades.position.set(0, 23, 5.6);
    for (let bladeIndex = 0; bladeIndex < 4; bladeIndex += 1) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(2.1, 17, 0.35), materials.darkWood);
      blade.position.y = 8;
      blade.rotation.z = bladeIndex * Math.PI * 0.5;
      blades.add(blade);
    }
    blades.userData.isWindmill = true;
    windmill.add(tower, roof, hub, blades);
    windmill.position.copy(position);
    worldGroups.details.add(windmill);
  });
  const observatoryPosition = poseOnRoute(2, 0.77, -65, 15).position;
  const observatory = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(13, 16, 21, 16), materials.plaster);
  base.position.y = 10.5;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), materials.teal);
  dome.position.y = 21;
  const telescope = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 3.1, 22, 12), materials.brass);
  telescope.position.set(3, 29, 1);
  telescope.rotation.z = Math.PI * 0.35;
  observatory.add(base, dome, telescope);
  observatory.position.copy(observatoryPosition);
  worldGroups.details.add(observatory);
}

function createAurelion() {
  const creature = new THREE.Group();
  const bodyMaterial = colorMaterial(0x5a8792, { roughness: 0.68, flatShading: true });
  const wingMaterial = new THREE.MeshPhysicalMaterial({ color: 0x76a8ae, transparent: true, opacity: 0.82, roughness: 0.55, side: THREE.DoubleSide });
  const markingMaterial = new THREE.MeshStandardMaterial({ color: 0xb9f5df, emissive: 0x54c6ae, emissiveIntensity: 1.7 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), bodyMaterial);
  body.scale.set(57, 13, 15);
  creature.add(body);
  const wings = [];
  for (let sideIndex = -1; sideIndex <= 1; sideIndex += 2) {
    for (let wingIndex = 0; wingIndex < 3; wingIndex += 1) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(12 - wingIndex * 1.6, 40 - wingIndex * 5, 4), wingMaterial);
      wing.position.set(10 - wingIndex * 17, -1, sideIndex * (17 + wingIndex * 2));
      wing.rotation.x = sideIndex * (Math.PI * 0.5);
      wing.rotation.z = sideIndex * (0.22 + wingIndex * 0.08);
      creature.add(wing);
      wings.push(wing);
    }
  }
  const tail = [];
  for (let index = 0; index < 7; index += 1) {
    const segment = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), bodyMaterial);
    segment.scale.set(10 - index, 5 - index * 0.45, 6 - index * 0.55);
    segment.position.x = 58 + index * 9;
    creature.add(segment);
    tail.push(segment);
  }
  for (let index = 0; index < 9; index += 1) {
    const marking = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), markingMaterial);
    marking.position.set(-34 + index * 9, 7 + Math.sin(index) * 1.4, -11.5);
    creature.add(marking);
  }
  creature.scale.setScalar(1.05);
  creature.position.set(900, 470, -1250);
  creature.userData = { body, wings, tail, eventStrength: 0 };
  worldGroups.creatures.add(creature);
  aurelion = creature;
  createSkyMantas();
}

function createSkyMantas() {
  for (let index = 0; index < 5; index += 1) {
    const manta = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), colorMaterial(index % 2 ? 0x557c88 : 0x778ea2, { flatShading: true }));
    body.scale.set(7, 1.4, 4.2);
    const leftWing = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 3), materials.teal);
    leftWing.rotation.z = Math.PI / 2;
    leftWing.position.x = -7;
    const rightWing = leftWing.clone();
    rightWing.rotation.z = -Math.PI / 2;
    rightWing.position.x = 7;
    manta.add(body, leftWing, rightWing);
    manta.position.set(range(-1600, 1600), range(360, 800), range(-1600, 1600));
    manta.scale.setScalar(range(0.8, 1.8));
    manta.userData.phase = range(0, Math.PI * 2);
    worldGroups.creatures.add(manta);
  }
}

const trainConfigs = [
  { name: 'Celestial Express', routeIndex: 0, u: 0.08, maxSpeed: 32, color: 'red', accent: 'goldPaint', cars: 4, type: 'steam', horn: [116, 146], passengers: 184 },
  { name: 'Azure Limited', routeIndex: 1, u: 0.2, maxSpeed: 39, color: 'navy', accent: 'brass', cars: 3, type: 'streamline', horn: [196, 247, 294], passengers: 126 },
  { name: 'Forest Local', routeIndex: 0, u: 0.53, maxSpeed: 24, color: 'green', accent: 'terracotta', cars: 2, type: 'steam', horn: [440], passengers: 58 },
  { name: 'Moonlight Mail', routeIndex: 2, u: 0.74, maxSpeed: 30, color: 'purple', accent: 'brass', cars: 3, type: 'mail', horn: [98, 131], passengers: 34 },
  { name: 'Cloud Freight', routeIndex: 2, u: 0.16, maxSpeed: 22, color: 'green', accent: 'darkWood', cars: 5, type: 'freight', horn: [82, 103], passengers: 2 },
  { name: 'Sky Tram', routeIndex: 1, u: 0.58, maxSpeed: 27, color: 'teal', accent: 'plasterWarm', cars: 1, type: 'tram', horn: [523, 659], passengers: 42 },
];

function createWheel(radius = 1.35, width = 0.65, colorMaterialRef = materials.rail) {
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 14), colorMaterialRef);
  wheel.rotation.z = Math.PI / 2;
  wheel.castShadow = state.quality !== 'low';
  return wheel;
}

function addWheelSet(root, wheels, z, radius = 1.35) {
  [-2.35, 2.35].forEach((x) => {
    const wheel = createWheel(radius);
    wheel.position.set(x, radius, z);
    root.add(wheel);
    wheels.push(wheel);
  });
}

function createLocomotive(config) {
  const root = new THREE.Group();
  const wheels = [];
  const primary = materials[config.color];
  const accent = materials[config.accent];
  const undercarriage = new THREE.Mesh(new THREE.BoxGeometry(5.3, 1.25, 14.5), materials.signalDark);
  undercarriage.position.y = 1.85;
  root.add(undercarriage);

  if (config.type === 'steam' || config.type === 'freight') {
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(config.type === 'freight' ? 2.25 : 2, config.type === 'freight' ? 2.25 : 2, 9, 16), primary);
    boiler.rotation.x = Math.PI / 2;
    boiler.position.set(0, 4.2, 0.5);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(5.1, 5.6, 4.6), accent);
    cab.position.set(0, 4.7, 5.2);
    const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 5.7, 10, 1, false, 0, Math.PI), primary);
    cabRoof.rotation.set(0, 0, Math.PI / 2);
    cabRoof.position.set(0, 7.55, 5.2);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 3.6, 10), materials.signalDark);
    chimney.position.set(0, 7.05, -2.5);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.85, 10, 7), materials.brass);
    dome.position.set(0, 6.15, 1.1);
    root.add(boiler, cab, cabRoof, chimney, dome);
  } else if (config.type === 'streamline') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(2.55, 9, 5, 12), primary);
    body.rotation.x = Math.PI / 2;
    body.position.y = 4.25;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.6, 5), accent);
    fin.position.set(0, 6.7, 3.5);
    root.add(body, fin);
  } else if (config.type === 'mail') {
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 2.55, 5, 12), primary);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 4.3, -4.7);
    const body = new THREE.Mesh(new THREE.BoxGeometry(5.1, 5.6, 10), primary);
    body.position.set(0, 4.4, 2.3);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 10.5, 12, 1, false, 0, Math.PI), accent);
    roof.rotation.set(0, 0, Math.PI / 2);
    roof.position.set(0, 7.2, 2.3);
    root.add(nose, body, roof);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(5.2, 5.8, 13), primary);
    body.position.y = 4.4;
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.15, 13.4, 12, 1, false, 0, Math.PI), accent);
    roof.rotation.set(0, 0, Math.PI / 2);
    roof.position.y = 7.35;
    root.add(body, roof);
  }

  for (let z = -5; z <= 5; z += 5) addWheelSet(root, wheels, z, config.type === 'freight' ? 1.5 : 1.3);
  const buffer = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.5, 0.7), materials.brass);
  buffer.position.set(0, 2.1, -7.35);
  const headlight = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.9, 0.75, 12), materials.window);
  headlight.rotation.x = Math.PI / 2;
  headlight.position.set(0, 5.1, -6.8);
  const windowLeft = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.45, 0.22), materials.window);
  windowLeft.position.set(-1.35, 5.4, config.type === 'steam' || config.type === 'freight' ? 7.55 : -6.58);
  const windowRight = windowLeft.clone();
  windowRight.position.x = 1.35;
  root.add(buffer, headlight, windowLeft, windowRight);
  root.userData.wheels = wheels;
  root.traverse((child) => { if (child.isMesh) { child.castShadow = state.quality !== 'low'; child.receiveShadow = true; } });
  return root;
}

function createPassengerCar(config, carIndex) {
  const root = new THREE.Group();
  const wheels = [];
  const freight = config.type === 'freight';
  const mail = config.type === 'mail';
  const bodyMaterial = freight ? (carIndex % 2 ? materials.darkWood : materials.green) : mail ? materials.purple : carIndex % 2 ? materials[config.color] : materials.plasterWarm;
  const body = new THREE.Mesh(new THREE.BoxGeometry(5.25, freight ? 4.7 : 5.4, 12.5), bodyMaterial);
  body.position.y = freight ? 4 : 4.35;
  root.add(body);
  if (!freight) {
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.15, 12.8, 12, 1, false, 0, Math.PI), materials[config.accent]);
    roof.rotation.set(0, 0, Math.PI / 2);
    roof.position.y = 7.1;
    root.add(roof);
    for (let windowIndex = -2; windowIndex <= 2; windowIndex += 1) {
      [-1, 1].forEach((side) => {
        const windowMesh = new THREE.Mesh(new THREE.BoxGeometry(0.23, 1.45, 1.45), materials.window);
        windowMesh.position.set(side * 2.66, 5.1, windowIndex * 2.25);
        root.add(windowMesh);
      });
    }
  } else {
    const braceMaterial = carIndex % 2 ? materials.brass : materials.darkWood;
    for (let braceIndex = -2; braceIndex <= 2; braceIndex += 1) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(5.45, 0.22, 0.35), braceMaterial);
      brace.position.set(0, 4.1, braceIndex * 2.3);
      root.add(brace);
    }
  }
  addWheelSet(root, wheels, -4.2, 1.12);
  addWheelSet(root, wheels, 4.2, 1.12);
  [-6.7, 6.7].forEach((z) => {
    const coupler = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 1.5), materials.rail);
    coupler.position.set(0, 2, z);
    root.add(coupler);
  });
  root.userData.wheels = wheels;
  root.traverse((child) => { if (child.isMesh) { child.castShadow = state.quality !== 'low'; child.receiveShadow = true; } });
  return root;
}

function createTrain(config, index) {
  const parts = [];
  const locomotive = createLocomotive(config);
  worldGroups.world.add(locomotive);
  parts.push({ root: locomotive, offset: 0 });
  for (let carIndex = 0; carIndex < config.cars; carIndex += 1) {
    const car = createPassengerCar(config, carIndex);
    worldGroups.world.add(car);
    parts.push({ root: car, offset: 16.2 + carIndex * 14.8 });
  }
  const train = {
    ...config, index, parts, previousRouteIndex: config.routeIndex, pendingRouteIndex: config.routeIndex, speed: config.maxSpeed * (0.43 + index * 0.055),
    throttle: 0.64, brake: 0, direction: 1, auto: true, dwell: 0, atStation: false, distanceTravelled: 0,
  };
  trains.push(train);
  updateTrainVisual(train, 0);
  return train;
}

function getPartPose(train, offset) {
  const currentRoute = routes[train.routeIndex];
  let distance = train.u * currentRoute.length - offset * train.direction;
  let routeIndex = train.routeIndex;
  if (distance < 0) {
    routeIndex = train.previousRouteIndex;
    distance = routes[routeIndex].length + distance;
  } else if (distance > currentRoute.length) {
    distance -= currentRoute.length;
  }
  return poseOnRoute(routeIndex, clamp(distance / routes[routeIndex].length, 0, 1), 0, 1.55);
}

function updateTrainVisual(train, delta) {
  train.parts.forEach((part) => {
    const { position, tangent } = getPartPose(train, part.offset);
    part.root.position.copy(position);
    part.root.rotation.set(0, Math.atan2(tangent.x * train.direction, tangent.z * train.direction) + Math.PI, 0);
    const wheelRotation = (train.speed * delta) / 1.25;
    part.root.userData.wheels.forEach((wheel) => { wheel.rotation.x -= wheelRotation * train.direction; });
  });
}

function distanceToTrainAhead(train) {
  const sameRoute = trains.filter((candidate) => candidate !== train && candidate.routeIndex === train.routeIndex && candidate.direction === train.direction);
  let nearest = Infinity;
  sameRoute.forEach((candidate) => {
    let normalizedDistance = (candidate.u - train.u) * train.direction;
    if (normalizedDistance <= 0) normalizedDistance += 1;
    nearest = Math.min(nearest, normalizedDistance * routes[train.routeIndex].length);
  });
  return nearest;
}

function curveSpeedFactor(train) {
  const route = routes[train.routeIndex];
  const tangentNow = route.curve.getTangentAt(clamp(train.u, 0, 1)).normalize();
  const lookU = clamp(train.u + 0.012 * train.direction, 0, 1);
  const tangentAhead = route.curve.getTangentAt(lookU).normalize();
  const curvature = 1 - tangentNow.dot(tangentAhead);
  const curveFactor = clamp(1 - curvature * 12, 0.48, 1);
  const gradeFactor = clamp(1 - Math.max(0, tangentNow.y * train.direction) * 1.8, 0.62, 1);
  return curveFactor * gradeFactor;
}

function arriveAtJunction(train) {
  train.atStation = true;
  train.dwell = train.index === state.selectedTrain ? 3.2 : 2 + random() * 2;
  train.speed = 0;
  train.u = 0.999;
  if (train.index !== state.selectedTrain) train.pendingRouteIndex = (train.routeIndex + 1 + (random() > 0.55 ? 1 : 0)) % routes.length;
}

function departJunction(train) {
  train.previousRouteIndex = train.routeIndex;
  train.routeIndex = train.index === state.selectedTrain ? state.pendingRoute : train.pendingRouteIndex;
  train.u = 0.007;
  train.speed = 2.5;
  train.atStation = false;
  train.dwell = 0;
}

function updateTrainPhysics(train, delta) {
  if (train.atStation) {
    train.dwell -= delta;
    train.speed = 0;
    if (train.dwell <= 0) departJunction(train);
    updateTrainVisual(train, delta);
    return;
  }
  const route = routes[train.routeIndex];
  const distanceAhead = distanceToTrainAhead(train);
  const safetyFactor = distanceAhead < 90 ? 0 : distanceAhead < 210 ? (distanceAhead - 90) / 120 : 1;
  if (train.auto) {
    let targetSpeed = train.maxSpeed * curveSpeedFactor(train) * safetyFactor;
    const distanceToJunction = train.direction > 0 ? (1 - train.u) * route.length : train.u * route.length;
    if (distanceToJunction < 170) targetSpeed = Math.min(targetSpeed, Math.max(0, distanceToJunction * 0.09));
    const difference = targetSpeed - train.speed;
    train.throttle = clamp(difference * 0.08 + 0.34, 0, 1);
    train.brake = clamp(-difference * 0.12, 0, 1);
  }
  const rollingResistance = 0.16 + train.speed * 0.007;
  const grade = route.curve.getTangentAt(clamp(train.u, 0, 1)).y * train.direction;
  const acceleration = train.throttle * 1.65 - train.brake * 3.7 - rollingResistance - grade * 2.6;
  train.speed = clamp(train.speed + acceleration * delta, 0, train.maxSpeed * 1.06);
  const distanceDelta = train.speed * delta * train.direction;
  train.distanceTravelled += Math.abs(distanceDelta);
  train.u += distanceDelta / route.length;
  if (train.direction > 0 && train.u >= 0.997) {
    if (train.auto) arriveAtJunction(train); else { train.previousRouteIndex = train.routeIndex; train.routeIndex = state.pendingRoute; train.u = 0.004; }
  } else if (train.direction < 0 && train.u <= 0.003) {
    train.u = 0.996;
  }
  updateTrainVisual(train, delta);
}

function createTrains() { trainConfigs.forEach((config, index) => createTrain(config, index)); }

function updateSignals() {
  const blockCount = 10;
  const occupied = routes.map(() => Array(blockCount).fill(false));
  trains.forEach((train) => { occupied[train.routeIndex][Math.min(blockCount - 1, Math.floor(train.u * blockCount))] = true; });
  signals.forEach((signal) => {
    const { routeIndex, block, lights } = signal.userData;
    const nextOccupied = occupied[routeIndex][(block + 1) % blockCount];
    const followingOccupied = occupied[routeIndex][(block + 2) % blockCount];
    const signalState = nextOccupied ? 'red' : followingOccupied ? 'yellow' : 'green';
    signal.userData.state = signalState;
    lights[0].visible = signalState === 'red';
    lights[1].visible = signalState === 'yellow';
    lights[2].visible = signalState === 'green';
  });
}

function selectedTrain() { return trains[state.selectedTrain]; }

function getNextStation(train) {
  const candidates = stations.filter((station) => station.routeIndex === train.routeIndex && station.u > train.u + 0.006).sort((a, b) => a.u - b.u);
  if (candidates.length) return candidates[0];
  return stations[0];
}

function getRegion(train) {
  const u = train.u;
  if (u < 0.08 || u > 0.94) return 'Grand Cloud Junction';
  if (train.routeIndex === 0) return u < 0.34 ? 'Sunlit Meadow Isles' : u < 0.62 ? 'Folded Gardens' : 'Mango Tide';
  if (train.routeIndex === 1) return u < 0.3 ? 'Cloud Harbor' : u < 0.55 ? 'Whispering Pines' : u < 0.79 ? 'Frost Crown' : 'Celestial Heights';
  return u < 0.3 ? 'Cloud Harbor' : u < 0.69 ? 'Thunder Pass' : 'Celestial Heights';
}

function createWeatherSystem() {
  const count = qualityProfiles[state.quality].weatherParticles;
  weatherPositions = new Float32Array(count * 3);
  weatherVelocity = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    weatherPositions[index * 3] = range(-100, 100);
    weatherPositions[index * 3 + 1] = range(-10, 100);
    weatherPositions[index * 3 + 2] = range(-100, 100);
    weatherVelocity[index] = range(22, 48);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(weatherPositions, 3));
  const material = new THREE.PointsMaterial({ color: 0xb5d4de, size: 0.85, transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: true });
  weatherPoints = new THREE.Points(geometry, material);
  weatherPoints.visible = false;
  weatherPoints.frustumCulled = false;
  scene.add(weatherPoints);
}

function applyWeather(weather) {
  state.weather = weather;
  dom.weather.value = weather;
  const config = {
    clear: { density: 0.00014, particles: false, color: 0xcbe4e1, size: 0.8 },
    mist: { density: 0.00055, particles: false, color: 0xd2e0dc, size: 0.8 },
    rain: { density: 0.00034, particles: true, color: 0xabcbd5, size: 0.72 },
    storm: { density: 0.00062, particles: true, color: 0x708a94, size: 0.9 },
    snow: { density: 0.0004, particles: true, color: 0xf4f3e8, size: 2.4 },
  }[weather];
  scene.fog.density = config.density;
  scene.fog.color.set(config.color);
  weatherPoints.visible = config.particles;
  weatherPoints.material.color.set(config.color);
  weatherPoints.material.size = config.size;
}

function updateWeather(delta) {
  if (!weatherPoints.visible) return;
  const count = weatherPositions.length / 3;
  const snowing = state.weather === 'snow';
  const basePosition = camera.position;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    weatherPositions[offset + 1] -= weatherVelocity[index] * delta * (snowing ? 0.15 : 1);
    weatherPositions[offset] += delta * (snowing ? Math.sin(state.elapsed + index) * 0.8 : state.weather === 'storm' ? 8 : 2);
    if (weatherPositions[offset + 1] < -25) {
      weatherPositions[offset] = range(-105, 105);
      weatherPositions[offset + 1] = range(75, 120);
      weatherPositions[offset + 2] = range(-105, 105);
    }
  }
  weatherPoints.position.set(basePosition.x, basePosition.y, basePosition.z);
  weatherPoints.geometry.attributes.position.needsUpdate = true;
  if (state.weather === 'storm' && random() < delta * 0.06) {
    hemisphere.intensity += 3.6;
    state.cameraShake = 0.7;
    setTimeout(() => { if (hemisphere) hemisphere.intensity = 1; }, 85);
  }
}

function timePalette(time) {
  const anchors = [
    { t: 0, top: 0x101b3c, horizon: 0x3c4268, bottom: 0x2c3452, sun: 0xb7d0ff, light: 0x9fb6e1, intensity: 0.18 },
    { t: 0.19, top: 0x668fb8, horizon: 0xe9b9a6, bottom: 0xf4cf9e, sun: 0xffe0aa, light: 0xffc68f, intensity: 0.8 },
    { t: 0.31, top: 0x6ebbd5, horizon: 0xcce9e3, bottom: 0xf0dfbd, sun: 0xfff1bf, light: 0xffe2aa, intensity: 1.42 },
    { t: 0.55, top: 0x5aa8cf, horizon: 0xc4e3e2, bottom: 0xf3e1bd, sun: 0xfff0b0, light: 0xffe5b7, intensity: 1.55 },
    { t: 0.72, top: 0x5877ac, horizon: 0xe7997d, bottom: 0xf6b976, sun: 0xffca74, light: 0xff9b62, intensity: 1.08 },
    { t: 0.83, top: 0x202a58, horizon: 0x7a6481, bottom: 0xb36e70, sun: 0xf5bd88, light: 0xbc8fa5, intensity: 0.45 },
    { t: 1, top: 0x101b3c, horizon: 0x3c4268, bottom: 0x2c3452, sun: 0xb7d0ff, light: 0x9fb6e1, intensity: 0.18 },
  ];
  let left = anchors[0];
  let right = anchors[anchors.length - 1];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    if (time >= anchors[index].t && time <= anchors[index + 1].t) { left = anchors[index]; right = anchors[index + 1]; break; }
  }
  const mix = (time - left.t) / Math.max(0.001, right.t - left.t);
  return {
    top: new THREE.Color(left.top).lerp(new THREE.Color(right.top), mix),
    horizon: new THREE.Color(left.horizon).lerp(new THREE.Color(right.horizon), mix),
    bottom: new THREE.Color(left.bottom).lerp(new THREE.Color(right.bottom), mix),
    sun: new THREE.Color(left.sun).lerp(new THREE.Color(right.sun), mix),
    light: new THREE.Color(left.light).lerp(new THREE.Color(right.light), mix),
    intensity: lerp(left.intensity, right.intensity, mix),
  };
}

function updateTimeOfDay(delta) {
  if (state.timeMode === 'cycle') state.timeOfDay = wrap01(state.timeOfDay + delta * 0.0012);
  const palette = timePalette(state.timeOfDay);
  skyMaterial.uniforms.topColor.value.copy(palette.top);
  skyMaterial.uniforms.horizonColor.value.copy(palette.horizon);
  skyMaterial.uniforms.bottomColor.value.copy(palette.bottom);
  skyMaterial.uniforms.sunColor.value.copy(palette.sun);
  const angle = state.timeOfDay * Math.PI * 2 - Math.PI * 0.5;
  const sunDirection = new THREE.Vector3(Math.cos(angle), Math.sin(angle), -0.28).normalize();
  skyMaterial.uniforms.sunDirection.value.copy(sunDirection);
  sun.position.copy(sunDirection).multiplyScalar(1400);
  sun.color.copy(palette.light);
  sun.intensity = palette.intensity * (state.weather === 'storm' ? 0.38 : state.weather === 'rain' ? 0.7 : 1);
  hemisphere.intensity = Math.max(0.18, palette.intensity * 0.72);
  starField.material.opacity = smoothstep(0.77, 0.91, state.timeOfDay) + (1 - smoothstep(0.07, 0.2, state.timeOfDay));
  materials.window.emissiveIntensity = 0.55 + starField.material.opacity * 2.15;
  cloudOcean.material.uniforms.time.value = state.elapsed;
  cloudOcean.material.uniforms.color.value.copy(palette.bottom).lerp(new THREE.Color(0xffffff), 0.62);
  cloudOcean.material.uniforms.opacity.value = state.timeOfDay > 0.8 || state.timeOfDay < 0.16 ? 0.45 : 0.78;
}

function setTimeMode(mode) {
  state.timeMode = mode;
  const values = { dawn: 0.19, day: 0.42, sunset: 0.73, night: 0.91 };
  if (values[mode] !== undefined) state.timeOfDay = values[mode];
}

function createAudioSystem() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  const context = new AudioContextClass();
  const master = context.createGain();
  master.gain.value = 0.23;
  master.connect(context.destination);

  const engineOscillator = context.createOscillator();
  const engineGain = context.createGain();
  const engineFilter = context.createBiquadFilter();
  engineOscillator.type = 'sawtooth';
  engineOscillator.frequency.value = 32;
  engineGain.gain.value = 0.025;
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 145;
  engineOscillator.connect(engineFilter).connect(engineGain).connect(master);
  engineOscillator.start();

  const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let index = 0; index < noiseData.length; index += 1) noiseData[index] = Math.random() * 2 - 1;
  const windSource = context.createBufferSource();
  const windFilter = context.createBiquadFilter();
  const windGain = context.createGain();
  windSource.buffer = noiseBuffer;
  windSource.loop = true;
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 580;
  windFilter.Q.value = 0.45;
  windGain.gain.value = 0.008;
  windSource.connect(windFilter).connect(windGain).connect(master);
  windSource.start();
  return { context, master, engineOscillator, engineGain, engineFilter, windGain };
}

function updateAudio() {
  if (!audioSystem) return;
  const train = selectedTrain();
  const now = audioSystem.context.currentTime;
  const enabled = state.audioEnabled ? 1 : 0;
  audioSystem.master.gain.setTargetAtTime(enabled * 0.23, now, 0.08);
  audioSystem.engineOscillator.frequency.setTargetAtTime(29 + train.speed * 1.15, now, 0.08);
  audioSystem.engineFilter.frequency.setTargetAtTime(110 + train.speed * 8, now, 0.12);
  audioSystem.engineGain.gain.setTargetAtTime(enabled * (0.012 + train.speed * 0.0012), now, 0.1);
  audioSystem.windGain.gain.setTargetAtTime(enabled * (0.004 + train.speed * 0.0005), now, 0.2);
}

function playHorn() {
  if (!state.audioEnabled) return;
  if (!audioSystem) audioSystem = createAudioSystem();
  if (!audioSystem) return;
  if (audioSystem.context.state === 'suspended') audioSystem.context.resume();
  const train = selectedTrain();
  const now = audioSystem.context.currentTime;
  train.horn.forEach((frequency, index) => {
    const oscillator = audioSystem.context.createOscillator();
    const gain = audioSystem.context.createGain();
    const filter = audioSystem.context.createBiquadFilter();
    const start = now + index * 0.15;
    const duration = train.type === 'tram' ? 0.24 : train.type === 'steam' ? 0.72 : 0.5;
    oscillator.type = train.type === 'streamline' ? 'triangle' : 'sawtooth';
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.97, start + duration);
    filter.type = 'lowpass';
    filter.frequency.value = train.type === 'freight' ? 480 : 1100;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(train.type === 'freight' ? 0.34 : 0.2, start + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(filter).connect(gain).connect(audioSystem.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  });
}

const desiredCameraPosition = new THREE.Vector3();
const desiredCameraLookAt = new THREE.Vector3();
const currentCameraLookAt = new THREE.Vector3();

function localPointToWorld(object, x, y, z) { return object.localToWorld(new THREE.Vector3(x, y, z)); }

function cameraCompositionForMode(train) {
  const locomotive = train.parts[0].root;
  const routePose = poseOnRoute(train.routeIndex, train.u, 0, 1.5);
  const position = routePose.position;
  const forward = routePose.tangent.clone().multiplyScalar(train.direction).normalize();
  const side = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
  const speedFactor = train.speed / train.maxSpeed;
  const mode = state.cameraMode;

  if (mode === 0) {
    const rearPart = train.parts[train.parts.length - 1];
    const rearPose = getPartPose(train, rearPart.offset + 7);
    const distance = 48 + speedFactor * 15;
    desiredCameraPosition.copy(rearPose.position).addScaledVector(forward, -distance).addScaledVector(side, 22).add(new THREE.Vector3(0, 31 + speedFactor * 8, 0));
    desiredCameraLookAt.copy(position).addScaledVector(forward, 25).add(new THREE.Vector3(0, 5, 0));
  } else if (mode === 1) {
    desiredCameraPosition.copy(localPointToWorld(locomotive, 0, 6.25, -8.6));
    desiredCameraLookAt.copy(desiredCameraPosition).addScaledVector(forward, 90).add(new THREE.Vector3(0, 1, 0));
  } else if (mode === 2) {
    const passengerCar = train.parts[Math.min(1, train.parts.length - 1)].root;
    desiredCameraPosition.copy(localPointToWorld(passengerCar, 2.72, 5.25, 0));
    desiredCameraLookAt.copy(desiredCameraPosition).addScaledVector(side, 90).add(new THREE.Vector3(0, -3, 0));
  } else if (mode === 3) {
    const wave = Math.sin(state.elapsed * 0.16);
    desiredCameraPosition.copy(position).addScaledVector(side, 42 + wave * 16).addScaledVector(forward, wave * 22).add(new THREE.Vector3(0, 13, 0));
    desiredCameraLookAt.copy(position).addScaledVector(forward, 4).add(new THREE.Vector3(0, 4, 0));
  } else if (mode === 4) {
    const horizontal = Math.cos(state.orbitPitch) * state.orbitDistance;
    desiredCameraPosition.set(position.x + Math.sin(state.orbitYaw) * horizontal, position.y + 10 + Math.sin(state.orbitPitch) * state.orbitDistance, position.z + Math.cos(state.orbitYaw) * horizontal);
    desiredCameraLookAt.copy(position).add(new THREE.Vector3(0, 4, 0));
  } else if (mode === 5) {
    desiredCameraPosition.copy(position).add(new THREE.Vector3(0, 250, 120));
    desiredCameraLookAt.copy(position);
  } else if (mode === 6) {
    desiredCameraPosition.set(0, 2550, 20);
    desiredCameraLookAt.set(0, 300, 0);
  } else {
    desiredCameraPosition.copy(aurelion.position).add(new THREE.Vector3(100, 52, 115));
    desiredCameraLookAt.copy(aurelion.position);
  }
  if (state.eventTimer > 0 && state.cinematics && mode === 0) {
    desiredCameraPosition.copy(position).addScaledVector(side, 68).addScaledVector(forward, -18).add(new THREE.Vector3(0, 31, 0));
    desiredCameraLookAt.copy(position).addScaledVector(forward, 20);
  }
}

function updateCamera(delta) {
  const train = selectedTrain();
  cameraCompositionForMode(train);
  const damping = 1 - Math.exp(-delta * (state.cameraMode === 1 || state.cameraMode === 2 ? 9 : 3.8));
  if (!camera.position.lengthSq()) camera.position.copy(desiredCameraPosition);
  camera.position.lerp(desiredCameraPosition, damping);
  currentCameraLookAt.lerp(desiredCameraLookAt, damping);
  if (state.cameraShake > 0) {
    camera.position.x += (random() - 0.5) * state.cameraShake;
    camera.position.y += (random() - 0.5) * state.cameraShake;
    state.cameraShake = Math.max(0, state.cameraShake - delta * 1.4);
  }
  camera.lookAt(currentCameraLookAt);
}

function cycleCamera() {
  state.cameraMode = (state.cameraMode + 1) % cameraModes.length;
  dom.cameraLabel.textContent = cameraModes[state.cameraMode];
  if (state.cameraMode === 6) openPanel(dom.mapPanel);
}

function showScenicEvent(title, key) {
  if (state.lastScenicKey === key || !state.cinematics) return;
  state.lastScenicKey = key;
  state.eventTimer = 6;
  dom.eventTitle.textContent = title;
  dom.eventBanner.classList.remove('hidden');
  setTimeout(() => dom.eventBanner.classList.add('hidden'), 4300);
}

function updateScenicEvents() {
  const train = selectedTrain();
  if (train.routeIndex === 0 && train.u > 0.5 && train.u < 0.56) showScenicEvent('Cloud Dive · Folded Gardens', `dive-${Math.floor(train.distanceTravelled / routes[0].length)}`);
  if (train.routeIndex === 1 && train.u > 0.42 && train.u < 0.48) showScenicEvent('The Mountain Spiral', `spiral-${Math.floor(train.distanceTravelled / routes[1].length)}`);
  if (train.routeIndex === 2 && train.u > 0.31 && train.u < 0.37) showScenicEvent('The Great Sky Bridge', `bridge-${Math.floor(train.distanceTravelled / routes[2].length)}`);
  state.eventTimer = Math.max(0, state.eventTimer - 1 / 60);
}

function updateCreatures(delta) {
  const train = selectedTrain();
  const trigger = train.routeIndex === 2 ? smoothstep(0.25, 0.35, train.u) * (1 - smoothstep(0.56, 0.64, train.u)) : 0;
  aurelion.userData.eventStrength = THREE.MathUtils.damp(aurelion.userData.eventStrength, trigger, 1.4, delta);
  if (aurelion.userData.eventStrength > 0.04) {
    const pose = poseOnRoute(train.routeIndex, train.u, 0, 0);
    const forward = pose.tangent.clone().multiplyScalar(train.direction);
    const side = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
    const target = pose.position.clone().addScaledVector(side, 115).addScaledVector(forward, 18).add(new THREE.Vector3(0, -10 + Math.sin(state.elapsed * 0.35) * 16, 0));
    aurelion.position.lerp(target, 1 - Math.exp(-delta * 0.8));
    aurelion.rotation.y = Math.atan2(forward.x, forward.z) - Math.PI / 2;
  } else {
    const angle = state.elapsed * 0.018;
    const target = new THREE.Vector3(Math.cos(angle) * 1150, 570 + Math.sin(angle * 3) * 35, Math.sin(angle) * 1150);
    aurelion.position.lerp(target, 1 - Math.exp(-delta * 0.12));
    aurelion.rotation.y = -angle;
  }
  aurelion.userData.wings.forEach((wing, index) => { wing.rotation.z += Math.sin(state.elapsed * 1.2 + index) * delta * 0.1; });
  aurelion.userData.tail.forEach((segment, index) => { segment.position.y = Math.sin(state.elapsed * 0.8 - index * 0.5) * (1 + index * 0.38); segment.position.z = Math.sin(state.elapsed * 0.55 - index * 0.4) * index * 0.7; });
  worldGroups.creatures.children.forEach((creature, index) => {
    if (creature === aurelion) return;
    creature.position.y += Math.sin(state.elapsed * 0.7 + creature.userData.phase) * delta * 0.9;
    creature.rotation.y += delta * (0.03 + index * 0.002);
  });
  worldGroups.details.traverse((object) => { if (object.userData.isWindmill) object.rotation.z -= delta * 0.24; });
}

function mapCoordinates(vector, canvas) {
  const bounds = 1900;
  return {
    x: canvas.width * 0.5 + (vector.x / bounds) * canvas.width * 0.44,
    y: canvas.height * 0.5 + (vector.z / bounds) * canvas.height * 0.44,
  };
}

function drawRouteMap() {
  const canvas = dom.routeMap;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(canvas.width * 0.5, canvas.height * 0.5, 10, canvas.width * 0.5, canvas.height * 0.5, canvas.width * 0.62);
  gradient.addColorStop(0, '#315f60');
  gradient.addColorStop(1, '#0c3035');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.globalAlpha = 0.18;
  context.fillStyle = '#e9f5ed';
  for (let index = 0; index < 22; index += 1) {
    const x = (index * 173) % canvas.width;
    const y = (index * 97) % canvas.height;
    context.beginPath();
    context.ellipse(x, y, 80 + (index % 4) * 30, 18 + (index % 3) * 6, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  routes.forEach((route) => {
    context.beginPath();
    for (let index = 0; index <= 240; index += 1) {
      const point = route.curve.getPointAt(index / 240);
      const mapPoint = mapCoordinates(point, canvas);
      if (index === 0) context.moveTo(mapPoint.x, mapPoint.y); else context.lineTo(mapPoint.x, mapPoint.y);
    }
    context.lineWidth = 7;
    context.strokeStyle = 'rgba(6,28,31,.64)';
    context.stroke();
    context.lineWidth = 2.4;
    context.strokeStyle = route.color;
    context.stroke();
  });

  stations.forEach((station) => {
    const point = mapCoordinates(station.position, canvas);
    context.fillStyle = '#e8755f';
    context.beginPath();
    context.arc(point.x, point.y, station.name === 'Grand Cloud Junction' ? 7 : 4.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(245,237,210,.88)';
    context.font = station.name === 'Grand Cloud Junction' ? '600 13px Inter' : '500 10px Inter';
    context.textAlign = 'center';
    context.fillText(station.name, point.x, point.y - 10);
  });

  trains.forEach((train) => {
    const point = mapCoordinates(poseOnRoute(train.routeIndex, train.u).position, canvas);
    const selected = train.index === state.selectedTrain;
    context.fillStyle = selected ? '#ffda75' : '#d9ece9';
    context.shadowColor = context.fillStyle;
    context.shadowBlur = selected ? 12 : 4;
    context.beginPath();
    context.arc(point.x, point.y, selected ? 7 : 4.5, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  });
}

function createDestinationButtons() {
  dom.destinationList.replaceChildren();
  stations.filter((station) => station.name !== 'Grand Cloud Junction').forEach((station) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${station.name} · ${routeNames[station.routeIndex]}`;
    button.addEventListener('click', () => {
      state.pendingRoute = station.routeIndex;
      selectedTrain().pendingRouteIndex = station.routeIndex;
      selectedTrain().destinationOverride = station.name;
      updateSwitchDisplay();
      closePanel(dom.mapPanel);
      showScenicEvent(`Route set · ${station.name}`, `destination-${station.name}-${Date.now()}`);
    });
    dom.destinationList.appendChild(button);
  });
}

function openPanel(panel) {
  panel.classList.remove('hidden');
  if (panel === dom.mapPanel) { state.mapOpen = true; drawRouteMap(); }
  if (panel === dom.settingsPanel) state.settingsOpen = true;
}

function closePanel(panel) {
  panel.classList.add('hidden');
  if (panel === dom.mapPanel) state.mapOpen = false;
  if (panel === dom.settingsPanel) state.settingsOpen = false;
}

function updateSwitchDisplay() {
  dom.switchLabel.textContent = routeNames[state.pendingRoute];
  worldGroups.details.traverse((object) => {
    if (object.userData.routeIndex !== undefined && object.geometry?.type === 'BoxGeometry' && object.scale.y > 0) {
      object.material = object.userData.routeIndex === state.pendingRoute ? materials.brass : materials.rail;
    }
  });
}

function selectTrainByIndex(index) {
  state.selectedTrain = (index + trains.length) % trains.length;
  const train = selectedTrain();
  state.pendingRoute = train.pendingRouteIndex ?? train.routeIndex;
  dom.trainName.textContent = train.name;
  dom.trainCounter.textContent = `${state.selectedTrain + 1} / ${trains.length}`;
  dom.power.value = Math.round(train.throttle * 100);
  dom.brake.value = Math.round(train.brake * 100);
  dom.autoButton.classList.toggle('active', train.auto);
  dom.reverseButton.querySelector('small').textContent = train.direction > 0 ? 'FORWARD' : 'REVERSE';
  updateSwitchDisplay();
  currentCameraLookAt.copy(train.parts[0].root.position);
}

function updateHUD() {
  const train = selectedTrain();
  const next = getNextStation(train);
  const route = routes[train.routeIndex];
  const sameRouteAhead = next.routeIndex === train.routeIndex && next.u > train.u;
  const distance = sameRouteAhead ? (next.u - train.u) * route.length : (1 - train.u) * route.length;
  const kmh = train.speed * 3.6;
  const altitude = train.parts[0].root.position.y;
  dom.trainName.textContent = train.name;
  dom.speed.textContent = Math.round(kmh);
  dom.altitude.textContent = `${Math.round(altitude)} m`;
  dom.region.textContent = getRegion(train);
  dom.operationMode.textContent = train.auto ? 'AUTO DRIVE' : train.atStation ? 'STATION STOP' : 'MANUAL DRIVE';
  dom.operationMode.style.color = train.auto ? '#b9f0cf' : '#f0d69a';
  dom.nextStation.textContent = train.destinationOverride || next.name;
  dom.stationDistance.textContent = `${(distance / 1000).toFixed(distance < 1000 ? 2 : 1)} km`;
  dom.stationEta.textContent = train.speed > 0.5 ? `${Math.max(1, Math.ceil(distance / train.speed / 60))} min` : 'WAIT';
  dom.routeProgress.style.width = `${clamp(train.u * 100, 0, 100)}%`;
  dom.powerValue.textContent = `${Math.round(train.throttle * 100)}%`;
  dom.brakeValue.textContent = `${Math.round(train.brake * 100)}%`;
  if (document.activeElement !== dom.power) dom.power.value = Math.round(train.throttle * 100);
  if (document.activeElement !== dom.brake) dom.brake.value = Math.round(train.brake * 100);
  dom.autoButton.classList.toggle('active', train.auto);
}

function applyQuality(quality) {
  state.quality = quality;
  const profile = qualityProfiles[quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
  renderer.shadowMap.enabled = profile.shadows;
  sun.castShadow = profile.shadows;
  camera.far = profile.drawDistance;
  camera.updateProjectionMatrix();
}

function bindInterface() {
  dom.start.addEventListener('click', async () => {
    if (state.started) return;
    state.started = true;
    try {
      if (state.audioEnabled) {
        audioSystem = createAudioSystem();
        if (audioSystem?.context.state === 'suspended') await audioSystem.context.resume();
      }
    } catch (error) { console.warn('Audio initialization skipped:', error); }
    dom.loading.classList.add('is-leaving');
    dom.hud.classList.remove('hidden');
    setTimeout(() => dom.loading.classList.add('hidden'), 900);
    clock.getDelta();
  }, { once: true });

  dom.previousTrain.addEventListener('click', () => selectTrainByIndex(state.selectedTrain - 1));
  dom.nextTrain.addEventListener('click', () => selectTrainByIndex(state.selectedTrain + 1));
  dom.cameraButton.addEventListener('click', cycleCamera);
  dom.mapButton.addEventListener('click', () => openPanel(dom.mapPanel));
  dom.settingsButton.addEventListener('click', () => openPanel(dom.settingsPanel));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closePanel($(button.dataset.close))));
  [dom.mapPanel, dom.settingsPanel].forEach((panel) => panel.addEventListener('pointerdown', (event) => { if (event.target === panel) closePanel(panel); }));

  const setManual = () => {
    const train = selectedTrain();
    train.auto = false;
    train.throttle = Number(dom.power.value) / 100;
    train.brake = Number(dom.brake.value) / 100;
  };
  dom.power.addEventListener('input', setManual);
  dom.brake.addEventListener('input', setManual);
  dom.autoButton.addEventListener('click', () => { const train = selectedTrain(); train.auto = !train.auto; dom.autoButton.classList.toggle('active', train.auto); });
  dom.reverseButton.addEventListener('click', () => {
    const train = selectedTrain();
    if (train.speed > 1.2) { showScenicEvent('Stop the train before reversing', `reverse-warning-${Date.now()}`); return; }
    train.direction *= -1;
    dom.reverseButton.querySelector('small').textContent = train.direction > 0 ? 'FORWARD' : 'REVERSE';
  });
  dom.switchButton.addEventListener('click', () => {
    state.pendingRoute = (state.pendingRoute + 1) % routes.length;
    selectedTrain().pendingRouteIndex = state.pendingRoute;
    selectedTrain().destinationOverride = '';
    updateSwitchDisplay();
  });
  dom.hornButton.addEventListener('pointerdown', playHorn);

  dom.quality.value = state.quality;
  dom.quality.addEventListener('change', () => applyQuality(dom.quality.value));
  dom.weather.addEventListener('change', () => applyWeather(dom.weather.value));
  dom.time.addEventListener('change', () => setTimeMode(dom.time.value));
  dom.cinematic.addEventListener('change', () => { state.cinematics = dom.cinematic.checked; });
  dom.audio.addEventListener('change', () => { state.audioEnabled = dom.audio.checked; });

  renderer.domElement.addEventListener('pointerdown', (event) => {
    state.dragging = true;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    if (state.cameraMode !== 4) { state.cameraMode = 4; dom.cameraLabel.textContent = cameraModes[4]; }
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!state.dragging) return;
    state.orbitYaw -= (event.clientX - state.pointerX) * 0.006;
    state.orbitPitch = clamp(state.orbitPitch + (event.clientY - state.pointerY) * 0.004, -0.2, 1.18);
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
  });
  const releasePointer = () => { state.dragging = false; };
  renderer.domElement.addEventListener('pointerup', releasePointer);
  renderer.domElement.addEventListener('pointercancel', releasePointer);
  renderer.domElement.addEventListener('wheel', (event) => { state.orbitDistance = clamp(state.orbitDistance + event.deltaY * 0.035, 20, 160); }, { passive: true });

  window.addEventListener('keydown', (event) => {
    const train = selectedTrain();
    if (event.code === 'KeyC') cycleCamera();
    else if (event.code === 'KeyH') playHorn();
    else if (event.code === 'KeyW' || event.code === 'ArrowUp') { train.auto = false; train.throttle = clamp(train.throttle + 0.08, 0, 1); }
    else if (event.code === 'KeyS' || event.code === 'ArrowDown') { train.auto = false; train.throttle = clamp(train.throttle - 0.08, 0, 1); }
    else if (event.code === 'Space') { event.preventDefault(); train.auto = false; train.brake = 1; }
    else if (event.code === 'KeyM') openPanel(dom.mapPanel);
  });
  window.addEventListener('keyup', (event) => { if (event.code === 'Space') selectedTrain().brake = 0; });
  window.addEventListener('resize', resizeRenderer);
  document.addEventListener('visibilitychange', () => { state.paused = document.hidden; clock.getDelta(); });
  renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); showFatal(new Error('The graphics context was lost. Reload the application to continue.')); });
}

function resizeRenderer() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

function initializeRenderer() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xcbe4e1, 0.00014);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.2, qualityProfiles[state.quality].drawDistance);
  renderer = new THREE.WebGLRenderer({ antialias: state.quality !== 'low', powerPreference: 'high-performance', alpha: false, stencil: false });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, qualityProfiles[state.quality].pixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = qualityProfiles[state.quality].shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  dom.world.appendChild(renderer.domElement);

  hemisphere = new THREE.HemisphereLight(0xfff4d1, 0x47666c, 1.05);
  sun = new THREE.DirectionalLight(0xffe0aa, 1.45);
  sun.position.set(-900, 1200, -500);
  sun.castShadow = qualityProfiles[state.quality].shadows;
  sun.shadow.mapSize.setScalar(qualityProfiles[state.quality].shadowSize);
  sun.shadow.camera.left = -700;
  sun.shadow.camera.right = 700;
  sun.shadow.camera.top = 700;
  sun.shadow.camera.bottom = -700;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 3000;
  sun.shadow.bias = -0.0003;
  scene.add(hemisphere, sun);
  Object.values(worldGroups).forEach((group) => scene.add(group));
  clock = new THREE.Clock();
}

async function yieldFrame() { await new Promise((resolve) => requestAnimationFrame(resolve)); }

async function initialize() {
  if (!canUseWebGL()) throw new Error('WebGL is unavailable. Enable hardware acceleration or use a modern Chrome/Edge browser.');
  setProgress(7, 'Starting the celestial railway engine…');
  initializeRenderer();
  createMaterials();
  routes = createRouteDefinitions();
  await yieldFrame();
  setProgress(22, 'Laying three mountain railway lines…');
  createTrackNetwork();
  await yieldFrame();
  setProgress(40, 'Forming the cloud ocean and distant skies…');
  createSkyAndAtmosphere();
  await yieldFrame();
  setProgress(57, 'Raising islands, villages and stations…');
  createWorldRegions();
  await yieldFrame();
  setProgress(73, 'Assembling six celestial trains…');
  createTrains();
  await yieldFrame();
  setProgress(85, 'Awakening the Aurelion…');
  createAurelion();
  createWeatherSystem();
  applyWeather('clear');
  await yieldFrame();
  setProgress(94, 'Connecting controls, signals and route map…');
  createDestinationButtons();
  bindInterface();
  selectTrainByIndex(0);
  updateSignals();
  updateTimeOfDay(0);
  updateCamera(1);
  renderer.render(scene, camera);
  setProgress(100, 'Your train is ready at Grand Cloud Junction.');
  dom.start.disabled = false;
  renderer.setAnimationLoop(animate);
}

function animate() {
  const rawDelta = Math.min(0.05, clock.getDelta());
  const delta = state.paused ? 0 : rawDelta;
  state.elapsed += delta;
  if (state.started && delta > 0) {
    trains.forEach((train) => updateTrainPhysics(train, delta));
    if (Math.floor(state.elapsed * 4) !== Math.floor((state.elapsed - delta) * 4)) updateSignals();
    updateScenicEvents();
  }
  if (cloudInstances) cloudInstances.rotation.y += delta * 0.0015;
  if (aurelion) updateCreatures(delta);
  updateTimeOfDay(delta);
  updateWeather(delta);
  updateCamera(delta || 0.016);
  updateAudio();
  updateHUD();
  if (state.mapOpen && state.frames % 8 === 0) drawRouteMap();
  renderer.render(scene, camera);
  state.frames += 1;
  state.fpsTime += rawDelta;
  if (state.fpsTime >= 0.75) {
    dom.fps.textContent = Math.round((state.frames * 0.75) / state.fpsTime);
    state.frames = 0;
    state.fpsTime = 0;
  }
}

window.addEventListener('error', (event) => {
  if (!state.started && event.error) showFatal(event.error);
});
window.addEventListener('unhandledrejection', (event) => showFatal(event.reason));

initialize().catch(showFatal);
