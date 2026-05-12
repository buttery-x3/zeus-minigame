import * as THREE from "three";
import { WORLD_SIZE } from "../../config";
import { mustQuery } from "../../lib/dom";

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

    const keyLight = new THREE.DirectionalLight(0xfff0c8, 2.2);
    keyLight.position.set(-22, 38, 18);
    keyLight.castShadow = true;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 90;
    keyLight.shadow.camera.left = -42;
    keyLight.shadow.camera.right = 42;
    keyLight.shadow.camera.top = 42;
    keyLight.shadow.camera.bottom = -42;
    keyLight.shadow.mapSize.set(2048, 2048);
    this.scene.add(keyLight);
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
