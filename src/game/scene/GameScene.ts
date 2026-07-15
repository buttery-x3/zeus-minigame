import * as THREE from "three";
import { mustQuery } from "../../lib/dom";
import { ShadowRig } from "../../render/ShadowRig";
import type { RenderMode } from "../preferences/GamePreferences";

const GROUND_PLANE_SIZE = 900;
const POTATO_PIXEL_RATIO = 0.5;

type SceneObjects = {
  terrain: THREE.Group;
  blockers: THREE.Group;
  visibility: THREE.Object3D;
  enemies: THREE.Group;
  enemyHealthBars: THREE.Group;
  effects: THREE.Group;
  targeting: THREE.Group;
  player: THREE.Group;
  moveMarker: THREE.Group;
};

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1400);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });

  private readonly container = mustQuery<HTMLElement>(document, "#game");
  private readonly groundMaterials = {
    normal: new THREE.MeshStandardMaterial({ color: 0x101819, roughness: 1 }),
    potato: new THREE.MeshBasicMaterial({ color: 0x101819 }),
  };
  private renderMode: RenderMode;
  private ground: THREE.Mesh | null = null;
  private hemisphereLight: THREE.HemisphereLight | null = null;
  private shadowRig: ShadowRig | null = null;

  constructor(renderMode: RenderMode) {
    this.renderMode = renderMode;
  }

  mount(objects: SceneObjects) {
    this.setupRenderer();
    this.setupLighting();
    this.setupGround();
    this.scene.add(
      objects.terrain,
      objects.blockers,
      objects.visibility,
      objects.enemies,
      objects.enemyHealthBars,
      objects.effects,
      objects.targeting,
      objects.moveMarker,
    );
    this.scene.add(objects.player);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  setRenderMode(renderMode: RenderMode) {
    if (this.renderMode === renderMode) {
      return;
    }

    this.renderMode = renderMode;
    this.applyRenderMode();
  }

  updateLighting(focus: THREE.Vector3) {
    if (this.ground) {
      this.ground.position.x = focus.x;
      this.ground.position.z = focus.z;
    }
    this.shadowRig?.update(focus);
  }

  getLightingDiagnostics() {
    return this.shadowRig?.diagnostics() ?? null;
  }

  getRenderDiagnostics() {
    return {
      mode: this.renderMode,
      pixelRatio: this.renderer.getPixelRatio(),
      shadowsEnabled: this.renderer.shadowMap.enabled,
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      points: this.renderer.info.render.points,
      lines: this.renderer.info.render.lines,
    };
  }

  dispose() {
    this.renderer.dispose();
  }

  private setupRenderer() {
    this.renderer.setClearColor(0x0c1110, 1);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.append(this.renderer.domElement);
    this.applyRenderMode();
  }

  private setupLighting() {
    this.scene.fog = new THREE.Fog(0x0c1110, 70, 190);

    this.hemisphereLight = new THREE.HemisphereLight(0xbedce4, 0x251a18, 1.8);
    this.scene.add(this.hemisphereLight);

    this.shadowRig = new ShadowRig(this.scene);
    this.applyLightingMode();
  }

  private setupGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_PLANE_SIZE, GROUND_PLANE_SIZE),
      this.groundMaterials[this.renderMode],
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = this.renderMode === "normal";
    this.ground = ground;
    this.scene.add(ground);
  }

  private applyRenderMode() {
    const potato = this.renderMode === "potato";
    this.renderer.setPixelRatio(potato ? POTATO_PIXEL_RATIO : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !potato;
    this.renderer.shadowMap.needsUpdate = !potato;
    if (this.ground) {
      this.ground.material = this.groundMaterials[this.renderMode];
      this.ground.receiveShadow = !potato;
    }
    this.applyLightingMode();
  }

  private applyLightingMode() {
    const enabled = this.renderMode === "normal";
    if (this.hemisphereLight) {
      this.hemisphereLight.visible = enabled;
    }
    this.shadowRig?.setEnabled(enabled);
  }
}
