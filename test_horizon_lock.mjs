
import * as THREE from './public/js/three/three.module.js';

const _90degX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

function testAngle(azimuthDeg, tiltDeg) {
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const tilt = THREE.MathUtils.degToRad(tiltDeg);
    const radius = 100;
    
    const camera = new THREE.PerspectiveCamera(75, 1, 1, 1000);
    camera.position.set(
        radius * Math.sin(tilt) * Math.sin(az),
        radius * Math.cos(tilt),
        radius * Math.sin(tilt) * Math.cos(az) * -1
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.normalize();
    
    // Apply counter-rotation: copy camera quat, then multiply by +90degX
    const groupQuat = new THREE.Quaternion().copy(camera.quaternion).multiply(_90degX);
    
    // Transform group local axes
    const worldX = new THREE.Vector3(1, 0, 0).applyQuaternion(groupQuat);
    const worldY = new THREE.Vector3(0, 1, 0).applyQuaternion(groupQuat);
    const worldZ = new THREE.Vector3(0, 0, 1).applyQuaternion(groupQuat);
    
    const worldUp = new THREE.Vector3(0, 1, 0);
    const dotX_cam = worldX.dot(camDir);
    const dotX_up = worldX.dot(worldUp);
    const dotY_negCamDir = worldY.dot(camDir.clone().negate());
    
    console.log(`=== az=${azimuthDeg}, tilt=${tiltDeg} ===`);
    console.log(`  camDir: (${camDir.x.toFixed(4)}, ${camDir.y.toFixed(4)}, ${camDir.z.toFixed(4)})`);
    console.log(`  group X (horizontal?): dot(X,camDir)=${dotX_cam.toFixed(4)}, dot(X,up)=${dotX_up.toFixed(4)}`);
    console.log(`  group Y (face-on?):     dot(Y,-camDir)=${dotY_negCamDir.toFixed(4)}`);
    console.log(`  group Z: (${worldZ.x.toFixed(4)}, ${worldZ.y.toFixed(4)}, ${worldZ.z.toFixed(4)})`);
    console.log(`  dot(Z,camDir)=${worldZ.dot(camDir).toFixed(4)}, dot(Z,up)=${worldZ.dot(worldUp).toFixed(4)}`);
}

testAngle(0, 30);
testAngle(90, 30);
testAngle(180, 30);
testAngle(270, 30);
testAngle(45, 45);
testAngle(90, 45);
testAngle(90, 90);
testAngle(90, 0);
