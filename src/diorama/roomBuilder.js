import * as THREE from 'three';

const MAT = {
  floor: new THREE.MeshStandardMaterial({ color: '#b8860b', roughness: 0.7 }),
  wall: new THREE.MeshStandardMaterial({ color: '#f5e6d3', roughness: 0.85 }),
  wallSide: new THREE.MeshStandardMaterial({ color: '#eedcc8', roughness: 0.85 }),
  baseboard: new THREE.MeshStandardMaterial({ color: '#8b7355', roughness: 0.6 }),
  desk: new THREE.MeshStandardMaterial({ color: '#a0522d', roughness: 0.5 }),
  shelf: new THREE.MeshStandardMaterial({ color: '#8b6914', roughness: 0.55 }),
  rug: new THREE.MeshStandardMaterial({ color: '#8b3a3a', roughness: 0.95 }),
  platform: new THREE.MeshStandardMaterial({ color: '#4a7c3f', roughness: 0.9 }),
  platformEdge: new THREE.MeshStandardMaterial({ color: '#3d6634', roughness: 0.85 }),
  windowFrame: new THREE.MeshStandardMaterial({ color: '#f0ead6', roughness: 0.4 }),
  windowGlass: new THREE.MeshStandardMaterial({
    color: '#a8d8ea', roughness: 0.1, metalness: 0.1,
    transparent: true, opacity: 0.35,
  }),
};

const W = 5.5, H = 3.2, D = 4.0, WALL_T = 0.12;

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function buildFloor() {
  const f = box(W, WALL_T, D, MAT.floor);
  f.position.set(0, -WALL_T / 2, 0);
  f.receiveShadow = true;
  f.castShadow = false;
  return f;
}

function buildWalls() {
  const g = new THREE.Group();

  const back = box(W, H, WALL_T, MAT.wall);
  back.position.set(0, H / 2, -D / 2 + WALL_T / 2);
  g.add(back);

  const left = box(WALL_T, H, D, MAT.wallSide);
  left.position.set(-W / 2 + WALL_T / 2, H / 2, 0);
  g.add(left);

  const right = box(WALL_T, H, D, MAT.wallSide);
  right.position.set(W / 2 - WALL_T / 2, H / 2, 0);
  g.add(right);

  const bbH = 0.08;
  [
    [0, bbH / 2, -D / 2 + WALL_T + bbH / 2, W - WALL_T * 2, bbH, bbH],
    [-W / 2 + WALL_T + bbH / 2, bbH / 2, 0, bbH, bbH, D - WALL_T],
    [W / 2 - WALL_T - bbH / 2, bbH / 2, 0, bbH, bbH, D - WALL_T],
  ].forEach(([x, y, z, bw, bh, bd]) => {
    const bb = box(bw, bh, bd, MAT.baseboard);
    bb.position.set(x, y, z);
    g.add(bb);
  });

  g.children.forEach(c => { c.castShadow = true; c.receiveShadow = true; });
  return g;
}

function buildDesk() {
  const g = new THREE.Group();
  const topW = 1.8, topD = 0.7, topH = 0.06, legH = 0.7;

  const top = box(topW, topH, topD, MAT.desk);
  top.position.set(0, legH + topH / 2, 0);
  g.add(top);

  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, legH, 8);
  const legMat = MAT.desk;
  const offsets = [
    [-topW / 2 + 0.08, 0, -topD / 2 + 0.08],
    [topW / 2 - 0.08, 0, -topD / 2 + 0.08],
    [-topW / 2 + 0.08, 0, topD / 2 - 0.08],
    [topW / 2 - 0.08, 0, topD / 2 - 0.08],
  ];
  offsets.forEach(([x, _, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, legH / 2, z);
    leg.castShadow = true;
    g.add(leg);
  });

  g.position.set(1.2, 0, -D / 2 + WALL_T + topD / 2 + 0.05);
  g.children.forEach(c => { c.castShadow = true; c.receiveShadow = true; });
  return g;
}

function buildBookshelf() {
  const g = new THREE.Group();
  const sw = 1.2, sd = 0.28, sh = 0.04, gap = 0.55;

  for (let i = 0; i < 4; i++) {
    const shelf = box(sw, sh, sd, MAT.shelf);
    shelf.position.set(0, i * gap + sh / 2, 0);
    g.add(shelf);
  }

  const sideGeo = new THREE.BoxGeometry(0.04, gap * 3 + sh, sd);
  [-sw / 2 + 0.02, sw / 2 - 0.02].forEach(x => {
    const side = new THREE.Mesh(sideGeo, MAT.shelf);
    side.position.set(x, (gap * 3 + sh) / 2, 0);
    side.castShadow = true;
    side.receiveShadow = true;
    g.add(side);
  });

  g.position.set(-1.6, 0, -D / 2 + WALL_T + sd / 2 + 0.05);
  return g;
}

function buildRug() {
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 32),
    MAT.rug
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.005, 0.4);
  rug.receiveShadow = true;
  return rug;
}

function buildPlatform() {
  const g = new THREE.Group();

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(4.2, 4.2, 0.15, 48),
    MAT.platform
  );
  top.position.set(0, -0.15, 0);
  top.receiveShadow = true;
  g.add(top);

  const edge = new THREE.Mesh(
    new THREE.CylinderGeometry(4.2, 4.0, 0.2, 48),
    MAT.platformEdge
  );
  edge.position.set(0, -0.32, 0);
  g.add(edge);

  return g;
}

function buildWindow() {
  const g = new THREE.Group();
  const ww = 1.0, wh = 1.2, frameT = 0.06;

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(ww - frameT * 2, wh - frameT * 2),
    MAT.windowGlass
  );
  g.add(glass);

  const frameParts = [
    [0, wh / 2 - frameT / 2, ww, frameT],
    [0, -wh / 2 + frameT / 2, ww, frameT],
    [-ww / 2 + frameT / 2, 0, frameT, wh],
    [ww / 2 - frameT / 2, 0, frameT, wh],
    [0, 0, frameT, wh - frameT * 2],
  ];
  frameParts.forEach(([x, y, fw, fh]) => {
    const f = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fh),
      MAT.windowFrame
    );
    f.position.set(x, y, 0.005);
    g.add(f);
  });

  g.rotation.y = Math.PI / 2;
  g.position.set(-W / 2 + WALL_T + 0.01, H * 0.5, -0.3);
  return g;
}

export function buildRoom() {
  const room = new THREE.Group();
  room.add(buildFloor());
  room.add(buildWalls());
  room.add(buildDesk());
  room.add(buildBookshelf());
  room.add(buildRug());
  room.add(buildPlatform());
  room.add(buildWindow());

  const zones = createZones();
  zones.forEach(z => room.add(z.mesh));

  return { room, zones };
}

function createZones() {
  const zoneMat = new THREE.MeshBasicMaterial({ visible: false });

  const makeZone = (name, w, d, pos, rotation) => {
    const geo = new THREE.PlaneGeometry(w, d);
    const mesh = new THREE.Mesh(geo, zoneMat);
    mesh.position.copy(pos);
    if (rotation) mesh.rotation.copy(rotation);
    else mesh.rotation.x = -Math.PI / 2;
    mesh.userData.zone = name;
    return { name, mesh };
  };

  return [
    makeZone('desk', 1.8, 0.7,
      new THREE.Vector3(1.2, 0.76 + 0.03, -D / 2 + WALL_T + 0.35 + 0.05)),
    makeZone('shelf-1', 1.2, 0.28,
      new THREE.Vector3(-1.6, 0.55 + 0.02, -D / 2 + WALL_T + 0.14 + 0.05)),
    makeZone('shelf-2', 1.2, 0.28,
      new THREE.Vector3(-1.6, 1.10 + 0.02, -D / 2 + WALL_T + 0.14 + 0.05)),
    makeZone('shelf-3', 1.2, 0.28,
      new THREE.Vector3(-1.6, 1.65 + 0.02, -D / 2 + WALL_T + 0.14 + 0.05)),
    makeZone('floor', W - 0.4, D - 0.4,
      new THREE.Vector3(0, 0.005, 0)),
    makeZone('wall', W - WALL_T * 2, H - 0.2,
      new THREE.Vector3(0, H / 2, -D / 2 + WALL_T + 0.02),
      new THREE.Euler(0, 0, 0)),
  ];
}
