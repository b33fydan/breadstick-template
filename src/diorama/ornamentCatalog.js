import * as THREE from 'three';
import { MONITOR_BINDING } from './dioramaLive';

const M = (color, roughness = 0.5) =>
  new THREE.MeshStandardMaterial({ color, roughness });

function group(...children) {
  const g = new THREE.Group();
  children.forEach(c => { c.castShadow = true; c.receiveShadow = true; g.add(c); });
  return g;
}

function mesh(geo, mat, pos, rot) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  return m;
}

const builders = {
  microphone() {
    const body = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.18, 12), M('#444'), [0, 0.09, 0]);
    const head = mesh(new THREE.SphereGeometry(0.05, 16, 12), M('#888', 0.3), [0, 0.21, 0]);
    const base = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), M('#333'), [0, 0.01, 0]);
    return group(body, head, base);
  },

  camera() {
    const body = mesh(new THREE.BoxGeometry(0.14, 0.10, 0.08), M('#2a2a2a'), [0, 0.05, 0]);
    const lens = mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 12), M('#444', 0.2), [0, 0.05, 0.07], [Math.PI / 2, 0, 0]);
    const flash = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), M('#ddd'), [-0.04, 0.12, 0]);
    return group(body, lens, flash);
  },

  monitor() {
    const screen = mesh(new THREE.BoxGeometry(0.22, 0.15, 0.01), M('#111'), [0, 0.16, 0]);
    const bezel = mesh(new THREE.BoxGeometry(0.24, 0.17, 0.012), M('#333'), [0, 0.16, -0.002]);
    const stand = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8), M('#555'), [0, 0.04, 0]);
    const base = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 16), M('#444'), [0, 0.007, 0]);
    const glow = mesh(new THREE.PlaneGeometry(0.20, 0.13), M('#1a3a5a', 0.1), [0, 0.16, 0.006]);
    glow.userData.stateSurface = true;
    return group(bezel, screen, glow, stand, base);
  },

  palette() {
    const disc = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.015, 24), M('#e8dcc8', 0.8), [0, 0.007, 0]);
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6'];
    colors.forEach((c, i) => {
      const dot = mesh(new THREE.SphereGeometry(0.012, 8, 8), M(c, 0.4),
        [Math.cos(i * 1.2 + 0.3) * 0.05, 0.02, Math.sin(i * 1.2 + 0.3) * 0.05]);
      disc.add(dot);
    });
    return group(disc);
  },

  megaphone() {
    const cone = mesh(new THREE.ConeGeometry(0.07, 0.16, 12), M('#e67e22'), [0, 0.08, 0], [0, 0, -Math.PI * 0.15]);
    const handle = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8), M('#555'), [0.06, -0.02, 0], [0, 0, Math.PI * 0.35]);
    return group(cone, handle);
  },

  robot() {
    const body = mesh(new THREE.BoxGeometry(0.10, 0.12, 0.08), M('#6699cc'), [0, 0.06, 0]);
    const head = mesh(new THREE.BoxGeometry(0.08, 0.07, 0.07), M('#88bbdd'), [0, 0.155, 0]);
    const eye1 = mesh(new THREE.SphereGeometry(0.012, 8, 8), M('#ff4444'), [-0.02, 0.16, 0.035]);
    const eye2 = mesh(new THREE.SphereGeometry(0.012, 8, 8), M('#ff4444'), [0.02, 0.16, 0.035]);
    const antenna = mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 6), M('#aaa'), [0, 0.21, 0]);
    const tip = mesh(new THREE.SphereGeometry(0.01, 8, 8), M('#ffcc00'), [0, 0.24, 0]);
    return group(body, head, eye1, eye2, antenna, tip);
  },

  telescope() {
    const tube = mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.20, 12), M('#8b6914', 0.4), [0, 0.14, 0], [0, 0, Math.PI * 0.2]);
    const tripod1 = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6), M('#555'), [0.04, 0.06, 0], [0, 0, Math.PI * 0.15]);
    const tripod2 = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6), M('#555'), [-0.02, 0.06, 0.03], [0, 0, -Math.PI * 0.15]);
    const tripod3 = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6), M('#555'), [-0.02, 0.06, -0.03], [0, 0, -Math.PI * 0.15]);
    return group(tube, tripod1, tripod2, tripod3);
  },

  plant() {
    const pot = mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.06, 12), M('#c96b3c'), [0, 0.03, 0]);
    const dirt = mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.01, 12), M('#4a3520'), [0, 0.06, 0]);
    const foliage = mesh(new THREE.SphereGeometry(0.07, 12, 10), M('#2d8a4e', 0.8), [0, 0.13, 0]);
    return group(pot, dirt, foliage);
  },

  coffee() {
    const body = mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.06, 16), M('#f5f0e8', 0.3), [0, 0.03, 0]);
    const liquid = mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.005, 16), M('#3c1a0a'), [0, 0.058, 0]);
    const handle = mesh(new THREE.TorusGeometry(0.02, 0.005, 8, 12, Math.PI), M('#f5f0e8', 0.3), [0.05, 0.03, 0], [0, 0, -Math.PI / 2]);
    return group(body, liquid, handle);
  },

  books() {
    const g = new THREE.Group();
    const colors = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad'];
    colors.forEach((c, i) => {
      const book = mesh(new THREE.BoxGeometry(0.06, 0.09 - i * 0.005, 0.04), M(c, 0.7), [i * 0.02 - 0.03, (0.09 - i * 0.005) / 2, 0]);
      book.rotation.z = (i - 1.5) * 0.04;
      book.castShadow = true;
      book.receiveShadow = true;
      g.add(book);
    });
    return g;
  },

  globe() {
    const sphere = mesh(new THREE.SphereGeometry(0.06, 20, 16), M('#5b9bd5', 0.6), [0, 0.12, 0]);
    const land1 = mesh(new THREE.SphereGeometry(0.061, 8, 6, 0.5, 1.0, 0.5, 0.8), M('#6ab04c', 0.7), [0, 0.12, 0]);
    const stand = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8), M('#b8860b', 0.3), [0, 0.03, 0]);
    const base = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 16), M('#b8860b', 0.3), [0, 0.005, 0]);
    const ring = mesh(new THREE.TorusGeometry(0.065, 0.003, 8, 32), M('#d4a746', 0.2), [0, 0.12, 0], [Math.PI * 0.15, 0, 0]);
    return group(sphere, land1, stand, base, ring);
  },

  lamp() {
    const shade = mesh(new THREE.ConeGeometry(0.07, 0.09, 16, 1, true), M('#f5deb3', 0.8), [0, 0.18, 0]);
    const neck = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.10, 8), M('#b8860b', 0.3), [0, 0.09, 0]);
    const base = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 16), M('#b8860b', 0.3), [0, 0.01, 0]);
    return group(shade, neck, base);
  },

  headphones() {
    const band = mesh(new THREE.TorusGeometry(0.06, 0.006, 8, 24, Math.PI), M('#333'), [0, 0.10, 0]);
    const earL = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), M('#222'), [-0.06, 0.04, 0], [0, 0, Math.PI / 2]);
    const earR = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), M('#222'), [0.06, 0.04, 0], [0, 0, Math.PI / 2]);
    const padL = mesh(new THREE.TorusGeometry(0.025, 0.008, 8, 12), M('#444'), [-0.06, 0.04, 0], [0, Math.PI / 2, 0]);
    const padR = mesh(new THREE.TorusGeometry(0.025, 0.008, 8, 12), M('#444'), [0.06, 0.04, 0], [0, Math.PI / 2, 0]);
    return group(band, earL, earR, padL, padR);
  },

  trophy() {
    const base = mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.03, 16), M('#2c2c2c', 0.3), [0, 0.015, 0]);
    const pillar = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8), M('#d4a746', 0.2), [0, 0.07, 0]);
    const cup = mesh(new THREE.CylinderGeometry(0.04, 0.02, 0.05, 16), M('#ffd700', 0.15), [0, 0.135, 0]);
    const star = mesh(new THREE.OctahedronGeometry(0.02, 0), M('#ffd700', 0.15), [0, 0.175, 0]);
    return group(base, pillar, cup, star);
  },

  clapperboard() {
    const board = mesh(new THREE.BoxGeometry(0.14, 0.10, 0.01), M('#222'), [0, 0.05, 0]);
    const clap = mesh(new THREE.BoxGeometry(0.14, 0.025, 0.01), M('#222'), [0, 0.112, 0], [0.15, 0, 0]);
    const stripes = [0.03, 0.07, 0.11].map(x =>
      mesh(new THREE.BoxGeometry(0.025, 0.025, 0.012), M('#fff'), [x - 0.07, 0.112, 0], [0.15, 0, 0])
    );
    return group(board, clap, ...stripes);
  },

  gear() {
    const ring = mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 6), M('#ffd700', 0.2), [0, 0.06, 0]);
    const center = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.015, 16), M('#ffd700', 0.2), [0, 0.06, 0]);
    const base = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.02, 12), M('#333', 0.3), [0, 0.01, 0]);
    const pole = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 6), M('#888'), [0, 0.03, 0]);
    return group(ring, center, base, pole);
  },
};

export const ORNAMENTS = [
  { id: 'microphone', name: 'Microphone', category: 'tools', emoji: '🎙️', desc: 'ElevenLabs voice', build: builders.microphone },
  { id: 'camera', name: 'Camera', category: 'tools', emoji: '📷', desc: 'Kling / video gen', build: builders.camera },
  { id: 'monitor', name: 'Monitor', category: 'tools', emoji: '🖥️', desc: 'Editing station', build: builders.monitor, binding: MONITOR_BINDING },
  { id: 'palette', name: 'Palette', category: 'tools', emoji: '🎨', desc: '16-GAMI art', build: builders.palette },
  { id: 'megaphone', name: 'Megaphone', category: 'tools', emoji: '📢', desc: 'Content posting', build: builders.megaphone },
  { id: 'robot', name: 'Robot', category: 'tools', emoji: '🤖', desc: 'AI agents', build: builders.robot },
  { id: 'telescope', name: 'Telescope', category: 'tools', emoji: '🔭', desc: 'Niche research', build: builders.telescope },

  { id: 'plant', name: 'Plant', category: 'decor', emoji: '🪴', desc: 'A happy little plant', build: builders.plant },
  { id: 'coffee', name: 'Coffee Mug', category: 'decor', emoji: '☕', desc: 'Fuel for the grind', build: builders.coffee },
  { id: 'books', name: 'Book Stack', category: 'decor', emoji: '📚', desc: 'Knowledge shelf', build: builders.books },
  { id: 'globe', name: 'Globe', category: 'decor', emoji: '🌍', desc: 'World reach', build: builders.globe },
  { id: 'lamp', name: 'Desk Lamp', category: 'decor', emoji: '💡', desc: 'Warm glow', build: builders.lamp },
  { id: 'headphones', name: 'Headphones', category: 'decor', emoji: '🎧', desc: 'In the zone', build: builders.headphones },

  { id: 'trophy', name: 'Trophy', category: 'awards', emoji: '🏆', desc: 'First Script generated', build: builders.trophy },
  { id: 'clapperboard', name: 'Clapperboard', category: 'awards', emoji: '🎬', desc: 'First Video shipped', build: builders.clapperboard },
  { id: 'gear', name: 'Gold Gear', category: 'awards', emoji: '⚙️', desc: 'Pipeline Master', build: builders.gear },
];

const ORNAMENT_SCALE = 2.5;

export function buildOrnament(id) {
  const entry = ORNAMENTS.find(o => o.id === id);
  if (!entry) return null;
  const g = entry.build();
  g.scale.setScalar(ORNAMENT_SCALE);
  g.userData.ornamentId = id;
  return g;
}
