import * as THREE from 'three';

// Living inhabitants of the sky world: villagers, platform passengers, sheep, bird flocks,
// glider pilots, winged sky folk, manta rays and sky whales. Everything is procedural and
// animated with simple steering, gait cycles and spine-following so motion reads as natural.
// People, sheep and birds are instanced per body part so the whole population costs a handful
// of draw calls.

const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

// Deterministic generator so the world populates identically every load.
let seed = 424242;
function random() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function range(min, max) { return min + (max - min) * random(); }
function pick(list) { return list[Math.floor(random() * list.length) % list.length]; }
function wrapAngle(angle) { return Math.atan2(Math.sin(angle), Math.cos(angle)); }
function damp(current, target, lambda, delta) { return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * delta)); }

// Sky whale migration routes, kept in bands clear of railways and station islands.
// Far islands consult `isNearWhaleRoute` so they are never placed in a whale's way.
export const whaleRoutes = [
  { name: 'high-migration', points: ellipse(2350, 2050, 560, 90, 3, 14, 0.2), speed: 8.5, scale: 1.25 },
  { name: 'cloud-swimmers', points: ellipse(1950, 1850, 120, 52, 2, 12, 1.4, 70), speed: 6.5, scale: 1, calf: true },
  { name: 'junction-pod', points: ellipse(560, 520, 255, 14, 2, 10, 2.6), speed: 5, scale: 0.55 },
];

function ellipse(rx, rz, y, wave, waves, count, phase = 0, minY = -Infinity) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * TAU + phase;
    return new THREE.Vector3(Math.cos(angle) * rx, Math.max(minY, y + Math.sin(angle * waves) * wave), Math.sin(angle) * rz);
  });
}

const whaleCurves = whaleRoutes.map((route) => new THREE.CatmullRomCurve3(route.points, true, 'centripetal'));
const whaleSamples = whaleCurves.map((curve) => curve.getSpacedPoints(240));

export function isNearWhaleRoute(position, clearance) {
  return whaleSamples.some((samples) => samples.some((point) => point.distanceTo(position) < clearance));
}

export function createSkyLife(ctx) {
  const { scene, quality, islands, platforms, trackDistance, occluders, getNight } = ctx;
  const low = quality === 'low';
  const shadows = quality !== 'low';
  const group = new THREE.Group();
  group.name = 'sky-life';
  scene.add(group);

  const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x9ff3e4, transparent: true, opacity: 0.2 });

  // ---------------------------------------------------------------------------------------
  // Shared ground helpers
  // ---------------------------------------------------------------------------------------
  function groundY(island, x, z) {
    const distance = Math.hypot(x - island.x, z - island.z);
    return island.y + 0.9 * Math.max(0, 1 - distance / (island.radius * 0.95));
  }

  function walkable(island, x, z, clearance) {
    const distance = Math.hypot(x - island.x, z - island.z);
    if (distance > island.radius * 0.72) return false;
    if (trackDistance(x, island.y + 3, z, 25, 40) < clearance) return false;
    // Never walk into (or under) a platform.
    if (platforms.some((platform) => {
      const dx = x - platform.center.x;
      const dz = z - platform.center.z;
      return Math.abs(dx * platform.tangent.x + dz * platform.tangent.z) < platform.length / 2 + 4 && Math.abs(dx * platform.toward.x + dz * platform.toward.z) < platform.width / 2 + 4;
    })) return false;
    return occluders.every((occluder) => Math.hypot(occluder.x - x, occluder.z - z) > occluder.radius + 1.2 || occluder.top < island.y || occluder.bottom > island.y + 6);
  }

  function pathClear(island, from, to, clearance) {
    for (let step = 1; step <= 4; step += 1) {
      const t = step / 5;
      if (!walkable(island, THREE.MathUtils.lerp(from.x, to.x, t), THREE.MathUtils.lerp(from.z, to.z, t), clearance)) return false;
    }
    return walkable(island, to.x, to.z, clearance);
  }

  function randomSpot(island, clearance) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const angle = range(0, TAU);
      const distance = Math.sqrt(random()) * island.radius * 0.7;
      const x = island.x + Math.cos(angle) * distance;
      const z = island.z + Math.sin(angle) * distance;
      if (walkable(island, x, z, clearance)) return new THREE.Vector3(x, groundY(island, x, z), z);
    }
    return null;
  }

  // Wander agent: picks nearby reachable goals, turns smoothly, eases speed, pauses to idle.
  function makeWanderer(island, position, options) {
    return {
      island, position, heading: range(0, TAU), speed: 0, target: null, idle: range(0.5, 4),
      phase: range(0, TAU), clearance: options.clearance, walkSpeed: range(options.minSpeed, options.maxSpeed),
      reach: options.reach, idleRange: options.idleRange, turnRate: options.turnRate, look: 0, lookTarget: 0,
    };
  }

  function updateWanderer(agent, delta) {
    if (!agent.target) {
      agent.idle -= delta;
      agent.speed = damp(agent.speed, 0, 6, delta);
      if (agent.idle <= 0) {
        for (let attempt = 0; attempt < 10 && !agent.target; attempt += 1) {
          const angle = agent.heading + range(-1.6, 1.6);
          const distance = range(agent.reach[0], agent.reach[1]);
          const candidate = new THREE.Vector3(agent.position.x + Math.sin(angle) * distance, 0, agent.position.z + Math.cos(angle) * distance);
          if (pathClear(agent.island, agent.position, candidate, agent.clearance)) agent.target = candidate;
        }
        if (!agent.target) agent.idle = range(1, 3);
      }
    } else {
      const dx = agent.target.x - agent.position.x;
      const dz = agent.target.z - agent.position.z;
      const distance = Math.hypot(dx, dz);
      const desired = Math.atan2(dx, dz);
      const turn = wrapAngle(desired - agent.heading);
      agent.heading += THREE.MathUtils.clamp(turn, -agent.turnRate * delta, agent.turnRate * delta);
      // Slow down for sharp turns and on arrival, like a person picking their way.
      const alignment = Math.max(0, Math.cos(turn));
      const arrive = THREE.MathUtils.clamp(distance / 2.5, 0.25, 1);
      agent.speed = damp(agent.speed, agent.walkSpeed * alignment * arrive, 3, delta);
      agent.position.x += Math.sin(agent.heading) * agent.speed * delta;
      agent.position.z += Math.cos(agent.heading) * agent.speed * delta;
      if (distance < 0.6) { agent.target = null; agent.idle = range(agent.idleRange[0], agent.idleRange[1]); agent.lookTarget = range(-0.8, 0.8); }
    }
    agent.position.y = groundY(agent.island, agent.position.x, agent.position.z);
    if (random() < delta * 0.25) agent.lookTarget = agent.target ? range(-0.3, 0.3) : range(-0.9, 0.9);
    agent.look = damp(agent.look, agent.lookTarget, 2.5, delta);
  }

  // ---------------------------------------------------------------------------------------
  // People (instanced parts)
  // ---------------------------------------------------------------------------------------
  const clothes = [0xb8553f, 0x2f6f73, 0xe0b44e, 0x2d4859, 0x7d4f86, 0x6f8f4e, 0xf0dcb4, 0x9a3d36];
  const trousers = [0x3b2f2a, 0x283a45, 0x4b3b2e, 0x5a4636, 0x2e3a2c];
  const skins = [0xf1c9a5, 0xd9a479, 0xb57a52, 0x8a5636, 0xe8b88e];
  const hats = [0xb8553f, 0xe8d7a8, 0x2f6f73, 0x3b2f2a, 0xc79a48];

  const people = [];
  const villagerIslands = islands.filter((island) => island.landmark || island.hub);
  villagerIslands.forEach((island) => {
    const count = island.hub ? (low ? 10 : 20) : (low ? 2 : 4);
    for (let index = 0; index < count; index += 1) {
      const spot = randomSpot(island, 7);
      if (!spot) continue;
      people.push({ kind: 'villager', agent: makeWanderer(island, spot, { clearance: 7, minSpeed: 1.0, maxSpeed: 1.55, reach: [6, 26], idleRange: [1.5, 7], turnRate: 2.6 }) });
    }
  });
  platforms.forEach((platform) => {
    const count = platform.grand ? (low ? 4 : 8) : (low ? 1 : 2);
    for (let index = 0; index < count; index += 1) {
      people.push({
        kind: 'passenger', platform, along: range(-0.42, 0.42) * platform.length, across: range(-0.25, 0.3) * platform.width,
        target: null, speed: 0, heading: 0, phase: range(0, TAU), idle: range(2, 12), walkSpeed: range(0.8, 1.2), look: 0, lookTarget: 0,
        position: new THREE.Vector3(),
      });
    }
  });
  people.forEach((person) => {
    person.phase = range(0, TAU);
    person.scale = range(0.92, 1.08) * 1.2;
    person.child = random() < 0.12;
    if (person.child) person.scale *= 0.62;
    person.hat = random() < 0.45;
    person.waveTimer = range(5, 30);
    person.wave = 0;
  });

  const personParts = {
    torso: new THREE.CylinderGeometry(0.24, 0.31, 0.78, 8).translate(0, 0, 0),
    head: new THREE.SphereGeometry(0.2, 10, 8),
    hat: new THREE.ConeGeometry(0.27, 0.3, 8),
    leg: new THREE.CylinderGeometry(0.085, 0.075, 0.84, 6).translate(0, -0.42, 0),
    arm: new THREE.CylinderGeometry(0.065, 0.055, 0.64, 6).translate(0, -0.32, 0),
  };
  const personCount = Math.max(1, people.length);
  const instanced = (geometry, count) => {
    const mesh = new THREE.InstancedMesh(geometry, lambert(0xffffff), count);
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    group.add(mesh);
    return mesh;
  };
  const torsoMesh = instanced(personParts.torso, personCount);
  const headMesh = instanced(personParts.head, personCount);
  const hatMesh = instanced(personParts.hat, personCount);
  const legMesh = instanced(personParts.leg, personCount * 2);
  const armMesh = instanced(personParts.arm, personCount * 2);
  const color = new THREE.Color();
  people.forEach((person, index) => {
    const shirt = pick(clothes);
    torsoMesh.setColorAt(index, color.set(shirt));
    headMesh.setColorAt(index, color.set(pick(skins)));
    hatMesh.setColorAt(index, color.set(pick(hats)));
    const pants = pick(trousers);
    legMesh.setColorAt(index * 2, color.set(pants));
    legMesh.setColorAt(index * 2 + 1, color.set(pants));
    armMesh.setColorAt(index * 2, color.set(shirt).multiplyScalar(0.92));
    armMesh.setColorAt(index * 2 + 1, color.set(shirt).multiplyScalar(0.92));
  });

  const root = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const tempQuaternion = new THREE.Quaternion();
  const tempEuler = new THREE.Euler();
  const tempScale = new THREE.Vector3();
  const tempPosition = new THREE.Vector3();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  function setPart(mesh, index, x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1) {
    tempEuler.set(rx, ry, rz);
    tempQuaternion.setFromEuler(tempEuler);
    local.compose(tempPosition.set(x, y, z), tempQuaternion, tempScale.set(sx, sy, sz));
    world.multiplyMatrices(root, local);
    mesh.setMatrixAt(index, world);
  }

  function updatePassenger(person, delta) {
    const { platform } = person;
    if (!person.target) {
      person.idle -= delta;
      person.speed = damp(person.speed, 0, 5, delta);
      if (person.idle <= 0) {
        person.target = THREE.MathUtils.clamp(person.along + range(-18, 18), -platform.length * 0.44, platform.length * 0.44);
        person.idle = range(4, 16);
      }
      // Waiting passengers mostly face the track, glancing along it for the next train.
      if (random() < delta * 0.3) person.lookTarget = range(-1, 1);
    } else {
      const remaining = person.target - person.along;
      person.speed = damp(person.speed, Math.sign(remaining) * person.walkSpeed * THREE.MathUtils.clamp(Math.abs(remaining) / 2, 0.3, 1), 3, delta);
      person.along += person.speed * delta;
      if (Math.abs(remaining) < 0.3) person.target = null;
    }
    person.look = damp(person.look, person.lookTarget, 2, delta);
    const facingTrack = Math.atan2(platform.toward.x, platform.toward.z);
    const walkingYaw = Math.atan2(platform.tangent.x * Math.sign(person.speed || 1), platform.tangent.z * Math.sign(person.speed || 1));
    const desired = Math.abs(person.speed) > 0.2 ? walkingYaw : facingTrack;
    person.heading += wrapAngle(desired - person.heading) * (1 - Math.exp(-4 * delta));
    person.position.copy(platform.center).addScaledVector(platform.tangent, person.along).addScaledVector(platform.toward, person.across);
    person.position.y = platform.top;
  }

  function updatePeople(delta, elapsed, cameraPosition, trainNear) {
    people.forEach((person, index) => {
      let speed;
      let heading;
      let look;
      if (person.kind === 'villager') {
        if (person.agent.position.distanceToSquared(cameraPosition) < 700 * 700) updateWanderer(person.agent, delta);
        person.position = person.agent.position;
        speed = person.agent.speed;
        heading = person.agent.heading;
        look = person.agent.look;
      } else {
        updatePassenger(person, delta);
        speed = Math.abs(person.speed);
        heading = person.heading;
        look = person.look;
      }
      if (person.position.distanceToSquared(cameraPosition) > 900 * 900) return;
      // Occasionally wave at a passing train.
      person.waveTimer -= delta;
      if (person.waveTimer <= 0) { person.waveTimer = range(8, 30); if (trainNear(person.position, 70)) person.wave = 3.2; }
      person.wave = Math.max(0, person.wave - delta);

      const stride = speed / 1.3;
      person.phase += delta * (2.2 + speed * 3.2);
      const swing = Math.sin(person.phase) * 0.62 * Math.min(1, stride);
      const bob = Math.abs(Math.cos(person.phase)) * 0.06 * Math.min(1, stride);
      const breathe = Math.sin(elapsed * 1.6 + index) * 0.012;
      const lean = 0.08 * Math.min(1, stride);
      tempEuler.set(lean, heading, 0, 'YXZ');
      tempQuaternion.setFromEuler(tempEuler);
      root.compose(person.position, tempQuaternion, tempScale.setScalar(person.scale));

      setPart(torsoMesh, index, 0, 1.22 + bob + breathe, 0, 0, 0, 0);
      setPart(headMesh, index, 0, 1.82 + bob + breathe, 0.02, 0, look, 0);
      if (person.hat) setPart(hatMesh, index, 0, 2.06 + bob + breathe, 0.02, 0, look, 0); else hatMesh.setMatrixAt(index, hidden);
      setPart(legMesh, index * 2, -0.12, 0.86 + bob, 0, swing, 0, 0);
      setPart(legMesh, index * 2 + 1, 0.12, 0.86 + bob, 0, -swing, 0, 0);
      const waving = person.wave > 0;
      const waveArm = waving ? -2.7 + Math.sin(elapsed * 9) * 0.35 : -swing * 0.8;
      setPart(armMesh, index * 2, -0.33, 1.56 + bob, 0, -swing * 0.8, 0, -0.08 - (1 - Math.min(1, stride)) * 0.02);
      setPart(armMesh, index * 2 + 1, 0.33, 1.56 + bob, 0, waveArm, 0, waving ? -0.35 : 0.08);
    });
    [torsoMesh, headMesh, hatMesh, legMesh, armMesh].forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  }

  // ---------------------------------------------------------------------------------------
  // Sheep
  // ---------------------------------------------------------------------------------------
  const sheep = [];
  islands.filter((island) => island.hub || ['meadow', 'garden', 'pine'].includes(island.biome)).forEach((island) => {
    const count = island.hub ? (low ? 4 : 8) : island.landmark ? (low ? 2 : 4) : (low ? 1 : 2);
    // A small flock grazes together around one patch of the island.
    const patch = randomSpot(island, 12);
    if (!patch) return;
    for (let index = 0; index < count; index += 1) {
      const x = patch.x + range(-10, 10);
      const z = patch.z + range(-10, 10);
      if (!walkable(island, x, z, 10)) continue;
      const agent = makeWanderer(island, new THREE.Vector3(x, groundY(island, x, z), z), { clearance: 10, minSpeed: 0.35, maxSpeed: 0.6, reach: [2, 8], idleRange: [4, 14], turnRate: 1.2 });
      sheep.push({ agent, graze: random(), scale: range(0.9, 1.15) * 1.35, black: random() < 0.12 });
    }
  });
  const sheepCount = Math.max(1, sheep.length);
  const sheepBody = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.62, 1), lambert(0xffffff, { flatShading: true }), sheepCount);
  const sheepHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 8, 6), lambert(0x2f2a28), sheepCount);
  const sheepLeg = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 5).translate(0, -0.25, 0), lambert(0x2f2a28), sheepCount * 4);
  [sheepBody, sheepHead, sheepLeg].forEach((mesh) => { mesh.frustumCulled = false; mesh.castShadow = shadows; group.add(mesh); });
  sheep.forEach((animal, index) => sheepBody.setColorAt(index, color.set(animal.black ? 0x4a403a : 0xf3eee2)));

  function updateSheep(delta, elapsed, cameraPosition) {
    sheep.forEach((animal, index) => {
      const near = animal.agent.position.distanceToSquared(cameraPosition) < 600 * 600;
      if (near) updateWanderer(animal.agent, delta);
      if (!near) return;
      const { agent } = animal;
      // Graze while standing: head dips to the grass and lifts to chew and look around.
      const grazing = agent.speed < 0.08;
      animal.graze = damp(animal.graze, grazing ? (Math.sin(elapsed * 0.5 + index * 1.7) > -0.3 ? 1 : 0) : 0, 1.8, delta);
      agent.phase += delta * (agent.speed * 9);
      const step = Math.sin(agent.phase) * 0.5 * Math.min(1, agent.speed / 0.4);
      tempEuler.set(0, agent.heading, 0, 'YXZ');
      tempQuaternion.setFromEuler(tempEuler);
      root.compose(agent.position, tempQuaternion, tempScale.setScalar(animal.scale));
      const bob = Math.abs(Math.cos(agent.phase)) * 0.03;
      setPart(sheepBody, index, 0, 0.78 + bob, 0, 0, 0, 0, 0.95, 0.85, 1.35);
      const chew = grazing ? Math.sin(elapsed * 5 + index) * 0.02 : 0;
      setPart(sheepHead, index, 0, THREE.MathUtils.lerp(0.98, 0.42, animal.graze) + chew, THREE.MathUtils.lerp(0.82, 0.92, animal.graze), 0, agent.look * 0.6, 0, 1, 1, 1.3);
      [[-0.26, 0.45, step], [0.26, 0.45, -step], [-0.26, -0.45, -step], [0.26, -0.45, step]].forEach(([x, z, angle], leg) => {
        setPart(sheepLeg, index * 4 + leg, x, 0.52 + bob, z, angle, 0, 0);
      });
    });
    [sheepBody, sheepHead, sheepLeg].forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  }

  // ---------------------------------------------------------------------------------------
  // Bird flocks
  // ---------------------------------------------------------------------------------------
  const flockCenters = [
    { center: new THREE.Vector3(0, 380, 0), radius: 190 },
    ...islands.filter((island) => island.landmark).slice(0, low ? 2 : 5).map((island) => ({ center: new THREE.Vector3(island.x, island.y + 45, island.z), radius: island.radius * 1.1 })),
  ];
  const birds = [];
  flockCenters.forEach((flock, flockIndex) => {
    flock.angle = range(0, TAU);
    flock.speed = range(0.06, 0.1) * (flockIndex % 2 ? -1 : 1);
    flock.wobble = range(0, TAU);
    const count = low ? 6 : 11;
    for (let index = 0; index < count; index += 1) {
      birds.push({ flock, offset: new THREE.Vector3(range(-9, 9), range(-3, 3), range(-12, 4)), phase: range(0, TAU), rate: range(7, 10), burst: range(0, TAU), drift: range(0, TAU) });
    }
  });
  const wingGeometry = new THREE.BufferGeometry();
  wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, 0, 0, -0.25, 1.05, 0, -0.15], 3));
  wingGeometry.computeVertexNormals();
  const birdMaterial = new THREE.MeshLambertMaterial({ color: 0xf6f1e6, side: THREE.DoubleSide });
  const birdCount = Math.max(1, birds.length);
  const leftWing = new THREE.InstancedMesh(wingGeometry, birdMaterial, birdCount);
  const rightWing = new THREE.InstancedMesh(wingGeometry, birdMaterial, birdCount);
  const birdBody = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 4), lambert(0xe9e2d4), birdCount);
  [leftWing, rightWing, birdBody].forEach((mesh) => { mesh.frustumCulled = false; group.add(mesh); });
  const flockPosition = new THREE.Vector3();
  const flockForward = new THREE.Vector3();

  function updateBirds(delta, elapsed, cameraPosition) {
    flockCenters.forEach((flock) => { flock.angle += flock.speed * delta; });
    birds.forEach((bird, index) => {
      const { flock } = bird;
      const radius = flock.radius * (1 + Math.sin(elapsed * 0.05 + flock.wobble) * 0.25);
      flockPosition.set(Math.cos(flock.angle) * radius, Math.sin(elapsed * 0.13 + flock.wobble) * 14, Math.sin(flock.angle) * radius).add(flock.center);
      if (flockPosition.distanceToSquared(cameraPosition) > 1200 * 1200) return;
      flockForward.set(-Math.sin(flock.angle) * Math.sign(flock.speed), 0, Math.cos(flock.angle) * Math.sign(flock.speed));
      const heading = Math.atan2(flockForward.x, flockForward.z);
      // Each bird drifts within the flock, and alternates bursts of flapping with glides.
      const drift = new THREE.Vector3(Math.sin(elapsed * 0.4 + bird.drift) * 2.5, Math.sin(elapsed * 0.6 + bird.drift * 2) * 1.5, Math.cos(elapsed * 0.3 + bird.drift) * 2.5);
      const offset = bird.offset.clone().add(drift).applyAxisAngle(UP, heading);
      const position = flockPosition.clone().add(offset);
      const flapping = Math.sin(elapsed * 0.35 + bird.burst) > -0.2;
      bird.phase += delta * (flapping ? bird.rate : 1.2);
      const flap = flapping ? Math.sin(bird.phase) * 0.75 : 0.12 + Math.sin(bird.phase) * 0.05;
      const bank = -flock.speed * 4;
      tempEuler.set(0, heading, bank, 'YXZ');
      tempQuaternion.setFromEuler(tempEuler);
      root.compose(position, tempQuaternion, tempScale.setScalar(2.4));
      setPart(birdBody, index, 0, 0, 0, 0, 0, 0, 0.8, 0.7, 2.2);
      setPart(rightWing, index, 0.05, 0, 0, 0, 0, flap);
      setPart(leftWing, index, -0.05, 0, 0, 0, 0, Math.PI - flap);
    });
    [leftWing, rightWing, birdBody].forEach((mesh) => { mesh.instanceMatrix.needsUpdate = true; });
  }

  // ---------------------------------------------------------------------------------------
  // Sky people: glider pilots riding thermals, and winged sky folk
  // ---------------------------------------------------------------------------------------
  const flyers = [];
  const canvasColors = [0xe0b44e, 0xb8553f, 0xf0dcb4, 0x2f6f73, 0x7d4f86];
  const thermalCenters = [new THREE.Vector3(0, 420, 0), ...islands.filter((island) => island.landmark).map((island) => new THREE.Vector3(island.x, island.y + 70, island.z))];

  function buildPilot(prone) {
    const pilot = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 4, 8), lambert(pick(clothes)));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), lambert(pick(skins)));
    const scarf = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.6, 1, 6), lambert(pick(hats), { side: THREE.DoubleSide }));
    if (prone) { body.rotation.x = Math.PI / 2; head.position.set(0, 0.05, 0.95); scarf.position.set(0, 0.25, -0.1); scarf.rotation.x = Math.PI / 2; }
    else { head.position.y = 0.95; scarf.position.set(0, 0.6, -0.5); }
    pilot.add(body, head, scarf);
    pilot.userData.scarf = scarf;
    return pilot;
  }

  const gliderCount = low ? 3 : 7;
  for (let index = 0; index < gliderCount; index += 1) {
    const glider = new THREE.Group();
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 2.4); wingShape.lineTo(4.6, -0.9); wingShape.quadraticCurveTo(0, -0.2, -4.6, -0.9); wingShape.closePath();
    const wing = new THREE.Mesh(new THREE.ShapeGeometry(wingShape), lambert(pick(canvasColors), { side: THREE.DoubleSide }));
    wing.rotation.x = Math.PI / 2;
    wing.position.y = 1.6;
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.4), lambert(0xc79a48));
    keel.position.set(0, 1.55, 0.6);
    const strutLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 4), lambert(0x5a4636));
    strutLeft.position.set(-0.4, 0.8, 0.4); strutLeft.rotation.z = 0.35;
    const strutRight = strutLeft.clone(); strutRight.position.x = 0.4; strutRight.rotation.z = -0.35;
    const pilot = buildPilot(true);
    pilot.position.y = 0.1;
    glider.add(wing, keel, strutLeft, strutRight, pilot);
    glider.scale.setScalar(1.4);
    group.add(glider);
    const center = pick(thermalCenters).clone();
    flyers.push({
      kind: 'glider', object: glider, pilot, center, home: center.clone(), radius: range(60, 140), angle: range(0, TAU),
      speed: range(11, 15), climb: range(0.4, 1.2), altitude: range(-10, 40), direction: random() < 0.5 ? -1 : 1, roll: 0, phase: range(0, TAU),
    });
  }

  const foldCount = low ? 2 : 5;
  const featherColors = [0xf3ead8, 0xd9c49a, 0xb9cfd4, 0xe7c3b0];
  for (let index = 0; index < foldCount; index += 1) {
    const folk = new THREE.Group();
    const pilot = buildPilot(true);
    const wings = [-1, 1].map((sideSign) => {
      const pivot = new THREE.Group();
      pivot.position.set(sideSign * 0.25, 0.2, 0.3);
      const feathers = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.6, 4, 1), lambert(pick(featherColors), { flatShading: true }));
      feathers.rotation.z = -sideSign * Math.PI / 2;
      feathers.scale.set(0.22, 1, 1);
      feathers.position.x = sideSign * 1.8;
      pivot.add(feathers);
      folk.add(pivot);
      return { pivot, sideSign };
    });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 4, 16), glowMaterial);
    halo.position.set(0, 0.35, 1.0);
    folk.add(pilot, halo);
    folk.scale.setScalar(1.5);
    group.add(folk);
    const a = pick(thermalCenters);
    const b = pick(thermalCenters);
    flyers.push({ kind: 'folk', object: folk, pilot, wings, a: a.clone(), b: b.clone(), t: range(0, 1), speed: range(0.012, 0.02), phase: range(0, TAU), roll: 0, flapEnergy: 0 });
  }

  const flyerPosition = new THREE.Vector3();
  const flyerNext = new THREE.Vector3();
  function updateFlyers(delta, elapsed) {
    flyers.forEach((flyer) => {
      const object = flyer.object;
      if (flyer.kind === 'glider') {
        // Circling a drifting thermal: steady bank, slow climb, then glide out to a new one.
        flyer.angle += flyer.direction * (flyer.speed / flyer.radius) * delta;
        flyer.center.x += Math.sin(elapsed * 0.03 + flyer.phase) * delta * 3;
        flyer.center.z += Math.cos(elapsed * 0.025 + flyer.phase) * delta * 3;
        flyer.center.lerp(flyer.home, delta * 0.01);
        const altitude = flyer.altitude + Math.sin(elapsed * 0.05 * flyer.climb + flyer.phase) * 25;
        flyerPosition.set(Math.cos(flyer.angle) * flyer.radius, altitude, Math.sin(flyer.angle) * flyer.radius).add(flyer.center);
        const ahead = flyer.angle + flyer.direction * 0.05;
        flyerNext.set(Math.cos(ahead) * flyer.radius, altitude, Math.sin(ahead) * flyer.radius).add(flyer.center);
        const heading = Math.atan2(flyerNext.x - flyerPosition.x, flyerNext.z - flyerPosition.z);
        const targetRoll = -flyer.direction * Math.atan((flyer.speed * flyer.speed) / (9.8 * flyer.radius)) * 1.6;
        flyer.roll = damp(flyer.roll, targetRoll, 1.5, delta);
        object.position.copy(flyerPosition);
        object.rotation.set(Math.sin(elapsed * 0.7 + flyer.phase) * 0.04 - 0.05, heading, flyer.roll, 'YXZ');
        flyer.pilot.userData.scarf.rotation.z = Math.sin(elapsed * 6 + flyer.phase) * 0.4;
      } else {
        // Winged folk cruise between islands on a gentle arc, flapping to climb and gliding to descend.
        flyer.t += flyer.speed * delta;
        if (flyer.t >= 1) { flyer.t = 0; flyer.a.copy(flyer.b); flyer.b.copy(pick(thermalCenters)).add(new THREE.Vector3(range(-80, 80), range(0, 50), range(-80, 80))); }
        const t = THREE.MathUtils.smootherstep(flyer.t, 0, 1);
        const lift = Math.sin(flyer.t * Math.PI) * 60;
        flyerPosition.lerpVectors(flyer.a, flyer.b, t);
        flyerPosition.y += lift;
        flyerPosition.x += Math.sin(flyer.t * TAU * 2 + flyer.phase) * 25;
        const tAhead = Math.min(1, flyer.t + 0.01);
        flyerNext.lerpVectors(flyer.a, flyer.b, THREE.MathUtils.smootherstep(tAhead, 0, 1));
        flyerNext.y += Math.sin(tAhead * Math.PI) * 60;
        flyerNext.x += Math.sin(tAhead * TAU * 2 + flyer.phase) * 25;
        const direction = flyerNext.clone().sub(flyerPosition);
        if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
        const heading = Math.atan2(direction.x, direction.z);
        const climbing = direction.y > 0.02;
        flyer.flapEnergy = damp(flyer.flapEnergy, climbing ? 1 : 0.15, 1.2, delta);
        flyer.phase += delta * (2.2 + flyer.flapEnergy * 2.4);
        const flap = Math.sin(flyer.phase) * (0.15 + flyer.flapEnergy * 0.65);
        flyer.wings.forEach(({ pivot, sideSign }) => { pivot.rotation.z = sideSign * flap; pivot.rotation.y = -sideSign * 0.15; });
        const previousHeading = object.rotation.y;
        flyer.roll = damp(flyer.roll, THREE.MathUtils.clamp(-wrapAngle(heading - previousHeading) * 30, -0.6, 0.6), 2, delta);
        object.position.copy(flyerPosition).add(new THREE.Vector3(0, -Math.cos(flyer.phase) * flyer.flapEnergy * 0.3, 0));
        object.rotation.set(-Math.atan2(direction.y, Math.hypot(direction.x, direction.z)), heading, flyer.roll, 'YXZ');
      }
    });
  }

  // ---------------------------------------------------------------------------------------
  // Manta rays: slow glides with rippling wing beats
  // ---------------------------------------------------------------------------------------
  const mantas = [];
  const mantaCount = low ? 3 : 6;
  for (let index = 0; index < mantaCount; index += 1) {
    const manta = new THREE.Group();
    const bodyColor = index % 2 ? 0x4f7584 : 0x6f879b;
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), lambert(bodyColor, { flatShading: true }));
    body.scale.set(2.4, 0.7, 3.4);
    const wings = [-1, 1].map((sideSign) => {
      const pivot = new THREE.Group();
      pivot.position.x = sideSign * 1.8;
      const shape = new THREE.Shape();
      shape.moveTo(0, 2.2); shape.quadraticCurveTo(sideSign * 4, 1.2, sideSign * 7.5, -1.4); shape.quadraticCurveTo(sideSign * 3, -1.2, 0, -2.6); shape.closePath();
      const wing = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), lambert(bodyColor, { side: THREE.DoubleSide }));
      wing.rotation.x = Math.PI / 2;
      pivot.add(wing);
      manta.add(pivot);
      return { pivot, sideSign };
    });
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.02, 7, 4), lambert(0x34505c));
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -6.2;
    manta.add(body, tail);
    const scale = range(1.4, 2.6);
    manta.scale.setScalar(scale);
    group.add(manta);
    mantas.push({ object: manta, wings, tail, center: new THREE.Vector3(range(-1500, 1500), range(420, 820), range(-1500, 1500)), radius: range(140, 320), angle: range(0, TAU), speed: range(7, 11), phase: range(0, TAU), direction: random() < 0.5 ? -1 : 1 });
  }

  function updateMantas(delta, elapsed) {
    mantas.forEach((manta) => {
      manta.angle += manta.direction * (manta.speed / manta.radius) * delta;
      manta.phase += delta * 1.1;
      const position = new THREE.Vector3(Math.cos(manta.angle) * manta.radius, Math.sin(elapsed * 0.08 + manta.phase) * 30, Math.sin(manta.angle) * manta.radius).add(manta.center);
      const heading = Math.atan2(-Math.sin(manta.angle) * manta.direction, Math.cos(manta.angle) * manta.direction);
      const beat = Math.sin(manta.phase);
      manta.wings.forEach(({ pivot, sideSign }) => { pivot.rotation.z = sideSign * beat * 0.45; });
      manta.tail.rotation.y = Math.sin(manta.phase * 0.7) * 0.2;
      manta.object.position.copy(position).add(new THREE.Vector3(0, -beat * 0.8, 0));
      manta.object.rotation.set(Math.cos(manta.phase) * 0.06, heading, -manta.direction * 0.18, 'YXZ');
    });
  }

  // ---------------------------------------------------------------------------------------
  // Sky whales: a chain of body segments follows the route, each segment trailing the one in
  // front, with a travelling vertical wave, stroking pectoral fins and a lagging tail fluke.
  // ---------------------------------------------------------------------------------------
  const whales = [];
  const whaleProfile = [0.62, 0.86, 1, 1, 0.94, 0.82, 0.66, 0.5, 0.36, 0.24];

  function whaleGeometry(back, belly) {
    const geometry = new THREE.SphereGeometry(1, 18, 12);
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const top = new THREE.Color(back);
    const under = new THREE.Color(belly);
    const mixed = new THREE.Color();
    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index);
      const grooves = y < -0.2 ? 0.92 + 0.08 * Math.sin(positions.getX(index) * 40) : 1;
      mixed.copy(under).lerp(top, THREE.MathUtils.smoothstep(y, -0.35, 0.25)).multiplyScalar(grooves);
      colors.set([mixed.r, mixed.g, mixed.b], index * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  function createWhale(curve, options) {
    const { scale, speed, offset = 0, back = 0x35586b, belly = 0xe9e1d0 } = options;
    const length = 64 * scale;
    const spacing = length / whaleProfile.length;
    const geometry = whaleGeometry(back, belly);
    const skin = new THREE.MeshLambertMaterial({ vertexColors: true });
    const finMaterial = new THREE.MeshLambertMaterial({ color: back });
    const segments = whaleProfile.map((profile, index) => {
      const segmentGroup = new THREE.Group();
      const radius = 7.2 * scale * profile;
      const body = new THREE.Mesh(geometry, skin);
      body.scale.set(radius, radius * 0.86, spacing * (index === 0 ? 1.25 : 1.15));
      body.castShadow = shadows;
      segmentGroup.add(body);
      group.add(segmentGroup);
      return { group: segmentGroup, radius };
    });
    const head = segments[0];
    [-1, 1].forEach((sideSign) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.45 * scale, 8, 6), lambert(0x1c2328));
      eye.position.set(sideSign * head.radius * 0.82, -head.radius * 0.1, spacing * 0.3);
      head.group.add(eye);
    });
    const fins = [-1, 1].map((sideSign) => {
      const pivot = new THREE.Group();
      pivot.position.set(sideSign * segments[2].radius * 0.85, -segments[2].radius * 0.35, 0);
      const fin = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), finMaterial);
      fin.scale.set(9 * scale, 0.7 * scale, 2.6 * scale);
      fin.position.x = sideSign * 8 * scale;
      fin.rotation.y = sideSign * 0.35;
      pivot.add(fin);
      segments[2].group.add(pivot);
      return { pivot, sideSign };
    });
    const flukePivot = new THREE.Group();
    flukePivot.position.z = -spacing * 0.6;
    [-1, 1].forEach((sideSign) => {
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), finMaterial);
      lobe.scale.set(6 * scale, 0.55 * scale, 2.8 * scale);
      lobe.position.set(sideSign * 5 * scale, 0, -1.8 * scale);
      lobe.rotation.y = -sideSign * 0.45;
      flukePivot.add(lobe);
    });
    segments[segments.length - 1].group.add(flukePivot);
    // Faint bioluminescent spots along the back that glow after dusk.

    segments.slice(1, 8).forEach((segment, index) => {
      [-1, 1].forEach((sideSign) => {
        const spot = new THREE.Mesh(new THREE.SphereGeometry(0.55 * scale, 6, 4), glowMaterial);
        spot.position.set(sideSign * segment.radius * 0.45, segment.radius * 0.8, (index % 2) * spacing * 0.2);
        segment.group.add(spot);
      });
    });
    const curveLength = curve.getLength();
    const whale = { curve, curveLength, segments, fins, flukePivot, spacing, distance: offset * curveLength, speed, scale, phase: random() * TAU, positions: segments.map(() => new THREE.Vector3()) };
    whales.push(whale);
    return whale;
  }

  whaleRoutes.forEach((route, routeIndex) => {
    const curve = whaleCurves[routeIndex];
    if (route.name === 'junction-pod') {
      const podSize = low ? 2 : 3;
      for (let index = 0; index < podSize; index += 1) createWhale(curve, { scale: route.scale * range(0.85, 1.1), speed: route.speed, offset: index * 0.012, back: index % 2 ? 0x41657a : 0x4c6f86 });
    } else {
      createWhale(curve, { scale: route.scale, speed: route.speed, offset: routeIndex * 0.31, back: routeIndex ? 0x2f5163 : 0x3a5f73 });
      if (route.calf) createWhale(curve, { scale: route.scale * 0.42, speed: route.speed, offset: routeIndex * 0.31 - 0.006, back: 0x557b8f });
    }
  });

  const segmentTarget = new THREE.Vector3();
  const lookMatrix = new THREE.Matrix4();
  function updateWhales(delta, elapsed) {
    const night = getNight();
    glowMaterial.opacity = 0.15 + night * 0.75;
    whales.forEach((whale) => {
      whale.distance = (whale.distance + whale.speed * delta) % whale.curveLength;
      const time = elapsed * 0.55 + whale.phase;
      whale.segments.forEach((segment, index) => {
        const u = (((whale.distance - index * whale.spacing) / whale.curveLength) % 1 + 1) % 1;
        const point = whale.curve.getPointAt(u);
        // Travelling wave: small at the head, growing toward the tail, like a swimming whale.
        const wave = Math.sin(time - index * 0.55) * 2.2 * whale.scale * Math.pow(index / whale.segments.length, 1.4);
        point.y += wave;
        whale.positions[index].copy(point);
      });
      whale.segments.forEach((segment, index) => {
        const position = whale.positions[index];
        // Each segment looks toward the one in front, so the body bends smoothly along the path.
        if (index === 0) {
          const u = (((whale.distance + whale.spacing) / whale.curveLength) % 1 + 1) % 1;
          segmentTarget.copy(whale.curve.getPointAt(u));
          segmentTarget.y += Math.sin(time + 0.55) * 0.3;
        } else segmentTarget.copy(whale.positions[index - 1]);
        segment.group.position.copy(position);
        lookMatrix.lookAt(segmentTarget, position, UP);
        segment.group.quaternion.setFromRotationMatrix(lookMatrix);
      });
      whale.fins.forEach(({ pivot, sideSign }) => { pivot.rotation.z = sideSign * (0.15 + Math.sin(time * 0.8) * 0.3); pivot.rotation.y = Math.cos(time * 0.8) * 0.12 * sideSign; });
      whale.flukePivot.rotation.x = Math.cos(time - whale.segments.length * 0.55) * 0.45;
    });
  }

  return {
    update(delta, elapsed, cameraPosition, trainNear) {
      updatePeople(delta, elapsed, cameraPosition, trainNear);
      updateSheep(delta, elapsed, cameraPosition);
      updateBirds(delta, elapsed, cameraPosition);
      updateFlyers(delta, elapsed);
      updateMantas(delta, elapsed);
      updateWhales(delta, elapsed);
    },
    whales, people, sheep, flyers, mantas,
    counts: { people: people.length, sheep: sheep.length, birds: birds.length, flyers: flyers.length, mantas: mantas.length, whales: whales.length },
  };
}
