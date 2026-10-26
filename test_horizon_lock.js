
import * as THREE from './public/js/three/three.module.js';

const _90degX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

// Simulate OrbitControls lookAt at azimuth=0, tilt=30
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
    
    // Apply counter-rotation
    const groupQuat = new THREE.Quaternion().copy(camera.quaternion).multiply(_90degX);
    
    // Transform group local axes
    const localX = new THREE.Vector3(1, 0, 0);
    const localY = new THREE.Vector3(0, 1, 0);
    const localZ = new THREE.Vector3(0, 0, 1);
    
    const worldX = localX.clone().applyQuaternion(groupQuat);
    const worldY = localY.clone().applyQuaternion(groupQuat);
    const worldZ = localZ.clone().applyQuaternion(groupQuat);
    
    // For planets arranged along X (1,0,0):
    // worldX should be horizontal (perpendicular to camDir, in the view plane)
    // For planets arranged along Z (0,0,1):
    // worldZ should be vertical (along camUp direction)
    
    // Check: worldX should be horizontal (perpendicular to camDir AND perpendicular to worldUp)
    // i.e., dot(worldX, camDir) ≈ 0 and dot(worldX, worldUp) ≈ 0
    const worldUp = new THREE.Vector3(0, 1, 0);
    const dotX_cam = worldX.dot(camDir);
    const dotX_up = worldX.dot(worldUp);
    
    // Check: worldY should point toward camera (same as -camDir)
    const dotY_negCamDir = worldY.dot(camDir.clone().negate());
    
    console.log(`\n=== az=${azimuthDeg}°, tilt=${tiltDeg}° ===`);
    console.log(`  camDir: (${camDir.x.toFixed(4)}, ${camDir.y.toFixed(4)}, ${camDir.z.toFixed(4)})`);
    console.log(`  group X → (${worldX.x.toFixed(4)}, ${worldX.y.toFixed(4)}, ${worldX.z.toFixed(4)})`);
    console.log(`  dot(X, camDir): ${dotX_cam.toFixed(4)} (should be ~0)`);
    console.log(`  dot(X, worldUp): ${dotX_up.toFixed(4)} (should be ~0 = horizontal)`);
    console.log(`  group Y → (${worldY.x.toFixed(4)}, ${worldY.y.toFixed(4)}, ${worldY.z.toFixed(4)})`);
    console.log(`  dot(Y, -camDir): ${dotY_negCamDir.toFixed(4)} (should be ~1 = face-on)`);
    console.log(`  group Z → (${worldZ.x.toFixed(4)}, ${worldZ.y.toFixed(4)}, ${worldZ.z.toFixed(4)})`);
    
    // For planets arranged along Z — check if Z is vertical
    const dotZ_cam = worldZ.dot(camDir);
    const dotZ_up = worldZ.dot(worldUp);
    console.log(`  dot(Z, camDir): ${dotZ_cam.toFixed(4)} (should be ~0 = perpendicular to view direction)`);
    console.log(`  dot(Z, worldUp): ${dotZ_up.toFixed(4)} (should be +-1 = vertical)`);
}

// Test at the angles the user mentioned
testAngle(0, 30);
testAngle(90, 30);
testAngle(180, 30);
testAngle(270, 30);
testAngle(45, 45);
testAngle(90, 45);
testAngle(180, 45);
testAngle(270, 45);
testAngle(90, 90); // What happens at 90° tilt?
testAngle(90, 0);   // Top-down

console.log('\n=== Summary ===');
console.log('If dot(X, camDir) ≈ 0 and dot(X, worldUp) ≈ 0 at ALL angles,');
console.log('then planets arranged along X will appear HORIZONTAL at all camera angles.');
