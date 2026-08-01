import * as THREE from "three";

// Simple low-poly ranger figure, shown only in third-person/over-the-shoulder
// view - in first person there's nothing to show (the camera *is* the head),
// so this whole group just stays hidden.
export class PlayerAvatar {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;

    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3a6b3f });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xd8a878 });
    const hatMat = new THREE.MeshLambertMaterial({ color: 0x2f4d2f });

    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.75, 4, 8), bodyMat);
    this.body.position.y = 0.75;
    this.body.castShadow = true;
    this.group.add(this.body);

    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), skinMat);
    this.head.position.y = 1.42;
    this.head.castShadow = true;
    this.group.add(this.head);

    this.hat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.24, 10), hatMat);
    this.hat.position.y = 1.66;
    this.group.add(this.hat);

    scene.add(this.group);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  // eyeX/eyeZ: the logical camera's horizontal position (its head); yaw: the
  // horizontal facing angle in radians; groundY: terrain height at that spot.
  update(eyeX, eyeZ, yaw, groundY, bobPhase, bobBlend) {
    this.group.position.set(eyeX, groundY, eyeZ);
    this.group.rotation.y = yaw;
    const walkBob = Math.sin(bobPhase * 2) * 0.04 * bobBlend;
    this.body.position.y = 0.75 + walkBob;
    this.head.position.y = 1.42 + walkBob;
    this.hat.position.y = 1.66 + walkBob;
  }
}
