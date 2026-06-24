import * as THREE from 'three';
import { buildOrnament } from './ornamentCatalog';

export class OrnamentSystem {
  constructor(scene, zones, camera, renderer) {
    this.scene = scene;
    this.zones = zones;
    this.camera = camera;
    this.renderer = renderer;
    this.canvas = renderer.domElement;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.activeOrnamentId = null;
    this.ghost = null;
    this.ghostValid = false;
    this.placed = [];
    this.placedGroup = new THREE.Group();
    this.scene.add(this.placedGroup);

    this.selectedMesh = null;
    this.animations = [];

    this._onMove = this._onPointerMove.bind(this);
    this._onClick = this._onPointerClick.bind(this);
    this._onContext = this._onContextMenu.bind(this);
    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerdown', this._onClick);
    this.canvas.addEventListener('contextmenu', this._onContext);
  }

  setActiveOrnament(id) {
    this._clearGhost();
    this.activeOrnamentId = id;
    if (id) {
      this.ghost = buildOrnament(id);
      if (this.ghost) {
        this.ghost.traverse(c => {
          if (c.isMesh) {
            c.material = c.material.clone();
            c.material.transparent = true;
            c.material.opacity = 0.5;
            c.material.depthWrite = false;
          }
        });
        this.ghost.visible = false;
        this.scene.add(this.ghost);
      }
    }
  }

  _clearGhost() {
    if (this.ghost) {
      this.ghost.traverse(c => {
        if (c.isMesh) {
          c.geometry?.dispose();
          c.material?.dispose();
        }
      });
      this.scene.remove(this.ghost);
      this.ghost = null;
    }
    this.ghostValid = false;
  }

  _updateMouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onPointerMove(e) {
    this._updateMouse(e);

    if (this.ghost && this.activeOrnamentId) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const zoneMeshes = this.zones.map(z => z.mesh);
      const hits = this.raycaster.intersectObjects(zoneMeshes);

      if (hits.length > 0) {
        const hit = hits[0];
        this.ghost.position.copy(hit.point);
        this.ghost.visible = true;
        this.ghostValid = true;
        this._currentZone = hit.object.userData.zone;
      } else {
        this.ghost.visible = false;
        this.ghostValid = false;
        this._currentZone = null;
      }
    }
  }

  _onPointerClick(e) {
    if (e.button !== 0) return;
    this._updateMouse(e);

    if (this.ghost && this.ghostValid && this.activeOrnamentId) {
      const ornament = buildOrnament(this.activeOrnamentId);
      if (!ornament) return;

      ornament.position.copy(this.ghost.position);
      ornament.userData.zone = this._currentZone;
      ornament.userData.ornamentId = this.activeOrnamentId;
      ornament.userData.placedId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

      this.placedGroup.add(ornament);
      this.placed.push(ornament);

      this._animateBounce(ornament);
      this._onChange?.();
      return;
    }

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = [];
    this.placedGroup.traverse(c => { if (c.isMesh) meshes.push(c); });
    const hits = this.raycaster.intersectObjects(meshes);

    if (hits.length > 0) {
      let target = hits[0].object;
      while (target.parent && target.parent !== this.placedGroup) target = target.parent;
      this._selectPlaced(target);
    } else {
      this._selectPlaced(null);
    }
  }

  _onContextMenu(e) {
    e.preventDefault();
    this._updateMouse(e);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes = [];
    this.placedGroup.traverse(c => { if (c.isMesh) meshes.push(c); });
    const hits = this.raycaster.intersectObjects(meshes);

    if (hits.length > 0) {
      let target = hits[0].object;
      while (target.parent && target.parent !== this.placedGroup) target = target.parent;
      this._removePlaced(target);
    }
  }

  _selectPlaced(obj) {
    if (this.selectedMesh) {
      this.selectedMesh.traverse(c => {
        if (c.isMesh) {
          const restore = c.userData.baseEmissive ?? c.userData._origEmissive;
          if (restore !== undefined) c.material.emissive.setHex(restore);
          if (c.userData.baseIntensity !== undefined) c.material.emissiveIntensity = c.userData.baseIntensity;
        }
      });
    }
    this.selectedMesh = obj;
    if (obj) {
      obj.traverse(c => {
        if (c.isMesh) {
          c.userData._origEmissive = c.material.emissive.getHex();
          c.material.emissive.setHex(0x443300);
        }
      });
      this._onSelect?.(obj.userData.ornamentId, obj.userData.placedId);
    } else {
      this._onSelect?.(null, null);
    }
  }

  _removePlaced(obj) {
    this._stopPulse(obj.userData.placedId);
    this.placedGroup.remove(obj);
    this.placed = this.placed.filter(p => p !== obj);
    obj.traverse(c => {
      if (c.isMesh) {
        c.geometry?.dispose();
        c.material?.dispose();
      }
    });
    if (this.selectedMesh === obj) this._selectPlaced(null);
    this._onChange?.();
  }

  _animateBounce(obj) {
    const startY = obj.position.y;
    const startTime = performance.now();
    const duration = 400;

    this.animations.push({
      update(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const bounce = Math.sin(t * Math.PI) * 0.08 * (1 - t);
        const scaleT = t < 0.3 ? 0.7 + 0.45 * (t / 0.3) : 1.15 - 0.15 * ((t - 0.3) / 0.7);
        obj.position.y = startY + bounce;
        obj.scale.setScalar(scaleT);
        return t >= 1;
      },
    });
  }

  update(now) {
    this.animations = this.animations.filter(a => !a.update(now));
  }

  getState() {
    return this.placed.map(p => ({
      id: p.userData.ornamentId,
      placedId: p.userData.placedId,
      position: p.position.toArray(),
      rotation: [p.rotation.x, p.rotation.y, p.rotation.z],
      zone: p.userData.zone,
    }));
  }

  loadState(items) {
    while (this.placed.length) this._removePlaced(this.placed[0]);
    items.forEach(item => {
      const ornament = buildOrnament(item.id);
      if (!ornament) return;
      ornament.position.fromArray(item.position);
      if (item.rotation) ornament.rotation.set(...item.rotation);
      ornament.userData.zone = item.zone;
      ornament.userData.ornamentId = item.id;
      ornament.userData.placedId = item.placedId || Date.now().toString(36);
      this.placedGroup.add(ornament);
      this.placed.push(ornament);
    });
    this._onChange?.();
  }

  // ── live state (ornament contract) ──
  // Apply a declarative descriptor { emissive, emissiveIntensity, pulse } to a
  // placed ornament's state-surface mesh(es) (userData.stateSurface), or all
  // meshes if none is tagged. Writes the ornament's *base* emissive so the
  // selection highlight can layer on top and restore to it on deselect.
  setOrnamentState(placedId, descriptor) {
    const group = this.placed.find((p) => p.userData.placedId === placedId);
    if (!group) return;

    const targets = [];
    group.traverse((c) => { if (c.isMesh && c.userData.stateSurface) targets.push(c); });
    if (targets.length === 0) group.traverse((c) => { if (c.isMesh) targets.push(c); });

    const colorHex = new THREE.Color(descriptor.emissive).getHex();

    // Stop any running pulse first so the static apply below is the final word.
    this._stopPulse(placedId);

    for (const m of targets) {
      m.userData.baseEmissive = colorHex;
      m.userData.baseIntensity = descriptor.emissiveIntensity;
      if (this.selectedMesh !== group) { // don't fight the selection highlight
        m.material.emissive.setHex(colorHex);
        m.material.emissiveIntensity = descriptor.emissiveIntensity;
      }
    }

    if (descriptor.pulse && this.selectedMesh !== group) {
      this._startPulse(placedId, targets, descriptor.emissiveIntensity);
    }
  }

  _startPulse(placedId, meshes, base) {
    if (!this._pulses) this._pulses = new Map();
    const pulse = {
      _stop: false,
      update(now) {
        if (this._stop) return true;
        const k = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(now / 400));
        meshes.forEach((m) => { m.material.emissiveIntensity = base * k; });
        return false;
      },
    };
    this._pulses.set(placedId, pulse);
    this.animations.push(pulse);
  }

  _stopPulse(placedId) {
    if (!this._pulses) return;
    const pulse = this._pulses.get(placedId);
    if (pulse) {
      pulse._stop = true;
      this.animations = this.animations.filter((a) => a !== pulse);
      this._pulses.delete(placedId);
    }
  }

  onChange(fn) { this._onChange = fn; }
  onSelect(fn) { this._onSelect = fn; }

  dispose() {
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerdown', this._onClick);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    this._clearGhost();
    while (this.placed.length) this._removePlaced(this.placed[0]);
    this.scene.remove(this.placedGroup);
  }
}
