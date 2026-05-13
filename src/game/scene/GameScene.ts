import * as THREE from "three";
import { WORLD_SIZE } from "../../config";
import { mustQuery } from "../../lib/dom";
import { ShadowRig } from "../../render/ShadowRig";

type SceneObjects = {
  terrain: THREE.Group;
  blockers: THREE.Group;
  enemies: THREE.Group;
  effects: THREE.Group;
  targeting: THREE.Group;
  player: THREE.Group;
  moveMarker: THREE.Group;
};

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1400);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });

  private readonly container = mustQuery<HTMLElement>(document, "#game");
  private shadowRig: ShadowRig | null = null;

  mount(objects: SceneObjects) {
    this.setupRenderer();
    this.setupLighting();
    this.setupGround();
    this.scene.add(objects.terrain, objects.blockers, objects.enemies, objects.effects, objects.targeting, objects.moveMarker);
    this.scene.add(objects.player);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  updateLighting(focus: THREE.Vector3) {
    this.shadowRig?.update(focus);
  }

  getLightingDiagnostics() {
    return this.shadowRig?.diagnostics() ?? null;
  }

  dispose() {
    this.renderer.dispose();
  }

  private setupRenderer() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0c1110, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.append(this.renderer.domElement);
  }

  private setupLighting() {
    this.scene.fog = new THREE.Fog(0x0c1110, 70, 190);

    const hemi = new THREE.HemisphereLight(0xbedce4, 0x251a18, 1.8);
    this.scene.add(hemi);

    this.shadowRig = new ShadowRig(this.scene);
  }

  private setupGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x101819, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }
}
