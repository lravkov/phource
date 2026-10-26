
import * as THREE from './public/js/three/three.module.js';

const _90degX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const camDirTemp = new THREE.Vector3();
const camRightTemp = new THREE.Vector3();
const worldUpTemp = new THREE.Vector3(0, 1, 0);

// Simulate: 4 planets arranged along local Z axis at Z=10,20,30,40
// After counter-rotation, they should appear horizontally aligned in camera view
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
    
    const group = new THREE.Object3D();
    
    // Counter-rotation (exact same as phource.js)
    camera.getWorldDirection(camDirTemp);
    const horizLen = Math.sqrt(camDirTemp.x * camDirTemp.x + camDirTemp.z * camDirTemp.z);
    if (horizLen > 0.001) {
        group.quaternion.copy(camera.quaternion);
        group.quaternion.multiply(_90degX);
    } else {
        group.quaternion.identity();
    }
    group.updateMatrixWorld();
    
    // Planet positions (in local space, arranged along Z axis)
    const planetLocal = [
        new THREE.Vector3(0, 0, 10),
        new THREE.Vector3(0, 0, 20),
        new THREE.Vector3(0, 0, 30),
        new THREE.Vector3(0, 0, 40),
    ];
    
    // Transform to world
    const worldPositions = planetLocal.map(p => p.clone().applyMatrix4(group.matrixWorld));
    
    // Project to screen (camera view) coordinates
    const camDir = camDirTemp.clone().normalize();
    const camRight = camRightTemp.crossVectors(worldUpTemp, camDir).normalize();
    const camUp = new THREE.Vector3().crossVectors(camDir, camRight).normalize();
    
    // Project each planet position onto camera's right and up vectors
    const projections = worldPositions.map(p => ({
        right: p.dot(camRight),
        up: p.dot(camUp)
    }));
    
    // Check if all planets have the same "up" coordinate (horizontal line)
    const ups = projections.map(p => p.up);
    const rights = projections.map(p => p.right);
    const upRange = Math.max(...ups) - Math.min(...ups);
    const rightRange = Math.max(...rights) - Math.min(...rights);
    
    console.log(`=== az=${azimuthDeg}, tilt=${tiltDeg} (planets along local Z) ===`);
    console.log(`  Screen X (camRight): [${rights.map(r=>r.toFixed(1)).join(', ')}]`);
    console.log(`  Screen Y (camUp):    [${ups.map(u=>u.toFixed(1)).join(', ')}]`);
    console.log(`  Vertical spread: ${upRange.toFixed(2)} (should be ~0 for horizontal line)`);
    console.log(`  Horizontal spread: ${rightRange.toFixed(2)}`);
    
    // Also test planets along local X
    const planetLocalX = [
        new THREE.Vector3(10, 0, 0),
        new THREE.Vector3(20, 0, 0),
        new THREE.Vector3(30, 0, 0),
        new THREE.Vector3(40, 0, 0),
    ];
    const worldX = planetLocalX.map(p => p.clone().applyMatrix4(group.matrixWorld));
    const projX = worldX.map(p => ({
        right: p.dot(camRight),
        up: p.dot(camUp)
    }));
    const upsX = projX.map(p => p.up);
    const rightsX = projX.map(p => p.right);
    const upRangeX = Math.max(...upsX) - Math.min(...upsX);
    const rightRangeX = Math.max(...rightsX) - Math.min(...rightsX);
    
    console.log(`  (planets along local X):`);
    console.log(`  Screen Y spread: ${upRangeX.toFixed(2)} (should be ~0 = horizontal)`);
    console.log(`  Screen X spread: ${rightRangeX.toFixed(2)}`);
}

console.log("Testing Z-arranged planets (should be HORIZONTAL after counter-rotation):");
testAngle(0, 30);
testAngle(90, 30);
testAngle(180, 30);
testAngle(270, 30);

console.log("\\nTesting X-arranged planets (should also be HORIZONTAL):");
testAngle(90, 30);
testAngle(90, 45);
