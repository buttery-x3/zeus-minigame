import * as THREE from "three";
import { clamp } from "../lib/math";
import type { EffectState } from "../types";
import { disposeObject3D } from "./dispose";
import { createLine, createRing, jaggedLine, setLineOpacity } from "./primitives";

export class GameEffects {
  private effects: EffectState[] = [];

  constructor(private readonly group: THREE.Group) {}

  update(dt: number) {
    this.effects = this.effects.filter((effect) => {
      effect.ttl -= dt;
      const lifeRatio = clamp(effect.ttl / effect.maxTtl, 0, 1);
      effect.update?.(lifeRatio);

      if (effect.ttl <= 0) {
        disposeObject3D(effect.object);
        effect.object.removeFromParent();
        return false;
      }

      return true;
    });
  }

  createLightningArc(start: THREE.Vector3, end: THREE.Vector3, color: THREE.ColorRepresentation) {
    const arc = new THREE.Group();
    const points = jaggedLine(start, end, 11, 0.8);
    const glow = createLine(points, 0xffffff, 0.32);
    glow.scale.setScalar(1.015);
    const core = createLine(points, color, 1);
    arc.add(glow, core);
    this.group.add(arc);
    this.effects.push({
      object: arc,
      ttl: 0.2,
      maxTtl: 0.2,
      update: (lifeRatio) => {
        setLineOpacity(glow, lifeRatio * 0.32);
        setLineOpacity(core, lifeRatio);
      },
    });
  }

  createVerticalBolt(position: THREE.Vector3) {
    const bolt = new THREE.Group();
    const start = new THREE.Vector3(position.x - 1.7, 26, position.z - 1.2);
    const end = new THREE.Vector3(position.x, 0.5, position.z);
    const points = jaggedLine(start, end, 14, 1.2);
    const glow = createLine(points, 0xffffff, 0.36);
    const core = createLine(points, 0xffe27a, 1);
    const light = new THREE.PointLight(0xffe27a, 34, 18);
    light.position.copy(new THREE.Vector3(position.x, 4, position.z));
    bolt.add(glow, core, light);
    this.group.add(bolt);
    this.effects.push({
      object: bolt,
      ttl: 0.26,
      maxTtl: 0.26,
      update: (lifeRatio) => {
        setLineOpacity(glow, lifeRatio * 0.36);
        setLineOpacity(core, lifeRatio);
        light.intensity = 34 * lifeRatio;
      },
    });
  }

  createShockwave(position: THREE.Vector3, color: THREE.ColorRepresentation, radius: number) {
    const ring = createRing(0.55, color, 0.84);
    ring.position.set(position.x, 0.19, position.z);
    this.group.add(ring);
    this.effects.push({
      object: ring,
      ttl: 0.32,
      maxTtl: 0.32,
      update: (lifeRatio) => {
        const growth = 1 + (1 - lifeRatio) * radius;
        ring.scale.set(growth, growth, growth);
        setLineOpacity(ring, lifeRatio * 0.84);
      },
    });
  }

  createEnergyAbsorption(start: THREE.Vector3, end: THREE.Vector3) {
    const energy = new THREE.Group();
    const points = jaggedLine(start.clone().setY(0.45), end.clone().setY(2.1), 10, 0.52);
    const glow = createLine(points, 0xf2c7ff, 0.42);
    const core = createLine(points, 0xc266f0, 0.94);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xe5a5ff, transparent: true, opacity: 0.86, depthWrite: false }),
    );
    orb.position.copy(start).setY(0.65);
    energy.add(glow, core, orb);
    this.group.add(energy);
    this.effects.push({
      object: energy,
      ttl: 0.52,
      maxTtl: 0.52,
      update: (lifeRatio) => {
        const travel = 1 - lifeRatio;
        orb.position.lerpVectors(start.clone().setY(0.65), end.clone().setY(2.1), travel);
        orb.scale.setScalar(0.7 + lifeRatio * 0.6);
        setLineOpacity(glow, lifeRatio * 0.42);
        setLineOpacity(core, lifeRatio * 0.94);
        const material = orb.material;
        if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = lifeRatio * 0.86;
        }
      },
    });
  }
}
