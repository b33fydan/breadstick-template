import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createScene(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8ddd0');
  scene.fog = new THREE.Fog('#e8ddd0', 18, 28);

  const camera = new THREE.PerspectiveCamera(
    35,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    100
  );
  camera.position.set(1, 5, 9);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const ambient = new THREE.AmbientLight('#fff5e6', 0.5);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight('#fff5e6', 0.9);
  sun.position.set(-5, 8, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 20;
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.bias = -0.001;
  scene.add(sun);

  const hemi = new THREE.HemisphereLight('#ffecd2', '#c8b8d8', 0.35);
  scene.add(hemi);

  const deskLamp = new THREE.PointLight('#ffcc66', 0.5, 5);
  deskLamp.position.set(1.5, 1.6, -1.0);
  scene.add(deskLamp);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 4;
  controls.maxDistance = 14;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minAzimuthAngle = -Math.PI * 0.35;
  controls.maxAzimuthAngle = Math.PI * 0.35;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.3;
  controls.update();

  let idleTimer = null;
  const resetIdle = () => {
    controls.autoRotate = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { controls.autoRotate = true; }, 30000);
  };
  canvas.addEventListener('pointerdown', resetIdle);
  canvas.addEventListener('pointermove', resetIdle);
  resetIdle();

  const handleResize = () => {
    const w = canvas.parentElement.clientWidth;
    const h = canvas.parentElement.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', handleResize);

  const dispose = () => {
    window.removeEventListener('resize', handleResize);
    canvas.removeEventListener('pointerdown', resetIdle);
    canvas.removeEventListener('pointermove', resetIdle);
    clearTimeout(idleTimer);
    controls.dispose();
    renderer.dispose();
  };

  return { scene, camera, renderer, controls, dispose, handleResize };
}
