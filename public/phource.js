// phource.js — Main visualization engine
// Combines gource's time-based animation with per-user commit actors
// and city-blocks' loc-proportional file volumes (volume = loc^3)
//
// Log format (extended gource custom log):
//   timestamp|username|action|filepath|loc|count|colour_hex
//   action: A (added), M (modified), D (deleted)

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// === Constants ===
const POWER_CONSTANT_P = 0.2;
const PADDING = 20;
const ITEM_SPACING = 10;
const FOUNDATION_HEIGHT = 5;
const MIN_VISIBLE_BUILDING_DIMENSION = 1.0;
const MIN_LAYOUT_DIMENSION = 5;
const BASE_FOUNDATION_COLOR = new THREE.Color(0xdddddd);
const FOUNDATION_DARKEN_PER_LEVEL = 0.08;
const GROUND_MATERIAL_COLOR = 0x0d2818;
const SECONDS_PER_COMMIT = 0.5;  // Each commit batch visible for 0.5s — middle ground between too-fast (30 days/sec) and too-slow (3s/commit)
const USER_IDLE_TIME = 6.0;
const BEAM_DURATION = 1.2;
const BEAM_FOLLOW_TREE = false;
const BEAM_LINE_WIDTH = 2;
const BEAM_OPACITY = 0.85;            // Brighter with additive blending
const BEAM_PROPAGATION_TIME = 0.15;   // 15% of duration for fast path reveal
const LERP_FACTOR = 0.12;
const DIR_LAYOUT_LERP = 0.08;
const USER_SPEED = 300.0;
const USER_HEIGHT = 8.0;
const GLOBAL_SCALE = 0.3;

// === Layout constants (static — no rotation) ===
const ORBIT_RADIUS_PER_FILE = 40;
const ORBIT_DIR_RADIUS = 1600;         // Radius for child directory placement (gource: wider spacing)
const ORBIT_FILE_RADIUS = 400;         // Inner radius for file placement
const MIN_FILE_GAP = 40;               // Minimum gap between adjacent file spheres

// === Sphere visualization constants ===
const SPHERE_SEGMENTS = 6;
const FILE_SPHERE_RADIUS = 0.15;
const DIR_SPHERE_RADIUS = 8;

// === Global state ===
let scene, camera, renderer, controls;
let raycaster, mouse, tooltipElement, loadingElement, dateElement, intersectedObject = null;
const pickableObjects = [];
let clock;

let root = null;
let fileMap = new Map();
const users = new Map();
const beamActions = [];
const _beamOffsetMap = new Map();  // fullPath -> offset index (per-file grouping)

// File sphere tracking (InstancedMesh for performance: 1 draw call for all files)
let fileInstancedMesh = null;
let fileInstanceCount = 0;
const fileInstanceNodes = []; // instanceId -> fileNode
const FILE_INSTANCES_CAPACITY = 3000;

let logEntries = [];
let loadedBranches = [];
let primaryBranch = null;  // Set to first branch loaded — files get no prefix
let commitIndex = 0;
let simTime = 0;
let simStarted = false;
let treeDirty = false;
let maxCommitCount = 1;
let cameraNeedsAutoFit = false;
let lastUserInteraction = 0;
// Auto-fit only when user hasn't interacted for 2 seconds
const AUTO_FIT_COOLDOWN = 2000;
let dtSum = 0;
let frameCount = 0;
let _timeSinceLastCommit = 0;
let _cameraTargetY = null;  // null = no pending lerp target

// === Disney bounce zoom state ===
let _bounceActive = false;
let _bounceStartTime = 0;
let _bounceTargetY = 0;
let _bounceAmplitude = 0;
let _lastBounceEndTime = 0; // tracks when last bounce completed for cooldown
let _lastPredictY = null;
// Pre-computed max directory depth for remaining commits (for zoom planning)
// _maxDirDepthRemaining[i] = max dir depth across commits[i+1..end]
let _maxDirDepthRemaining = [];
const BOUNCE_DURATION = 700;  // ms — slowed slightly for smoother feel
const BOUNCE_THRESHOLD = 0.008; // 0.8% change in target distance to trigger bounce
const BOUNCE_OVERSHOOT = 0.05; // 5% overshoot past target
const BOUNCE_COOLDOWN = 500; // ms between bounce triggers to prevent clustering

// Road (connection line) state — Ikeda: thin white wireframe lines
let roadLines = [];
const ROAD_COLOR = 0xffffff;
const ROAD_OPACITY = 0.4;
const ROAD_LINE_WIDTH = 1;

// Scrubber state
let isScrubbing = false;
let simPaused = false;
let minTimestamp = 0;
let maxTimestamp = 0;
let scrubberElement = null;
let scrubberDateElement = null;

// === Force-directed layout state ===
let forceLayoutNodes = [];
let forceSimRunning = false;
let forceCooling = 1.0;

// === Utility functions ===

function colourHash(str) {
    // Ikeda aesthetic: monochromatic — all nodes pure white
    return new THREE.Color(0xffffff);
}

function hexToColor(hex) {
    // Ikeda aesthetic: no colour overrides — all white
    return new THREE.Color(0xffffff);
}

function calculateHeightPower(x, k, p) {
    if (k < 0 && p % 1 !== 0) return NaN;
    if (x < 0) x = 0;
    const kValue = (k < 0 && p % 2 === 0) ? Math.abs(k) : k;
    return x * Math.pow(kValue, p);
}

function calculateWidthPower(x, k, p) {
    const power = -p / 2;
    if (k < 0 && power % 1 !== 0) return NaN;
    if (x < 0) x = 0;
    const kValue = (k < 0 && power % 2 === 0) ? Math.abs(k) : k;
    return x * Math.pow(kValue, power);
}

function getHeatColor(heatInput) {
    // Ikeda aesthetic: no heat colour mapping — all white
    return new THREE.Color(0xffffff);
}

function calculateFileDimensions(loc, count) {
    if (loc <= 0 || count <= 0) {
        return {
            width: MIN_LAYOUT_DIMENSION * GLOBAL_SCALE,
            depth: MIN_LAYOUT_DIMENSION * GLOBAL_SCALE,
            height: MIN_VISIBLE_BUILDING_DIMENSION * GLOBAL_SCALE,
        };
    }
    const effectiveCount = Math.max(count, Number.EPSILON);
    const wRaw = calculateWidthPower(loc, effectiveCount, POWER_CONSTANT_P);
    const dRaw = calculateWidthPower(loc, effectiveCount, POWER_CONSTANT_P);
    const hRaw = calculateHeightPower(loc, effectiveCount, POWER_CONSTANT_P);
    return {
        width:  Math.max(isNaN(wRaw) ? MIN_LAYOUT_DIMENSION : wRaw, MIN_LAYOUT_DIMENSION) * GLOBAL_SCALE,
        depth:  Math.max(isNaN(dRaw) ? MIN_LAYOUT_DIMENSION : dRaw, MIN_LAYOUT_DIMENSION) * GLOBAL_SCALE,
        height: Math.max(isNaN(hRaw) ? MIN_VISIBLE_BUILDING_DIMENSION : hRaw, MIN_VISIBLE_BUILDING_DIMENSION) * GLOBAL_SCALE,
    };
}

function formatDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

// === Tree data structures ===

function createDirNode(name, fullPath, depth) {
    return {
        name, fullPath, childDirectories: [], childFiles: [],
        loc: 0, count: 0, isDirectory: true, depth,
        calculatedOuterWidth: 0, calculatedOuterDepth: 0,
        foundationHeight: FOUNDATION_HEIGHT * GLOBAL_SCALE,
        innerWidth: 0, innerDepth: 0,
        prelimX: 0, prelimZ: 0, renderOffsetX: 0, renderOffsetZ: 0,
        buildingWidth: 0, buildingDepth: 0,
        mesh: null,
        targetPos: new THREE.Vector3(0, 0, 0),
    };
}

function createFileNode(name, fullPath, loc, count, colourHex, depth, actionType) {
    const dims = calculateFileDimensions(loc, count);
    return {
        name, fullPath, loc, count, colourHex: colourHex || '',
        actionType: actionType || 'A',
        isDirectory: false, depth, heat: 0,
        buildingWidth: dims.width, buildingDepth: dims.depth, buildingHeight: dims.height,
        mesh: null,
        targetPos: new THREE.Vector3(0, 0, 0),
        forceSize: Math.min(Math.max(dims.width, dims.depth), 100),
        currentAlpha: 0, targetAlpha: 1, fadingOut: false, pendingRemoval: false,
        parentDir: null,
    };
}

function initTree() {
    root = createDirNode('(root)', '', 0);
    fileMap.clear();
    treeDirty = true;
}

function findOrCreateDir(filepath) {
    const parts = filepath.split('/');
    parts.pop();
    let currentDir = root;
    const pathSegments = [];
    for (const partName of parts) {
        if (!partName) continue;
        pathSegments.push(partName);
        let dir = currentDir.childDirectories.find(d => d.name === partName);
        if (!dir) {
            dir = createDirNode(partName, pathSegments.join('/'), currentDir.depth + 1);
            dir.parentDir = currentDir;
            currentDir.childDirectories.push(dir);
            // Tree structure changed — mark dirty so rebuildLayout repositions
            // this new directory (and all others) to correct radial positions
            treeDirty = true;
        }
        currentDir = dir;
    }
    return currentDir;
}

function getNodeByPath(filepath) {
    const parts = filepath.split('/');
    parts.pop();
    let currentDir = root;
    for (const partName of parts) {
        if (!partName) continue;
        const dir = currentDir.childDirectories.find(d => d.name === partName);
        if (!dir) return null;
        currentDir = dir;
    }
    return currentDir;
}

function addFileToTree(filepath, loc, count, colourHex, actionType) {
    const parts = filepath.split('/');
    const fileName = parts.pop();
    if (!fileName) return null;
    const parentDir = findOrCreateDir(filepath);
    let fileNode = parentDir.childFiles.find(f => f.name === fileName);
    if (fileNode) {
        fileNode.loc = loc;
        fileNode.count = count;
        fileNode.colourHex = colourHex || '';
        if (actionType) fileNode.actionType = actionType;
        // Re-activate file that was previously deleted (action='D' then 'A'/'M')
        fileNode.targetAlpha = 1;
        fileNode.fadingOut = false;
        fileNode.pendingRemoval = false;
    } else {
        fileNode = createFileNode(fileName, filepath, loc, count, colourHex, parentDir.depth + 1, actionType);
        parentDir.childFiles.push(fileNode);
        fileNode.parentDir = parentDir;
        // treeDirty is set by findOrCreateDir when new directories are created.
        // New files in existing directories join the simulation directly —
        // no layout rebuild needed for files alone.
        // Position new file near parent directory to avoid starting at origin
        fileNode.targetPos.copy(parentDir.targetPos);
        const offset = (parentDir.forceSize || 50) + (fileNode.forceSize || 10) + MIN_FILE_GAP;
        const angle = Math.random() * Math.PI * 2;
        fileNode.targetPos.x += Math.cos(angle) * offset;
        fileNode.targetPos.z += Math.sin(angle) * offset;
        // Add to force layout so it participates in repulsion immediately
        if (forceLayoutNodes && forceLayoutNodes.indexOf(fileNode) === -1) {
            forceLayoutNodes.push(fileNode);
            fileNode.vx = (Math.random() - 0.5) * 0.5;
            fileNode.vz = (Math.random() - 0.5) * 0.5;
            fileNode.fx = 0; fileNode.fz = 0;
        }
    }
    fileMap.set(filepath, fileNode);
    return fileNode;
}

function removeFileFromTree(filepath) {
    const fileNode = fileMap.get(filepath);
    if (!fileNode) return null;
    const parts = filepath.split('/');
    parts.pop();
    let currentDir = root;
    for (const partName of parts) {
        if (!partName) continue;
        const dir = currentDir.childDirectories.find(d => d.name === partName);
        if (!dir) return null;
        currentDir = dir;
    }
    const idx = currentDir.childFiles.findIndex(f => f.fullPath === filepath);
    if (idx !== -1) currentDir.childFiles.splice(idx, 1);
    fileMap.delete(filepath);
    treeDirty = true;
    return fileNode;
}

// === Directory stats ===

function calculateDirectoryStats(dirNode) {
    let totalLoc = 0;
    let totalCount = 0;
    dirNode.childFiles.forEach(file => {
        totalLoc += file.loc;
        totalCount += file.count;
    });
    dirNode.childDirectories.forEach(childDir => {
        calculateDirectoryStats(childDir);
        totalLoc += childDir.loc;
        totalCount += childDir.count;
    });
    dirNode.loc = totalLoc;
    dirNode.count = totalCount;
}

// === Force-directed layout (constellation style) ===

function calculateNodeDimensions(node) {
    if (!node) return;
    if (node.isDirectory) {
        const dirSize = Math.max(Math.sqrt(Math.max(node.loc, 1)) * 15 * GLOBAL_SCALE, PADDING * 2);
        node.calculatedOuterWidth = dirSize;
        node.calculatedOuterDepth = dirSize;
        node.foundationHeight = FOUNDATION_HEIGHT * GLOBAL_SCALE;
        node.forceSize = Math.min(Math.max(Math.sqrt(Math.max(node.loc, 1)) * 2, 10), 100);
        const children = [...(node.childFiles || []), ...(node.childDirectories || [])];
        children.forEach(child => calculateNodeDimensions(child));
    } else {
        const dims = calculateFileDimensions(Math.max(node.loc, 1), Math.max(node.count, 1));
        node.buildingHeight = Math.max(dims.height, MIN_VISIBLE_BUILDING_DIMENSION);
        node.buildingWidth = Math.max(dims.width, MIN_LAYOUT_DIMENSION);
        node.buildingDepth = Math.max(dims.depth, MIN_LAYOUT_DIMENSION);
        // forceSize: used for layout spacing and visual scale. Derive from
        // the file dimensions (already GLOBAL_SCALE'd) with a sane floor so
        // small files are still visible and don't jitter during settling.
        node.forceSize = Math.min(Math.max(Math.max(dims.width, dims.depth), 10), 100);
    }
}

function collectLayoutNodes(node, out) {
    if (!node || !node.isDirectory) return;
    out.push(node);
    node.childFiles.forEach(f => out.push(f));
    node.childDirectories.forEach(child => collectLayoutNodes(child, out));
}

function calculateOrbitalLayout(rootNode) {
    if (!rootNode) return;
    calculateNodeDimensions(rootNode);
    // Root at exact origin
    rootNode.targetPos = new THREE.Vector3(0, 0, 0);
    rootNode.parentDir = null;
    rootNode.forceSize = Math.min(rootNode.forceSize || 50, 100);

    // IDEA 1: Angular Sector Tree — sunburst-style layout.
    // Directories allocated proportional angular sectors from parent's
    // range (proportional to subtree LOC). Files placed within parent's
    // angular sector on concentric arcs. Depth determines ring radius.
    rootNode.depth = 0;
    rootNode.startAngle = 0;
    rootNode.endAngle = Math.PI * 2;

    const ringSpacing = ORBIT_DIR_RADIUS;  // 1600 units per depth level

    (function placeTreeSector(node, depth, startAngle, endAngle) {
        const sectorAngle = endAngle - startAngle;
        const centerAngle = (startAngle + endAngle) / 2;
        node.depth = depth;
        node.startAngle = startAngle;
        node.endAngle = endAngle;

        // Place directory on concentric ring by depth
        if (depth > 0) {
            const radius = ringSpacing * depth;
            node.targetPos = new THREE.Vector3(
                Math.cos(centerAngle) * radius,
                0,
                Math.sin(centerAngle) * radius
            );
            node.orbitRadius = radius;
        }

        const childDirs = node.childDirectories || [];
        const files = node.childFiles || [];

        // Weight child directories by subtree LOC for proportional allocation
        let dirLocTotal = 0;
        childDirs.forEach(d => { dirLocTotal += Math.max(d.loc || 1, 1); });

        if (dirLocTotal > 0) {
            let angleCursor = startAngle;
            childDirs.forEach(child => {
                child.parentDir = node;
                const childWeight = Math.max(child.loc || 1, 1);
                const childSector = (childWeight / dirLocTotal) * sectorAngle;
                placeTreeSector(child, depth + 1, angleCursor, angleCursor + childSector);
                angleCursor += childSector;
            });
        }

        // Place files on concentric rings around the directory sphere.
        // Using rings (not a single cluster) prevents file-file overlaps,
        // so resolveOverlaps doesn't need to push files (and directories)
        // far from their orbital positions — preserving road line structure.
        if (files.length > 0) {
            const nodeSize = (node.forceSize || 50) / 2;
            const baseRadius = nodeSize + 20;  // Just past the directory sphere
            const sorted = [...files].sort((a, b) => {
                const as = Math.max(a.buildingWidth, a.buildingDepth);
                const bs = Math.max(b.buildingWidth, b.buildingDepth);
                return bs - as;
            });

            const anchorX = node.targetPos.x;
            const anchorZ = node.targetPos.z;

            // Place files on concentric rings around the directory sphere.
            // Each ring holds as many files as its circumference allows.
            // Largest files placed first (inner rings) for stability.
            let ring = 0;
            let placed = 0;
            for (let j = 0; j < sorted.length; j++) {
                const file = sorted[j];
                file.parentDir = node;
                const fileSize = Math.max(file.buildingWidth, file.buildingDepth);
                const ringRadius = baseRadius + ring * (MIN_FILE_GAP * 2);
                const capacity = Math.max(1, Math.floor((2 * Math.PI * ringRadius) / (MIN_FILE_GAP * 2)));
                if (placed >= capacity) {
                    ring++;
                    placed = 0;
                }
                const angle = (placed / capacity) * Math.PI * 2;
                const r = ringRadius + fileSize / 2 + MIN_FILE_GAP;
                file.targetPos = new THREE.Vector3(
                    anchorX + Math.cos(angle) * r,
                    node.foundationHeight + file.buildingHeight / 2,
                    anchorZ + Math.sin(angle) * r
                );
                file.orbitRadius = Math.sqrt(
                    file.targetPos.x ** 2 + file.targetPos.z ** 2
                );
            }
        }
    })(rootNode, 0, 0, Math.PI * 2);

    // Collect nodes for resolve/ bounds
    forceLayoutNodes = [];
    (function collect(node) {
        if (!node || !node.targetPos) return;
        forceLayoutNodes.push(node);
        if (node.isDirectory) {
            node.childFiles.forEach(collect);
            node.childDirectories.forEach(collect);
        }
    })(rootNode);

    computeSceneBounds();
    forceFrameCount = 0;
    // Minimal settle during sim playback — just enough to place nodes.
    // Depth-layered rings keep directories on concentric circles;
    // resolveOverlaps only pushes overlapping nodes apart along their axis,
    // preserving the ring structure. No stepForceLayout needed.
    forceCooling = 1.0;
    for (let i = 0; i < 10; i++) resolveOverlaps();
    forceCooling = 0.0;
    rootNode.targetPos.set(0, 0, 0);
}

// Static layout — no rotation.  Nodes stay exactly where
// calculateOrbitalLayout placed them.
function stepOrbitalLayout(dt) {
    return;
}

// Overlap resolution: spatial grid O(n·k) with 5 inner passes.
// Rebuilds grid each pass since positions change.
// IMPORTANT: only pushes FILE nodes (not directories) to preserve the
// orbital angular ordering of directory nodes. Pushing directories would
// cause road lines (parent-child connections) to cross each other.
function resolveOverlaps() {
    if (!forceLayoutNodes || forceLayoutNodes.length === 0) {
        if (!root || !root.targetPos) return;
        forceLayoutNodes = [];
        (function collect(node) {
            if (!node || !node.targetPos) return;
            forceLayoutNodes.push(node);
            if (node.isDirectory) {
                node.childFiles.forEach(collect);
                node.childDirectories.forEach(collect);
            }
        })(root);
    }
    if (forceLayoutNodes.length < 2) return;
    const nodes = forceLayoutNodes;
    let maxForceSize = 10;
    for (let i = 0; i < nodes.length; i++) {
        const fs = nodes[i].forceSize || 10;
        if (fs > maxForceSize) maxForceSize = fs;
    }
    const cellSize = maxForceSize + MIN_FILE_GAP + 50;
    const n = nodes.length;
    const pushX = new Float64Array(n);
    const pushZ = new Float64Array(n);
    for (let pass = 0; pass < 10; pass++) {  // Increased from 5 for large repos
        // Rebuild grid each pass (positions have moved)
        const grid = new Map();
        for (let i = 0; i < n; i++) {
            const a = nodes[i];
            if (!a || a === root || a.isDirectory) continue;
            const cx = Math.floor(a.targetPos.x / cellSize);
            const cz = Math.floor(a.targetPos.z / cellSize);
            const key = cx + ',' + cz;
            let cell = grid.get(key);
            if (!cell) { grid.set(key, []); cell = grid.get(key); }
            cell.push(i);
        }
        for (let i = 0; i < n; i++) { pushX[i] = 0; pushZ[i] = 0; }
        for (let i = 0; i < n; i++) {
            const a = nodes[i];
            if (!a || a === root) continue;
            const aSize = a.forceSize || 10;
            const cx = Math.floor(a.targetPos.x / cellSize);
            const cz = Math.floor(a.targetPos.z / cellSize);
            for (let gx = -1; gx <= 1; gx++) {
                for (let gz = -1; gz <= 1; gz++) {
                    const key = (cx + gx) + ',' + (cz + gz);
                    const cell = grid.get(key);
                    if (!cell) continue;
                    for (let k = 0; k < cell.length; k++) {
                        const j = cell[k];
                        if (j <= i) continue;
                        const b = nodes[j];
                        if (!b || b === root) continue;
                        const bSize = b.forceSize || 10;
                        const dx = b.targetPos.x - a.targetPos.x;
                        const dz = b.targetPos.z - a.targetPos.z;
                        const distSq = dx * dx + dz * dz;
                        const minDist = (aSize + bSize) / 2 + MIN_FILE_GAP;
                        if (distSq < (minDist - 1) * (minDist - 1)) {
                            if (distSq > 0.01) {
                                const dist = Math.sqrt(distSq);
                                const overlap = minDist - dist;
                                const nx = dx / dist, nz = dz / dist;
                                pushX[i] -= nx * overlap * 0.5;
                                pushZ[i] -= nz * overlap * 0.5;
                                pushX[j] += nx * overlap * 0.5;
                                pushZ[j] += nz * overlap * 0.5;
                            } else {
                                const angle = ((i * 0.1) + (j * 0.1)) * Math.PI * 2;
                                const nx = Math.cos(angle), nz = Math.sin(angle);
                                pushX[i] -= nx * minDist * 0.5;
                                pushZ[i] -= nz * minDist * 0.5;
                                pushX[j] += nx * minDist * 0.5;
                                pushZ[j] += nz * minDist * 0.5;
                            }
                        }
                    }
                }
            }
        }
        for (let i = 0; i < n; i++) {
            const d = nodes[i];
            if (!d || d === root || d.isDirectory) continue;
            d.targetPos.x += pushX[i];
            d.targetPos.z += pushZ[i];
        }
    }
}

function computeSceneBounds() {
    if (!root || forceLayoutNodes.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    forceLayoutNodes.forEach(d => {
        minX = Math.min(minX, d.targetPos.x - (d.forceSize || 10));
        maxX = Math.max(maxX, d.targetPos.x + (d.forceSize || 10));
        minZ = Math.min(minZ, d.targetPos.z - (d.forceSize || 10));
        maxZ = Math.max(maxZ, d.targetPos.z + (d.forceSize || 10));
    });
    root.calculatedOuterWidth = Math.max(maxX - minX, 100);
    root.calculatedOuterDepth = Math.max(maxZ - minZ, 100);
}

function stepForceLayout(noCooldown) {
    if (!forceLayoutNodes || forceLayoutNodes.length < 2) return;
    const nodes = forceLayoutNodes;
    const n = nodes.length;
    const scale = forceCooling; // cooling: 1.0 → 0.3 over time
    let maxForceSize = 10;
    for (let i = 0; i < n; i++) {
        const fs = nodes[i].forceSize || 10;
        if (fs > maxForceSize) maxForceSize = fs;
    }
    const cutoff = maxForceSize + MIN_FILE_GAP + 100;
    const cutoffSq = cutoff * cutoff;
    const cellSize = cutoff;

    // Spatial grid: O(n·k) repulsion instead of O(n²). cellSize >= cutoff
    // guarantees any within-range pair is in adjacent or same cell.
    const grid = new Map();
    const cellX = new Int32Array(n);
    const cellZ = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        const a = nodes[i];
        if (!a || a === root) continue;
        const cx = Math.floor(a.targetPos.x / cellSize);
        const cz = Math.floor(a.targetPos.z / cellSize);
        cellX[i] = cx;
        cellZ[i] = cz;
        const key = cx + ',' + cz;
        let cell = grid.get(key);
        if (!cell) { grid.set(key, []); cell = grid.get(key); }
        cell.push(i);
    }

    // Compute forces
    const fx = new Float64Array(n);
    const fz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const a = nodes[i];
        if (!a || a === root) continue;
        const aSize = a.forceSize || 10;
        // Parent-child attraction: weak spring with adaptive ideal distance.
        // Gentle pull toward parent prevents drift while letting repulsion
        // determine actual spacing — gource-style physics without fixed orbits.
        if (a.parentDir && a.parentDir.targetPos) {
            const pdx = a.parentDir.targetPos.x - a.targetPos.x;
            const pdz = a.parentDir.targetPos.z - a.targetPos.z;
            const pdist = Math.sqrt(pdx * pdx + pdz * pdz) || 0.01;
            const idealDist = (a.forceSize || 10) + (a.parentDir.forceSize || 50) + MIN_FILE_GAP * 2;
            const springForce = (pdist - idealDist) * 0.001 * scale;
            fx[i] += (pdx / pdist) * springForce;
            fz[i] += (pdz / pdist) * springForce;
        }
        // Repulsion: check 3×3 neighborhood of grid cells
        const cx = cellX[i];
        const cz = cellZ[i];
        for (let gx = -1; gx <= 1; gx++) {
            for (let gz = -1; gz <= 1; gz++) {
                const key = (cx + gx) + ',' + (cz + gz);
                const cell = grid.get(key);
                if (!cell) continue;
                for (let k = 0; k < cell.length; k++) {
                    const j = cell[k];
                    if (j <= i) continue;
                    const b = nodes[j];
                    if (!b || b === root) continue;
                    const bSize = b.forceSize || 10;
                    const dx = b.targetPos.x - a.targetPos.x;
                    const dz = b.targetPos.z - a.targetPos.z;
                    const distSq = dx * dx + dz * dz;
                    if (distSq > cutoffSq) continue;
                    const minDist = (aSize + bSize) / 2 + MIN_FILE_GAP;
                    if (distSq < minDist * minDist && distSq > 0.01) {
                        const dist = Math.sqrt(distSq);
                        const force = (minDist - dist) * 2.0 * scale;
                        const nx = dx / dist, nz = dz / dist;
                        fx[i] -= nx * force; fz[i] -= nz * force;
                        fx[j] += nx * force; fz[j] += nz * force;
                    }
                }
            }
        }
    }

    // Apply forces with velocity damping (stable, no oscillation)
    // Strong fixed damping prevents velocity accumulation during playback
    const damping = 0.97 - 0.02 * scale;
    const maxVel = Math.min(50 * scale, 100);
    for (let i = 0; i < n; i++) {
        const a = nodes[i];
        if (!a || a === root) continue;
        a.vx = (a.vx || 0) * damping + fx[i];
        a.vz = (a.vz || 0) * damping + fz[i];
        // Clamp velocity to prevent over-spreading
        const speed = Math.sqrt(a.vx * a.vx + a.vz * a.vz);
        if (speed > maxVel) {
            a.vx *= maxVel / speed;
            a.vz *= maxVel / speed;
        }
        a.targetPos.x += a.vx;
        a.targetPos.z += a.vz;
    }
    // Cool down during playback (not during initial settling)
    if (!noCooldown) {
        forceCooling = Math.max(0.3, forceCooling * 0.997);
    }
}

let forceFrameCount = 0;

function stepOrbitalSimulation(dt) {
    if (isScrubbing) return;
    forceFrameCount++;
    // resolveOverlaps only during active settling — not during playback.
    // Running it during playback jitters small files and can push directory
    // nodes out of their orbital angular order, causing road lines to cross.
    if (forceSimRunning && forceFrameCount % 30 === 0) resolveOverlaps();
}

// Async chunked settling — runs initial 10 passes synchronously (layout is
// already good from calculateOrbitalLayout + 10 resolveOverlaps in rebuildLayout),
// then remaining passes in async chunks via setTimeout(0) to keep UI responsive.
// Total passes reduced from 500 to 30 for near-instant scrub response.
const SETTLE_TOTAL_PASSES = 50;
const SETTLE_SYNC_PASSES = 15;
const SETTLE_CHUNK_SIZE = 10;
let _settleRemaining = 0;

async function settleCompleteLayout() {
    if (!root) return;
    forceSimRunning = true;
    forceCooling = 1.0;
    // Run initial passes synchronously for immediate layout quality
    for (let i = 0; i < SETTLE_SYNC_PASSES; i++) resolveOverlaps();
    // Remaining passes async to avoid blocking the main thread
    _settleRemaining = SETTLE_TOTAL_PASSES - SETTLE_SYNC_PASSES;
    if (_settleRemaining > 0) {
        _settleChunkAsync();
    } else {
        forceCooling = 0.0;
        if (root) root.targetPos.set(0, 0, 0);
        forceSimRunning = false;
        console.log('Layout settled. Overlaps:', window.__phourceDebug.overlapCount);
    }
}

function _settleChunkAsync() {
    const passes = Math.min(SETTLE_CHUNK_SIZE, _settleRemaining);
    for (let i = 0; i < passes; i++) resolveOverlaps();
    _settleRemaining -= passes;
    if (_settleRemaining > 0) {
        setTimeout(_settleChunkAsync, 0);
    } else {
        forceCooling = 0.0;
        if (root) root.targetPos.set(0, 0, 0);
        forceSimRunning = false;
        console.log('Layout settled. Overlaps:', window.__phourceDebug.overlapCount);
    }
}

function rebuildLayout() {
    if (!root) return;
    calculateDirectoryStats(root);
    calculateOrbitalLayout(root);
    // Offset branch subtrees side-by-side (no-op for single-branch mode)
    offsetBranchTrees();
    maxCommitCount = 1;
    for (const node of fileMap.values()) {
        if (node.count > maxCommitCount) maxCommitCount = node.count;
    }
    cameraNeedsAutoFit = true;
    // Do NOT set forceSimRunning=true here — that flag should only be
    // active during the post-simulation settling phase (settleCompleteLayout).
    // Setting it here causes stepOrbitalSimulation to call resolveOverlaps
    // every 30 frames DURING playback, jittering small files and potentially
    // destabilizing file positions. The 10 resolveOverlaps passes already
    // run inside calculateOrbitalLayout for the initial cleanup.
    treeDirty = false;
    createRoadLines();
}

// === Three.js object creation ===

// InstancedMesh for file spheres: batches all files into a single draw call.
// Key fix: geometry must have a 'color' vertex attribute initialized to white (1,1,1)
// so that the shader's `vColor *= color` doesn't multiply by zeros.
function initFileInstancedMesh() {
    if (fileInstancedMesh) {
        scene.remove(fileInstancedMesh);
        fileInstancedMesh.geometry.dispose();
        fileInstancedMesh.material.dispose();
        const pIndex = pickableObjects.indexOf(fileInstancedMesh);
        if (pIndex !== -1) pickableObjects.splice(pIndex, 1);
        fileInstancedMesh = null;
    }
    const geometry = new THREE.SphereGeometry(0.5, SPHERE_SEGMENTS, SPHERE_SEGMENTS / 2);
    // Add white vertex color attribute — required for vertexColors + instanceColor to work
    const colorCount = geometry.attributes.position.count;
    const colors = new Float32Array(colorCount * 3).fill(1.0);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
    fileInstancedMesh = new THREE.InstancedMesh(geometry, material, FILE_INSTANCES_CAPACITY);
    fileInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Pre-initialize instanceColor so shader compiles with USE_INSTANCING_COLOR
    fileInstancedMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FILE_INSTANCES_CAPACITY * 3), 3);
    fileInstancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    material.needsUpdate = true;
    scene.add(fileInstancedMesh);
    pickableObjects.push(fileInstancedMesh);
    fileInstanceCount = 0;
    fileInstanceNodes.length = 0;
}

function addFileInstance(fileNode) {
    if (!fileInstancedMesh) return;
    const id = fileInstanceCount++;
    fileNode.instanceId = id;
    fileInstanceNodes[id] = fileNode;
    const s = fileNode.forceSize || 10;
    // Fade-in + scale-up: start small and transparent, lerp to full size/alpha
    fileNode.currentScale = 0;
    fileNode.currentAlpha = 0;
    // Spawn from a random position near parent directory (like gource),
    // then lerp toward targetPos for the "spawning" animation effect
    if (fileNode.parentDir && fileNode.parentDir.targetPos) {
        const angle = Math.random() * Math.PI * 2;
        const spawnDist = (fileNode.parentDir.forceSize || 50) + 30;
        fileNode.currentX = fileNode.parentDir.targetPos.x + Math.cos(angle) * spawnDist;
        fileNode.currentZ = fileNode.parentDir.targetPos.z + Math.sin(angle) * spawnDist;
    } else {
        fileNode.currentX = fileNode.targetPos.x;
        fileNode.currentZ = fileNode.targetPos.z;
    }
    fileNode.fadingOut = false;
    fileNode.pendingRemoval = false;

    // Ikeda: pure white — data magnitude encoded in size, not color
    fileInstancedMesh.setColorAt(id, new THREE.Color(0xffffff));
    fileInstancedMesh.instanceColor.needsUpdate = true;

    fileNode.mesh = fileInstancedMesh; // Reference to the InstancedMesh
    updateFileMesh(fileNode, 0);
}

function updateFileMesh(fileNode, dt) {
    if (!fileInstancedMesh || fileNode.instanceId === undefined) return;
    const id = fileNode.instanceId;
    fileNode.currentAlpha = THREE.MathUtils.lerp(fileNode.currentAlpha, fileNode.targetAlpha, 0.15);
    const targetScale = (fileNode.forceSize || 10) * fileNode.currentAlpha;
    fileNode.currentScale = THREE.MathUtils.lerp(fileNode.currentScale, targetScale, LERP_FACTOR);

    // Position: snap to target when close (prevents micro-jitter from force layout),
    // lerp when far (smooth animation during spawn/movement)
    const dx = fileNode.targetPos.x - fileNode.currentX;
    const dz = fileNode.targetPos.z - fileNode.currentZ;
    if (Math.abs(dx) > 0.5 || Math.abs(dz) > 0.5) {
        fileNode.currentX = THREE.MathUtils.lerp(fileNode.currentX, fileNode.targetPos.x, LERP_FACTOR);
        fileNode.currentZ = THREE.MathUtils.lerp(fileNode.currentZ, fileNode.targetPos.z, LERP_FACTOR);
    } else {
        fileNode.currentX = fileNode.targetPos.x;
        fileNode.currentZ = fileNode.targetPos.z;
    }
    const matrix = new THREE.Matrix4();
    matrix.makeScale(fileNode.currentScale, fileNode.currentScale, fileNode.currentScale);
    matrix.setPosition(fileNode.currentX, fileNode.currentScale / 2, fileNode.currentZ);
    fileInstancedMesh.setMatrixAt(id, matrix);
    fileInstancedMesh.instanceMatrix.needsUpdate = true;

    // Ikeda: color is static white — no per-frame color updates needed
    fileInstancedMesh.setColorAt(id, new THREE.Color(0xffffff));
    fileInstancedMesh.instanceColor.needsUpdate = true;

    if (fileNode.pendingRemoval && fileNode.currentAlpha < 0.02) {
        fileNode.instanceId = undefined;
        fileInstanceNodes[id] = null;
        // Hide by setting scale to 0
        fileInstancedMesh.setMatrixAt(id, new THREE.Matrix4());
        fileInstancedMesh.instanceMatrix.needsUpdate = true;
        // Mark for tree removal (deferred to avoid forEach mutation during updateAllMeshes walk)
        if (fileNode.parentDir) fileNode.parentDir.pendingRemovalFiles = fileNode.parentDir.pendingRemovalFiles || [];
        fileNode.parentDir.pendingRemovalFiles.push(fileNode.fullPath);
    }
}

function removeFileInstance(fileNode) {
    if (fileNode.instanceId !== undefined) {
        const id = fileNode.instanceId;
        fileInstancedMesh.setMatrixAt(id, new THREE.Matrix4());
        fileInstancedMesh.instanceMatrix.needsUpdate = true;
        fileInstanceNodes[id] = null;
    }
    fileNode.instanceId = undefined;
    fileNode.mesh = null;
}

function createDirMesh(dirNode) {
    const geometry = new THREE.SphereGeometry(0.5, SPHERE_SEGMENTS, SPHERE_SEGMENTS / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { type: 'Directory', nodeData: dirNode, depthLevel: dirNode.depth };
    scene.add(mesh);
    pickableObjects.push(mesh);
    dirNode.mesh = mesh;
    const s = DIR_SPHERE_RADIUS;
    mesh.scale.set(s, s, s);
    mesh.position.set(dirNode.targetPos.x, s / 2, dirNode.targetPos.z);
}

function createGround(size) {
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.1;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
}

// === Mesh updates ===

function updateDirMesh(dirNode, dt) {
    const mesh = dirNode.mesh;
    if (!mesh) return;
    const targetScale = DIR_SPHERE_RADIUS;
    mesh.scale.x = THREE.MathUtils.lerp(mesh.scale.x, targetScale, DIR_LAYOUT_LERP);
    mesh.scale.y = THREE.MathUtils.lerp(mesh.scale.y, targetScale, DIR_LAYOUT_LERP);
    mesh.scale.z = THREE.MathUtils.lerp(mesh.scale.z, targetScale, DIR_LAYOUT_LERP);
    mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, dirNode.targetPos.x, DIR_LAYOUT_LERP);
    mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, dirNode.targetPos.z, DIR_LAYOUT_LERP);
    mesh.position.y = mesh.scale.y / 2;
}

function updateAllMeshes(dt) {
    if (!root) return;

    function walk(node) {
        if (node.isDirectory) {
            node.childDirectories.forEach(child => {
                if (!child.mesh) createDirMesh(child);
                walk(child);
            });
            node.childFiles.forEach(f => {
                if (f.instanceId === undefined && !f.pendingRemoval) addFileInstance(f);
                if (f.mesh) updateFileMesh(f, dt);
            });
        }
    }

    root.childFiles.forEach(f => {
        if (f.instanceId === undefined && !f.pendingRemoval) addFileInstance(f);
        if (f.mesh) updateFileMesh(f, dt);
    });
    root.childDirectories.forEach(d => {
        if (!d.mesh) createDirMesh(d);
        walk(d);
    });

    // Update user mesh positions
    users.forEach(userNode => {
        if (userNode.mesh) {
            userNode.mesh.position.copy(userNode.pos);
        }
    });

    updateRoadLines();

    // Process deferred file tree removals (from updateFileMesh cleanup)
    // This runs after the forEach walk to avoid mutation during iteration
    if (root) {
        (function processRemovals(node) {
            if (node.isDirectory) {
                if (node.pendingRemovalFiles && node.pendingRemovalFiles.length > 0) {
                    for (const filepath of node.pendingRemovalFiles) {
                        removeFileFromTree(filepath);
                    }
                    node.pendingRemovalFiles = [];
                }
                node.childDirectories.forEach(child => processRemovals(child));
            }
        })(root);
    }
}

// === Road (connection line) rendering ===

// === Branch support: side-by-side tree offsetting ===
// After calculateOrbitalLayout positions branch subtrees on concentric rings,
// we offset them horizontally to place them side-by-side rather than
// angularly around the root. This gives a cleaner split-screen view.

function computeSubtreeBounds(node) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    (function walk(n) {
        if (!n || !n.targetPos) return;
        minX = Math.min(minX, n.targetPos.x);
        maxX = Math.max(maxX, n.targetPos.x);
        minZ = Math.min(minZ, n.targetPos.z);
        maxZ = Math.max(maxZ, n.targetPos.z);
        if (n.isDirectory) {
            n.childFiles.forEach(walk);
            n.childDirectories.forEach(walk);
        }
    })(node);
    return { minX, maxX, minZ, maxZ };
}

function offsetSubtreePositions(node, dx, dy, dz) {
    if (!node || !node.targetPos) return;
    node.targetPos.x += dx;
    node.targetPos.y += dy;
    node.targetPos.z += dz;
    if (node.isDirectory) {
        node.childFiles.forEach(n => offsetSubtreePositions(n, dx, dy, dz));
        node.childDirectories.forEach(n => offsetSubtreePositions(n, dx, dy, dz));
    }
}

function offsetBranchTrees() {
    if (!root || !root.childDirectories) return;

    // Only offset directories that correspond to actual non-primary branch names
    // from the loaded logs. The primary branch has no prefix directory.
    const branchNames = loadedBranches.filter(b => b !== (primaryBranch || 'main'));
    const branchDirs = root.childDirectories.filter(d => d.name && branchNames.includes(d.name));
    if (branchNames.length === 0) return; // No secondary branches

    // Sort: main first if present, then alphabetical
    branchDirs.sort((a, b) => {
        if (a.name === 'main') return -1;
        if (b.name === 'main') return 1;
        return a.name.localeCompare(b.name);
    });

    const PADDING = 600;
    let currentX = 0;

    branchDirs.forEach(dir => {
        const bounds = computeSubtreeBounds(dir);
        const width = bounds.maxX - bounds.minX;
        const depth = bounds.maxZ - bounds.minZ;
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerZ = (bounds.minZ + bounds.maxZ) / 2;

        // Center this subtree on the current slot
        const targetCenterX = currentX + width / 2;
        const offsetX = targetCenterX - centerX;
        const offsetZ = -centerZ; // Center on z=0

        offsetSubtreePositions(dir, offsetX, 0, offsetZ);

        currentX = targetCenterX + width / 2 + PADDING;
    });
}

function createRoadLines() {
    // Dispose existing lines
    roadLines.forEach(line => {
        if (line.geometry) line.geometry.dispose();
        if (line.material) line.material.dispose();
        scene.remove(line);
    });
    roadLines = [];

    if (!root || !scene) return;

    function walk(node) {
        if (!node.isDirectory) return;
        node.childDirectories.forEach(child => {
            if (!child.targetPos) return;
            const startY = DIR_SPHERE_RADIUS / 2 + 0.5;
            const endY = DIR_SPHERE_RADIUS / 2 + 0.5;
            const geometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(node.targetPos.x, startY, node.targetPos.z),
                new THREE.Vector3(child.targetPos.x, endY, child.targetPos.z),
            ]);
            const material = new THREE.LineBasicMaterial({
                color: ROAD_COLOR,
                transparent: true,
                opacity: ROAD_OPACITY,
                depthWrite: false,
                toneMapped: false,
            });
            const line = new THREE.Line(geometry, material);
            line.userData = { parent: node, child: child };
            scene.add(line);
            roadLines.push(line);
            walk(child);
        });
    }

    walk(root);
}

function updateRoadLines() {
    if (roadLines.length === 0) return;
    for (const line of roadLines) {
        const parent = line.userData.parent;
        const child = line.userData.child;
        if (!parent || !child || !parent.targetPos || !child.targetPos) continue;
        const positions = line.geometry.attributes.position.array;
        positions[0] = parent.targetPos.x;
        positions[1] = DIR_SPHERE_RADIUS / 2 + 0.5;
        positions[2] = parent.targetPos.z;
        positions[3] = child.targetPos.x;
        positions[4] = DIR_SPHERE_RADIUS / 2 + 0.5;
        positions[5] = child.targetPos.z;
        line.geometry.attributes.position.needsUpdate = true;
    }
}

// === User management ===

// Action type colours: distinguish add/mod/modify actions visually
const ACTION_COLOURS = {
    A: new THREE.Color(0x4488ff),  // Added   — blue (new growth)
    M: new THREE.Color(0xaa44ff),  // Modified — purple (change)
    D: new THREE.Color(0xff4444),  // Deleted  — red (removal)
};

function createUser(name) {
    const r = 300 * GLOBAL_SCALE;
    const h = 200 * GLOBAL_SCALE;
    const segs = 6;

    // Black fill cone (on top — covers beam origins so beams appear to emanate from behind)
    const fillGeo = new THREE.ConeGeometry(r, h, segs);
    const fillMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true, opacity: 1, side: THREE.DoubleSide,
    });
    fillMat.depthWrite = false;
    const mesh = new THREE.Mesh(fillGeo, fillMat);
    mesh.renderOrder = 1;
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);

    // White outline cone (slightly larger, BackSide so we see the outline edge)
    const outlineGeo = new THREE.ConeGeometry(r * 1.1, h * 1.1, segs);
    const outlineMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true, opacity: 1, side: THREE.BackSide,
    });
    outlineMat.depthWrite = false;
    const outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
    outlineMesh.renderOrder = 1;
    mesh.add(outlineMesh); // Child follows parent position/rotation

    const userNode = {
        name, mesh,
        pos: new THREE.Vector3(0, USER_HEIGHT, 0),
        actions: [], lastActionTime: simTime,
        currentAlpha: 1, targetAlpha: 1, fadingOut: false,
        outlineMesh,
    };
    users.set(name, userNode);
    return userNode;
}

function getOrCreateUser(name) {
    let user = users.get(name);
    if (!user) user = createUser(name);
    return user;
}

function updateUserAvatars(dt) {
    const now = simTime;
    users.forEach((userNode, name) => {
        const mesh = userNode.mesh;
        if (!mesh) return;

        const idleTime = now - userNode.lastActionTime;
        if (userNode.actions.length === 0 && idleTime > USER_IDLE_TIME && !userNode.fadingOut) {
            userNode.targetAlpha = 0;
            userNode.fadingOut = true;
        }

        userNode.currentAlpha = THREE.MathUtils.lerp(userNode.currentAlpha, userNode.targetAlpha, 0.1);
        mesh.material.opacity = userNode.currentAlpha;
        mesh.material.needsUpdate = true;
        if (userNode.outlineMesh && userNode.outlineMesh.material) {
            userNode.outlineMesh.material.opacity = userNode.currentAlpha;
            userNode.outlineMesh.material.needsUpdate = true;
        }

        if (userNode.actions.length > 0) {
            // Weighted average toward the files touched in this batch,
            // with a small pull toward the root/center anchor. This keeps
            // the committor migrating toward the files it's touching with
            // the beams rather than sitting dead-center, while still
            // preventing wild excursions when a batch spans many files
            // spread across the entire tree (e.g., a fresh repo with all
            // commits at the same timestamp = one giant batch).
            const firstBatchTs = userNode.actions[0].batchTs;
            const batchFiles = [];
            for (let ai = 0; ai < userNode.actions.length; ai++) {
                if (userNode.actions[ai].batchTs === firstBatchTs) {
                    batchFiles.push(userNode.actions[ai].fileNode);
                } else {
                    break;  // Actions are in order; stop at next batch
                }
            }
            // Limit to the most recent files so the target migrates toward
            // where the user is actively touching files, rather than averaging
            // all files in a potentially huge batch (which sits near the
            // center of mass and makes the committor appear stuck at center).
            const MAX_BATCH_FILES = 15;
            const effectiveFiles = batchFiles.slice(Math.max(0, batchFiles.length - MAX_BATCH_FILES));
            // Compute average of file positions
            const fileAvg = new THREE.Vector3(0, 0, 0);
            let count = 0;
            for (const fileNode of effectiveFiles) {
                if (fileNode && fileNode.targetPos) {
                    const fileHeight = fileNode.buildingHeight || 0;
                    fileAvg.x += fileNode.targetPos.x;
                    fileAvg.y += USER_HEIGHT + fileHeight;
                    fileAvg.z += fileNode.targetPos.z;
                    count++;
                }
            }
            // Weighted average toward the files touched in this batch,
            // with a small pull toward the root/center anchor. This keeps
            // the committor migrating toward the files it's touching with
            // the beams rather than sitting dead-center, while still
            // preventing wild excursions when a batch spans many files
            // spread across the entire tree (e.g., a fresh repo with all
            // commits at the same timestamp = one giant batch).
            const FILE_PULL = 0.95;  // 95% toward files, 5% toward center anchor
            let avgPos;
            if (count > 0) {
                fileAvg.x /= count;
                fileAvg.y /= count;
                fileAvg.z /= count;
                avgPos = new THREE.Vector3(
                    fileAvg.x * FILE_PULL + 0 * (1 - FILE_PULL),
                    fileAvg.y * FILE_PULL + USER_HEIGHT * (1 - FILE_PULL),
                    fileAvg.z * FILE_PULL + 0 * (1 - FILE_PULL)
                );
            } else {
                avgPos = new THREE.Vector3(0, USER_HEIGHT, 0);
            }
            const dir = new THREE.Vector3().subVectors(avgPos, userNode.pos);
            const dist = dir.length();
            if (dist > 2) {
                dir.normalize();
                userNode.pos.add(dir.clone().multiplyScalar(dt * USER_SPEED));
            } else {
                // Reached average position — clear entire batch
                for (let i = 0; i < batchFiles.length; i++) userNode.actions.shift();
            }
        }

        mesh.position.copy(userNode.pos);

        if (userNode.fadingOut && userNode.currentAlpha < 0.02) {
            scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            users.delete(name);
        }
    });
}

// === Beam actions ===

function createBeamAction(userNode, fileNode, actionType) {
    const colour = ACTION_COLOURS[actionType] || new THREE.Color(0xffffff);
    const material = new THREE.LineBasicMaterial({
        color: colour, transparent: true, opacity: 0, linewidth: BEAM_LINE_WIDTH,
        blending: THREE.AdditiveBlending,  // Glow/emission effect on black background
    });
    material.depthWrite = false;
    const geometry = new THREE.BufferGeometry();
    const beam = new THREE.Line(geometry, material);
    beam.renderOrder = 0;  // Behind committor (renderOrder=1)
    scene.add(beam);

    // Glow sphere at file endpoint — emissive, additive for "impact" effect
    const glowSphere = new THREE.Mesh(
        new THREE.SphereGeometry(3, 8, 6),
        new THREE.MeshBasicMaterial({
            color: colour, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        })
    );
    glowSphere.renderOrder = 2;
    scene.add(glowSphere);

    // Store directory node references (not positions) so the beam path updates
    // dynamically each frame as the orbital layout settles.
    // Trace from file's parent up to root: root → dir1 → dir2 → ... → file
    let pathNodes = null;
    if (BEAM_FOLLOW_TREE && fileNode.parentDir) {
        pathNodes = [];
        let dir = fileNode.parentDir;
        while (dir && dir !== root) {
            pathNodes.unshift(dir);
            dir = dir.parentDir;
        }
        // Only use tree path if there are intermediate directories
        if (pathNodes.length === 0) pathNodes = null;
    }

    // Compute lateral offset perpendicular to beam direction so overlapping
    // beams on the same tree path don't blend into a white blob.
    // Group by file path so all beams to the same file get distinct offsets.
    // Hash the file path to determine offset direction (stable, frame-independent).
    const offsetKey = fileNode.fullPath || fileNode.name;
    const offsetIdx = (_beamOffsetMap.get(offsetKey) || 0);
    _beamOffsetMap.set(offsetKey, offsetIdx + 1);
    // Hash file path for base offset direction (stable, frame-independent).
    let hash = 0;
    for (let hi = 0; hi < offsetKey.length; hi++) {
        hash = ((hash << 5) - hash + offsetKey.charCodeAt(hi)) | 0;
    }
    const baseAngle = (hash / 0x10000000) * Math.PI * 2;
    // Cycle through 12 distinct directions (30° apart) + expanding rings
    // Base magnitude 4 ensures rounded offsets are unique across all 12 directions
    // (at mag=2, adjacent angles near quadrant boundaries rounded to same value).
    // Ring 0: 12 dirs at radius 4, Ring 1: 12 dirs at 6.5, Ring 2: 12 dirs at 9, etc.
    const dirFromIdx = offsetIdx % 12;
    const ringIdx = Math.floor(offsetIdx / 12);
    const offsetAngle = baseAngle + (dirFromIdx * Math.PI / 6);
    const mag = 4 + ringIdx * 2.5;
    const beamOffset = new THREE.Vector3(
        Math.cos(offsetAngle) * mag,
        0,
        Math.sin(offsetAngle) * mag
    );

    beamActions.push({
        user: userNode, file: fileNode, beam, glowSphere,
        progress: 0, duration: BEAM_DURATION, actionType,
        pathNodes: pathNodes, beamOffset: beamOffset,
    });
}

function updateBeamActions(dt) {
    const roadY = DIR_SPHERE_RADIUS / 2 + 0.5;
    const propThreshold = BEAM_PROPAGATION_TIME;  // 15% of progress for fast appear
    for (let i = beamActions.length - 1; i >= 0; i--) {
        const ba = beamActions[i];
        ba.progress += dt / ba.duration;
        if (ba.progress >= 1.0) {
            scene.remove(ba.beam);
            ba.beam.geometry.dispose();
            ba.beam.material.dispose();
            if (ba.glowSphere) {
                scene.remove(ba.glowSphere);
                ba.glowSphere.geometry.dispose();
                ba.glowSphere.material.dispose();
            }
            beamActions.splice(i, 1);
            continue;
        }

        let points;
        if (ba.pathNodes) {
            // Tree-following beam: rebuild path each frame from node references
            // so it tracks layout updates as the tree settles into position
            const pts = [];
            pts.push(new THREE.Vector3(0, roadY, 0));  // root at road level
            for (const d of ba.pathNodes) {
                if (d.targetPos) {
                    pts.push(new THREE.Vector3(d.targetPos.x, roadY, d.targetPos.z));
                }
            }
            const fileHeight = Math.max(ba.file.buildingHeight || 0, 0.1);
            pts.push(new THREE.Vector3(
                ba.file.targetPos.x,
                fileHeight / 2,
                ba.file.targetPos.z
            ));
            // Fast propagation: beam grows along tree path quickly then stays full
            const t = ba.progress;
            const n = pts.length;
            let cutoff;
            if (t < propThreshold) {
                const propT = t / propThreshold;
                cutoff = Math.min(n, Math.floor(propT * (n - 1)) + 2);
            } else {
                cutoff = n;
            }
            points = pts.slice(0, cutoff);
        } else {
            // Direct beam fallback (root-level files or BEAM_FOLLOW_TREE=false)
            const userPos = ba.user.pos.clone();  // Clone — beam offset must NOT mutate user pos
            const filePos = new THREE.Vector3(
                ba.file.targetPos.x,
                Math.max(ba.file.buildingHeight, 0.1) / 2,
                ba.file.targetPos.z
            );
            points = [userPos, filePos];
        }

        // Apply lateral offset to separate overlapping beams on the same path
        if (ba.beamOffset && (ba.beamOffset.x !== 0 || ba.beamOffset.z !== 0)) {
            for (let j = 0; j < points.length; j++) {
                points[j].x += ba.beamOffset.x;
                points[j].z += ba.beamOffset.z;
            }
        }

        ba.beam.geometry.dispose();
        ba.beam.geometry = new THREE.BufferGeometry().setFromPoints(points);

        // Fast fade-in during propagation, slow fade-out after
        let opacity;
        if (ba.progress < propThreshold) {
            opacity = BEAM_OPACITY * (ba.progress / propThreshold);
        } else {
            const fadeT = (ba.progress - propThreshold) / (1 - propThreshold);
            opacity = BEAM_OPACITY * (1 - fadeT);
        }
        ba.beam.material.opacity = opacity;
        ba.beam.material.needsUpdate = true;

        // Update glow sphere at file endpoint (offset to match beam)
        if (ba.glowSphere) {
            const fileHeight = Math.max(ba.file.buildingHeight || 0, 0.1);
            let gx = ba.file.targetPos.x;
            let gz = ba.file.targetPos.z;
            if (ba.beamOffset && (ba.beamOffset.x !== 0 || ba.beamOffset.z !== 0)) {
                gx += ba.beamOffset.x;
                gz += ba.beamOffset.z;
            }
            ba.glowSphere.position.set(gx, fileHeight / 2, gz);
            // Pulse glow sphere during propagation, then fade
            let glowScale = 1;
            if (ba.progress < propThreshold) {
                glowScale = 0.5 + 0.5 * (ba.progress / propThreshold);
            }
            ba.glowSphere.scale.set(glowScale, glowScale, glowScale);
            ba.glowSphere.material.opacity = opacity * 0.8;
            ba.glowSphere.material.needsUpdate = true;
        }
    }
}

// === Log parsing ===

function parseLogEntry(line) {
    const parts = line.trim().split('|');
    if (parts.length < 5) return null;
    return {
        timestamp: parseInt(parts[0], 10),
        username: parts[1],
        action: parts[2],
        filepath: parts[3],
        loc: parseInt(parts[4], 10),
        count: parts[5] ? parseInt(parts[5], 10) : 1,
        colour: parts[6] || '',
        branch: parts[7] || 'main',
    };
}

async function loadLog(url, branchName = 'main') {
    loadingElement.textContent = 'Loading log...';
    loadingElement.style.display = 'block';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load log: ${response.status}`);
    const text = await response.text();
    const rawEntries = text.trim().split('\n')
        .map(parseLogEntry).filter(e => e !== null);
    rawEntries.forEach(e => {
        // Use branch field from the entry itself; fall back to branchName param
        if (!e.branch) e.branch = branchName;
    });
    rawEntries.sort((a, b) => a.timestamp - b.timestamp);
    logEntries.push(...rawEntries);
    // Track unique branch names for branch-aware layout
    rawEntries.forEach(e => {
        if (!loadedBranches.includes(e.branch)) loadedBranches.push(e.branch);
    });
    // First log loaded becomes the primary (unprefixed) branch
    if (rawEntries.length > 0 && primaryBranch === null) {
        primaryBranch = rawEntries[0].branch;
    }
    console.log(`phource: loaded ${logEntries.length} log entries (from ${url}, branch=${branchName})`);
    return rawEntries;
}

// === Simulation ===

function processCommit(entry) {
    const userNode = getOrCreateUser(entry.username);
    userNode.lastActionTime = simTime;
    userNode.targetAlpha = 1;
    userNode.fadingOut = false;

    // Prefix filepath with branch name so non-primary branches get separate trees
    // under their own top-level directories (e.g., "feature-branch/src/file.js")
    // The primary branch (first loaded) has no prefix — its files live at root.
    const branch = entry.branch || primaryBranch || 'main';
    const filePath = branch !== (primaryBranch || 'main') ? branch + '/' + entry.filepath : entry.filepath;

    let fileNode = null;
    if (entry.action === 'A') {
        fileNode = addFileToTree(filePath, entry.loc, entry.count, entry.colour, 'A');
    } else if (entry.action === 'M') {
        fileNode = fileMap.get(filePath);
        if (fileNode) {
            fileNode.loc = entry.loc;
            fileNode.count = entry.count;
            fileNode.colourHex = entry.colour || '';
            fileNode.actionType = 'M';
            // Re-activate file that was previously deleted
            fileNode.targetAlpha = 1;
            fileNode.fadingOut = false;
            fileNode.pendingRemoval = false;
            const dims = calculateFileDimensions(entry.loc, entry.count);
            fileNode.buildingWidth = dims.width;
            fileNode.buildingDepth = dims.depth;
            fileNode.buildingHeight = dims.height;
            fileNode.forceSize = Math.min(Math.max(dims.width, dims.depth), 100);
            // No treeDirty — forceSize updated directly, simulation handles it
        } else {
            fileNode = addFileToTree(filePath, entry.loc, entry.count, entry.colour, 'M');
        }
    } else if (entry.action === 'D') {
        fileNode = fileMap.get(filePath);
        if (fileNode) {
            if (!isScrubbing) createBeamAction(userNode, fileNode, 'D');
            fileNode.targetAlpha = 0;
            fileNode.fadingOut = true;
            fileNode.pendingRemoval = true;
            // Do NOT call removeFileFromTree here — keeping the file in
            // childFiles lets updateFileMesh fade out the instance properly.
            // cleanupTreeRemoveFile handles tree removal after fade-out.
        }
    }

    if (fileNode && entry.action !== 'D') {
        if (!isScrubbing) {
            userNode.actions.push({ fileNode, actionType: entry.action, batchTs: entry.timestamp });
            createBeamAction(userNode, fileNode, entry.action);
        }
    }
    userNode.lastActionTime = simTime;
}

function updateSimulation(dt) {
    if (!simStarted || !logEntries.length) return;

    _timeSinceLastCommit += dt;

    if (commitIndex < logEntries.length && _timeSinceLastCommit >= SECONDS_PER_COMMIT) {
        // Process all commits at the current timestamp (batch)
        const currentTs = logEntries[commitIndex].timestamp;
        while (commitIndex < logEntries.length &&
               logEntries[commitIndex].timestamp <= currentTs + 1) {
            processCommit(logEntries[commitIndex]);
            commitIndex++;
        }
        simTime = currentTs;
        _timeSinceLastCommit = 0;

        if (treeDirty) {
            rebuildLayout();
            cameraNeedsAutoFit = true;
        }

        // Predictive camera zoom: look ahead at upcoming commits
        predictCameraZoom();
    }

    // Stop simulation when all commits are processed
    if (commitIndex >= logEntries.length && !simPaused) {
        simPaused = true;
        updatePlayPauseButton();
        // Once all commits are processed, run thorough async physics settling
        // to find the natural tree shape (chunked to keep animation responsive)
        settleCompleteLayout();
    }

    if (treeDirty) {
        rebuildLayout();
        cameraNeedsAutoFit = true;
    }

    // Recalculate heat colors for all files
    for (const fileNode of fileMap.values()) {
        if (!fileNode.pendingRemoval) {
            fileNode.heat = fileNode.count / Math.max(maxCommitCount, 1);
        }
    }

    if (commitIndex > 0 && dateElement) {
        dateElement.textContent = formatDate(simTime);
    }
}

// === Interaction ===

function onMouseMove(event) {
    if (!mouse || !tooltipElement) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    tooltipElement.style.left = (event.clientX + 15) + 'px';
    tooltipElement.style.top = (event.clientY + 15) + 'px';
    updateTooltip();
}

function updateTooltip() {
    if (!raycaster || !mouse || !camera || !tooltipElement) return;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(pickableObjects, false);
    let nodeData = null;
    let type = null;
    // Try direct raycast hit — skip invisible InstancedMesh instances
    for (let i = 0; i < intersects.length; i++) {
        const hit = intersects[i];
        if (hit.instanceId !== undefined) {
            if (fileInstanceNodes[hit.instanceId]) {
                nodeData = fileInstanceNodes[hit.instanceId];
                type = 'File';
                break;
            }
        } else if (hit.object && hit.object.userData && hit.object.userData.nodeData) {
            nodeData = hit.object.userData.nodeData;
            type = hit.object.userData.type;
            break;
        }
    }
    // Fallback: proximity check for directory spheres (too small to reliably raycast at distance)
    // Always run this — the raycast may hit an occluding file instance or miss the tiny sphere entirely
    const PROXIMITY_PIXELS = 30; // forgiveness zone: 30px radius regardless of screen size
    let closest = null;
    let closestDist = Infinity;
    for (let i = 0; i < pickableObjects.length; i++) {
        const obj = pickableObjects[i];
        if (obj.userData && obj.userData.type === 'Directory' && obj.userData.nodeData) {
            const pos = new THREE.Vector3();
            obj.getWorldPosition(pos);
            const ndc = pos.clone().project(camera);
            const screenX = ((ndc.x + 1) / 2) * window.innerWidth;
            const screenY = ((-ndc.y + 1) / 2) * window.innerHeight;
            const mouseScreenX = ((mouse.x + 1) / 2) * window.innerWidth;
            const mouseScreenY = ((-mouse.y + 1) / 2) * window.innerHeight;
            const dist = Math.sqrt(
                Math.pow(screenX - mouseScreenX, 2) + Math.pow(screenY - mouseScreenY, 2)
            );
            if (dist < PROXIMITY_PIXELS && dist < closestDist) {
                closestDist = dist;
                closest = obj;
            }
        }
    }
    // Prefer directory hit if mouse is very close (within 10px — likely directly over the sphere)
    if (closest && closestDist < 10) {
        nodeData = closest.userData.nodeData;
        type = 'Directory';
    } else if (closest && !nodeData) {
        // Only use proximity directory if raycast found nothing
        nodeData = closest.userData.nodeData;
        type = 'Directory';
    }
    if (nodeData !== intersectedObject) {
        intersectedObject = nodeData;
        const data = nodeData;
        if (data) {
            const fullPath = data.fullPath || data.name || 'N/A';
            let html = `<strong>${data.name || 'Unnamed'}</strong><ul>`;
            html += `<li>${fullPath === '(root)' ? '/ (Project Root)' : fullPath}</li>`;
            if (type === 'File') {
                html += `<li>${data.loc} lines of code</li>`;
                html += `<li>${data.count} commits</li>`;
                html += `<li>Heat: ${(data.heat || 0).toFixed(2)}</li>`;
            }
            if (type === 'Directory') {
                html += `<li>${data.loc} total LOC</li>`;
                html += `<li>${data.count} total commits</li>`;
            }
            html += `</ul>`;
            tooltipElement.style.display = 'block';
            tooltipElement.innerHTML = html;
        } else {
            tooltipElement.style.display = 'none';
            intersectedObject = null;
        }
    }
}

function onWindowResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// === Initialization ===

function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    // Ikeda aesthetic: no fog — crisp mathematical precision in a pure void

    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(75, aspect, 5, 500000);

    const canvas = document.getElementById('canvas');
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas, logarithmicDepthBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = false;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 10;
    controls.maxDistance = 500000;
    controls.maxPolarAngle = Math.PI;

    // Remap mouse controls: LEFT=pan, MIDDLE=pan, RIGHT=orbit
    // (was: LEFT=orbit, RIGHT=pan, MIDDLE=pand)
    controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
    };
    // Prevent browser context menu on right-click (now used for orbit)
    renderer.domElement.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    });

    // Track user interaction to avoid overriding manual camera adjustments
    ['pointerdown', 'wheel', 'touchstart'].forEach(evt => {
        renderer.domElement.addEventListener(evt, () => {
            lastUserInteraction = performance.now();
        });
    });

    // Ikeda aesthetic: no lighting — pure data forms in void

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2(-1000, -1000);
    tooltipElement = document.getElementById('tooltip');
    loadingElement = document.getElementById('loading-message');
    if (!loadingElement) {
        loadingElement = document.createElement('div');
        loadingElement.id = 'loading-message';
        loadingElement.style.position = 'absolute';
        loadingElement.style.top = '50%'; loadingElement.style.left = '50%';
        loadingElement.style.transform = 'translate(-50%, -50%)';
        loadingElement.style.color = 'white';
        loadingElement.style.fontFamily = 'Arial, sans-serif';
        loadingElement.style.fontSize = '20px';
        document.body.appendChild(loadingElement);
    }
    loadingElement.style.display = 'block';
    dateElement = document.getElementById('date-display');

    // === Scrubber setup ===
    scrubberElement = document.getElementById('time-scrubber');
    scrubberDateElement = document.getElementById('scrubber-date');
    const scrubberContainer = document.getElementById('scrubber-container');

    if (scrubberElement) {
        let lastScrubTime = 0;
        scrubberElement.addEventListener('input', function() {
            const now = Date.now();
            if (now - lastScrubTime < 200) return;
            lastScrubTime = now;
            const value = parseInt(scrubberElement.value, 10);
            const fraction = value / 1000;
            const targetTime = minTimestamp + (maxTimestamp - minTimestamp) * fraction;
            isScrubbing = true;
            resetToTime(targetTime);
            if (scrubberDateElement) {
                scrubberDateElement.textContent = formatDate(targetTime);
            }
        });

        scrubberElement.addEventListener('change', function() {
            // Always process the final position on release
            const value = parseInt(scrubberElement.value, 10);
            const fraction = value / 1000;
            const targetTime = minTimestamp + (maxTimestamp - minTimestamp) * fraction;
            resetToTime(targetTime);
            if (scrubberDateElement) {
                scrubberDateElement.textContent = formatDate(targetTime);
            }
            isScrubbing = false;
            simPaused = true;
            updatePlayPauseButton();
        });

        // Play/pause button
        const playPauseBtn = document.getElementById('play-pause-btn');
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', function() {
                simPaused = !simPaused;
                if (!simPaused && commitIndex >= logEntries.length) {
                    simTime = minTimestamp;
                    commitIndex = 0;
                    resetToTime(minTimestamp);
                }
                updatePlayPauseButton();
            });
        }

        // Show scrubber on mouse hover near bottom of screen
        let scrubberHoverTimer = null;
        const canvasParent = renderer.domElement.parentElement;
        if (canvasParent) {
            canvasParent.addEventListener('mousemove', function(e) {
                if (e.clientY > window.innerHeight - 80) {
                    if (scrubberHoverTimer) clearTimeout(scrubberHoverTimer);
                    if (scrubberContainer) scrubberContainer.classList.remove('hidden');
                    scrubberHoverTimer = setTimeout(() => {
                        if (scrubberContainer) scrubberContainer.classList.add('hidden');
                    }, 3000);
                }
            });
        }
    }

    window.addEventListener('mousemove', onMouseMove, false);
    window.addEventListener('resize', onWindowResize, false);
    clock = new THREE.Clock();
}

function createInitialMeshes() {
    if (!root) return;
    initFileInstancedMesh();
    function walk(node) {
        if (node.isDirectory) {
            if (node.depth > 0 && !node.mesh) createDirMesh(node);
            node.childDirectories.forEach(walk);
            node.childFiles.forEach(f => { if (f.instanceId === undefined && !f.pendingRemoval) addFileInstance(f); });
        }
    }
    walk(root);
}

function positionCamera() {
    if (!root) return;
    // Compute bounds from actual positions (accounts for branch offsets)
    const bounds = computeSubtreeBounds(root);
    const w = bounds.maxX - bounds.minX || root.calculatedOuterWidth || 100;
    const d = bounds.maxZ - bounds.minZ || root.calculatedOuterDepth || 100;
    const camDistance = Math.max(w, d) * 0.8;
    // Top-down view: camera directly above looking straight down (Ikeda monochrome aesthetic)
    camera.position.set(0, camDistance, 0);
    // Center camera target on the midpoint of both branch trees
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    controls.target.set(centerX, 0, centerZ);
    controls.update();
}

// === Predictive Camera Zoom ===
// Looks ahead at upcoming commits to estimate future scene bounds and
// lerps the camera zoom accordingly so the tree never shrinks out of view.
function predictCameraZoom() {
    if (!root || commitIndex >= logEntries.length) {
        _cameraTargetY = null;
        return;
    }

    const bounds = computeSubtreeBounds(root);
    const w = (bounds.maxX - bounds.minX) || root.calculatedOuterWidth || 100;
    const d = (bounds.maxZ - bounds.minZ) || root.calculatedOuterDepth || 100;
    const currentDistance = Math.max(w, d) * 0.8;

    // Look ahead at next 5 commits to predict growth
    const lookahead = 5;
    let maxFutureDistance = currentDistance;
    for (let i = 0; i < lookahead && commitIndex + i < logEntries.length; i++) {
        const futureEntry = logEntries[commitIndex + i];
        const branch = futureEntry.branch || primaryBranch || 'main';
        const futurePath = branch !== (primaryBranch || 'main') ? branch + '/' + futureEntry.filepath : futureEntry.filepath;
        const futureNode = getNodeByPath(futurePath);
        if (futureNode && futureNode.isDirectory) {
            // Estimate this directory's eventual radius based on depth
            const futureRadius = futureNode.depth * ORBIT_DIR_RADIUS;
            maxFutureDistance = Math.max(maxFutureDistance, futureRadius * 1.2);
        }
    }

    // Also factor in overall growth trend: remaining commits likely expand tree
    const remaining = logEntries.length - commitIndex;
    const total = logEntries.length;
    const growthPadding = (remaining / total) * 0.4;  // up to 40% extra on first commit

    // Account for deepest future directory — ensures camera zooms far enough
    // to see all files even in large repos where deep directories appear later
    const futureMaxDepth = _maxDirDepthRemaining[commitIndex] || 0;
    const futureMaxRadius = futureMaxDepth * ORBIT_DIR_RADIUS;
    const targetDistance = Math.max(currentDistance, futureMaxRadius * 1.2) * (1 + growthPadding);

    // Trigger Disney bounce zoom when camera needs to make a significant jump
    // to reach the new target (compares target to current camera position,
    // not to previous target — catches accumulated growth over multiple commits)
    if (!_bounceActive && camera && (performance.now() - _lastBounceEndTime > BOUNCE_COOLDOWN)) {
        const effectiveTarget = Math.max(currentDistance, targetDistance);
        const camY = camera.position.y;
        const moveRatio = Math.abs(effectiveTarget - camY) / Math.max(camY, 1);
        if (moveRatio > BOUNCE_THRESHOLD) {
            _bounceActive = true;
            _bounceStartTime = performance.now();
            _bounceTargetY = effectiveTarget;
            _bounceAmplitude = effectiveTarget * BOUNCE_OVERSHOOT;
            _lastBounceEndTime = 0; // reset cooldown
        }
    }

    _lastPredictY = targetDistance;

    _cameraTargetY = targetDistance;
    cameraNeedsAutoFit = true;
}

// === Time scrubber ===

function cleanupScene() {
    // Dispose InstancedMesh for file spheres
    if (fileInstancedMesh) {
        scene.remove(fileInstancedMesh);
        fileInstancedMesh.geometry.dispose();
        fileInstancedMesh.material.dispose();
        const pIndex = pickableObjects.indexOf(fileInstancedMesh);
        if (pIndex !== -1) pickableObjects.splice(pIndex, 1);
        fileInstancedMesh = null;
    }
    fileInstanceCount = 0;
    fileInstanceNodes.length = 0;

    // Remove Directory sphere meshes from the scene
    for (let i = scene.children.length - 1; i >= 0; i--) {
        const child = scene.children[i];
        if (child.userData && child.userData.type === 'Directory') {
            scene.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
    }
    // Clear pickableObjects (will be rebuilt by createInitialMeshes)
    pickableObjects.length = 0;

    // Remove user meshes (including outline child meshes)
    users.forEach(userNode => {
        if (userNode.mesh) {
            scene.remove(userNode.mesh);
            // Traverse and dispose all children (outline mesh, etc.)
            userNode.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            userNode.mesh = null;
            userNode.outlineMesh = null;
        }
    });

    // Remove beam action meshes
    beamActions.forEach(ba => {
        if (ba.beam) {
            scene.remove(ba.beam);
            if (ba.beam.geometry) ba.beam.geometry.dispose();
            if (ba.beam.material) {
                if (Array.isArray(ba.beam.material)) {
                    ba.beam.material.forEach(m => m.dispose());
                } else {
                    ba.beam.material.dispose();
                }
            }
        }
    });
    roadLines.forEach(line => {
        scene.remove(line);
        if (line.geometry) line.geometry.dispose();
        if (line.material) {
            if (Array.isArray(line.material)) {
                line.material.forEach(m => m.dispose());
            } else {
                line.material.dispose();
            }
        }
    });
    roadLines = [];
}

function resetToTime(targetTimestamp) {
    if (!logEntries.length) return;

    // Pause simulation during scrub
    simStarted = false;

    // Clean up all existing meshes and data
    cleanupScene();
    initTree();
    fileMap.clear();
    users.clear();
    beamActions.length = 0;

    // Set simulation time to scrubbed position
    simTime = targetTimestamp;
    commitIndex = 0;
    isScrubbing = true;  // Skip beam creation + sim updates during rebuild

    // Re-process all commits up to target timestamp
    while (commitIndex < logEntries.length &&
           logEntries[commitIndex].timestamp <= targetTimestamp) {
        processCommit(logEntries[commitIndex]);
        commitIndex++;
    }

    // Rebuild layout — deterministic orbital placement with force-directed refinement
    rebuildLayout();
    createInitialMeshes();
    positionCamera();
    simStarted = true;
    simPaused = true;
    isScrubbing = false;  // Allow animation loop to resume (paused)
    // Async physics settling to find natural tree shape after scrub
    settleCompleteLayout();
    updatePlayPauseButton();
    if (loadingElement) loadingElement.style.display = 'none';
    if (dateElement) dateElement.style.display = 'block';
}

function updatePlayPauseButton() {
    const btn = document.getElementById('play-pause-btn');
    if (!btn) return;
    if (simPaused) {
        btn.textContent = 'Play';
        btn.title = 'Play';
    } else {
        btn.textContent = 'Pause';
        btn.title = 'Pause';
    }
}

async function init() {
    initTree();
    setupScene();
    try {
        let logUrl = 'phource.log';
        try {
            await loadLog(logUrl, 'main');
        } catch (e) {
            logUrl = 'test-gource-log.phource';
            await loadLog(logUrl, 'main');
        }

        // Load secondary branch log for side-by-side comparison (if it exists)
        try {
            await loadLog('phource-branch.log', 'branch');
        } catch (e) {
            // No secondary branch log — single-branch mode is fine
        }

        // Sort all entries by timestamp (merges both branches)
        logEntries.sort((a, b) => a.timestamp - b.timestamp);

        simTime = logEntries.length > 0 ? logEntries[0].timestamp : 0;

        // Pre-compute max directory depth for remaining commits (for zoom planning)
        // This ensures the camera always zooms out enough to see all future files
        _maxDirDepthRemaining = new Array(logEntries.length + 1).fill(0);
        for (let i = logEntries.length - 1; i >= 0; i--) {
            const parts = logEntries[i].filepath.split('/');
            const dirDepth = parts.length - 1;
            _maxDirDepthRemaining[i] = Math.max(_maxDirDepthRemaining[i + 1], dirDepth);
        }

        // Initialize scrubber timestamps
        if (logEntries.length > 0) {
            minTimestamp = logEntries[0].timestamp;
            maxTimestamp = logEntries[logEntries.length - 1].timestamp;
        }

        // Process initial commits (build tree at sim start time)
        while (commitIndex < logEntries.length &&
               logEntries[commitIndex].timestamp <= simTime) {
            processCommit(logEntries[commitIndex]);
            commitIndex++;
        }

        rebuildLayout();
        createInitialMeshes();
        positionCamera();
        simStarted = true;
        loadingElement.style.display = 'none';
        dateElement.style.display = 'block';
        if (scrubberElement) scrubberElement.parentElement.classList.remove('hidden');
    } catch (error) {
        console.error('phource init error:', error);
        loadingElement.textContent = `Error: ${error.message}`;
        loadingElement.style.color = 'red';
    }
    animate();
}

// === Main animation loop ===
// Uses setTimeout for reliable frame scheduling (rAF may throttle in
// headless/background browser contexts; in a real browser this can be
// replaced with requestAnimationFrame for smoother 60fps animation)
let _lastFrameTime = 0;
function animate(timestamp) {
    const now = timestamp || performance.now();
    if (_lastFrameTime === 0) _lastFrameTime = now;
    const dt = Math.min((now - _lastFrameTime) / 1000, 0.1);
    _lastFrameTime = now;
    frameCount++;
    dtSum += dt;
    if (simStarted && !isScrubbing && !simPaused) updateSimulation(dt);
    // Update mesh animations continuously (needed for fade-in after scrubbing, and force layout settling)
    if (root && simStarted) {
        updateAllMeshes(dt);
        updateBeamActions(dt);
        updateUserAvatars(dt);
    }
    if (cameraNeedsAutoFit) {
        // Skip auto-fit if user recently interacted with the camera
        if (performance.now() - lastUserInteraction < AUTO_FIT_COOLDOWN) {
            // Still set the flag so it fires again next frame after cooldown
        } else {
            const bounds = root ? computeSubtreeBounds(root) : null;
            const w = bounds ? (bounds.maxX - bounds.minX || root.calculatedOuterWidth || 100) : (root ? (root.calculatedOuterWidth || 100) : 100);
            const d = bounds ? (bounds.maxZ - bounds.minZ || root.calculatedOuterDepth || 100) : (root ? (root.calculatedOuterDepth || 100) : 100);
            const camDistance = Math.max(w, d) * 0.8;
            const targetY = _cameraTargetY !== null ? _cameraTargetY : camDistance;
            const targetCamY = Math.max(camDistance, targetY);
            // Scene center — for single-branch (origin-centered) this is (0, 0)
            const centerX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
            const centerZ = bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0;

            if (_bounceActive) {
                // Disney bounce zoom: damped oscillation toward target with 5% overshoot
                const elapsed = performance.now() - _bounceStartTime;
                const t = Math.min(elapsed / BOUNCE_DURATION, 1.0);
                if (t >= 1.0) {
                    // Bounce complete — settle at latest target (not stale _bounceTargetY)
                    camera.position.x = centerX;
                    camera.position.z = centerZ;
                    camera.position.y = targetCamY;
                    controls.target.set(centerX, 0, centerZ);
                    controls.update();
                    _bounceActive = false;
                    _lastBounceEndTime = performance.now();
                } else {
                    // Damped oscillation: ~2.5 bounces over duration, decaying
                    const decay = Math.exp(-t * 4);
                    const oscillation = Math.cos(t * Math.PI * 2.5);
                    const bounceY = _bounceTargetY + _bounceAmplitude * decay * oscillation;
                    camera.position.x = centerX;
                    camera.position.z = centerZ;
                    camera.position.y = bounceY;
                    controls.target.set(centerX, 0, centerZ);
                    controls.update();
                }
            } else {
                // Normal smooth lerp toward target
                const currentY = camera.position.y;
                camera.position.x = centerX;
                camera.position.z = centerZ;
                // Deadzone: if camera is within 0.2% of target, don't adjust.
                // Prevents jitter from tiny target changes (growth padding
                // decreases ~0.02%/commit) during steady-state animation.
                const moveRatio = Math.abs(targetCamY - currentY) / Math.max(currentY, 1);
                if (moveRatio > 0.002) {
                    const lerpFactor = Math.min(0.15, Math.max(0.08, moveRatio));
                    camera.position.y = currentY + (targetCamY - currentY) * lerpFactor;
                }
                controls.target.set(centerX, 0, centerZ);
                controls.update();
            }

            // Clear flag only when simulation is paused/done and camera converged
            if (simPaused && !_bounceActive) {
                if (Math.abs(camera.position.y - targetCamY) < targetCamY * 0.005) {
                    cameraNeedsAutoFit = false;
                }
            }
        }
    }
    if (controls) controls.update();
    updateTooltip();

    // Update scrubber position to reflect current simulation time
    if (!isScrubbing && scrubberElement && minTimestamp && maxTimestamp) {
        const fraction = (simTime - minTimestamp) / (maxTimestamp - minTimestamp);
        const scrubValue = Math.round(fraction * 1000);
        if (scrubberElement.value != scrubValue) {
            scrubberElement.value = scrubValue;
        }
        if (scrubberDateElement) {
            const displayDate = formatDate(simTime);
            if (scrubberDateElement.textContent !== displayDate) {
                scrubberDateElement.textContent = displayDate;
            }
        }
    }

    stepOrbitalSimulation(dt);
    if (renderer && scene && camera) renderer.render(scene, camera);

    // Use setTimeout for reliability in headless browsers (rAF is throttled)
    setTimeout(animate, 16);
}

// === Debug bridge ===
window.__phourceDebug = {
    get sceneChildren() { return scene ? scene.children.length : 0; },
    get roadLineCount() { return scene ? scene.children.filter(c => c.userData && c.userData.parent && c.userData.child).length : 0; },
    get cameraInfo() { return camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null; },
    get bounceState() { return { active: _bounceActive, targetY: _bounceTargetY, amplitude: _bounceAmplitude, startTime: _bounceStartTime, lastPredictY: _lastPredictY, cameraNeedsAutoFit, maxDirDepth: _maxDirDepthRemaining.length ? _maxDirDepthRemaining[Math.min(commitIndex, _maxDirDepthRemaining.length - 1)] : 0 }; },
    get sceneObjects() {
        if (!scene) return [];
        return scene.children.map(c => c.userData ? c.userData.type + ':' + (c.userData.nodeData ? c.userData.nodeData.name : c.userData.userName || '?') : c.type);
    },
    get rendererInfo() { return renderer ? { renderCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles } : null; },
    get overlapCount() {
        if (!root || !forceLayoutNodes || forceLayoutNodes.length < 2) return 0;
        let overlaps = 0;
        const nodes = forceLayoutNodes;
        let maxForceSize = 10;
        for (let i = 0; i < nodes.length; i++) {
            const fs = nodes[i].forceSize || 10;
            if (fs > maxForceSize) maxForceSize = fs;
        }
        const cellSize = maxForceSize + MIN_FILE_GAP + 50;

        // Spatial grid for fast overlap counting
        const grid = new Map();
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            if (!a || a === root) continue;
            const cx = Math.floor(a.targetPos.x / cellSize);
            const cz = Math.floor(a.targetPos.z / cellSize);
            const key = cx + ',' + cz;
            let cell = grid.get(key);
            if (!cell) { grid.set(key, []); cell = grid.get(key); }
            cell.push(i);
        }

        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            if (!a || a === root) continue;
            const aSize = a.forceSize || 10;
            const cx = Math.floor(a.targetPos.x / cellSize);
            const cz = Math.floor(a.targetPos.z / cellSize);
            for (let gx = -1; gx <= 1; gx++) {
                for (let gz = -1; gz <= 1; gz++) {
                    const key = (cx + gx) + ',' + (cz + gz);
                    const cell = grid.get(key);
                    if (!cell) continue;
                    for (let k = 0; k < cell.length; k++) {
                        const j = cell[k];
                        if (j <= i) continue;
                        const b = nodes[j];
                        if (!b || b === root) continue;
                        const bSize = b.forceSize || 10;
                        const dx = b.targetPos.x - a.targetPos.x;
                        const dz = b.targetPos.z - a.targetPos.z;
                        const distSq = dx * dx + dz * dz;
                        const minDist = (aSize + bSize) / 2 + MIN_FILE_GAP;
                        if (distSq < (minDist - 1) * (minDist - 1)) overlaps++;
                    }
                }
            }
        }
        return overlaps;
    },
    get cameraPos() { return camera ? Array.from(camera.position) : null; },
    get userPos() {
        if (!users || users.size === 0) return null;
        const u = users.values().next().value;
        return u ? [Math.round(u.pos.x), Math.round(u.pos.y), Math.round(u.pos.z)] : null;
    },
    get controlTarget() { return controls ? Array.from(controls.target) : null; },
    get simState() { return { simStarted, simTime, commitIndex, fileMapSize: fileMap.size, usersSize: users.size, beamCount: beamActions.length, maxCommitCount, dtSum, frameCount, isScrubbing, simPaused, minTs: minTimestamp, maxTs: maxTimestamp, loadedBranches, primaryBranch }; },
    get rootDims() { return root ? { w: root.calculatedOuterWidth, d: root.calculatedOuterDepth } : null; },
    get userDebug() {
        if (!users || users.size === 0) return null;
        const u = users.values().next().value;
        if (!u) return null;
        const actions = u.actions || [];
        let fileSumX = 0, fileSumZ = 0, validCount = 0;
        let minBatchTs = Infinity, maxBatchTs = -Infinity;
        for (const a of actions) {
            if (a.batchTs < minBatchTs) minBatchTs = a.batchTs;
            if (a.batchTs > maxBatchTs) maxBatchTs = a.batchTs;
            if (a.fileNode && a.fileNode.targetPos) {
                fileSumX += a.fileNode.targetPos.x;
                fileSumZ += a.fileNode.targetPos.z;
                validCount++;
            }
        }
        return {
            actionCount: actions.length,
            validFileCount: validCount,
            fileAvgX: Math.round(fileSumX / Math.max(validCount, 1)),
            fileAvgZ: Math.round(fileSumZ / Math.max(validCount, 1)),
            midpointX: Math.round(fileSumX / Math.max(validCount, 1) / 2),
            midpointZ: Math.round(fileSumZ / Math.max(validCount, 1) / 2),
            userX: Math.round(u.pos.x),
            userZ: Math.round(u.pos.z),
            batchTsRange: minBatchTs + '-' + maxBatchTs,
        };
    },
    repositionCamera: function() {
        if (!root || !camera || !controls) return;
        const bounds = computeSubtreeBounds(root);
        const w = (bounds.maxX - bounds.minX) || root.calculatedOuterWidth || 100;
        const d = (bounds.maxZ - bounds.minZ) || root.calculatedOuterDepth || 100;
        const camDistance = Math.max(w, d) * 0.8;
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerZ = (bounds.minZ + bounds.maxZ) / 2;
        // Top-down view: camera directly above looking straight down
        camera.position.set(centerX, camDistance, centerZ);
        controls.target.set(centerX, 0, centerZ);
        controls.update();
    },
    scrubToTime: function(timestamp) {
        resetToTime(timestamp);
    },
    scrubToFraction: function(fraction) {
        const ts = minTimestamp + (maxTimestamp - minTimestamp) * fraction;
        resetToTime(ts);
        return ts;
    },
    get forceCooling() { return forceCooling; },
    get forceSimRunning() { return forceSimRunning; },
    resolveAllOverlaps: function(passes) {
        for (let i = 0; i < (passes || 100); i++) resolveOverlaps();
        return window.__phourceDebug.overlapCount;
    },
    stepPhysics: function(passes) {
        forceCooling = 1.0;
        for (let i = 0; i < (passes || 1); i++) stepForceLayout();
        return window.__phourceDebug.overlapCount;
    },
    settle: function() {
        settleCompleteLayout();
        return true;
    },
    beamDebug: function() {
        var result = { total: beamActions.length, beams: [] };
        for (var i = 0; i < Math.min(10, beamActions.length); i++) {
            var ba = beamActions[i];
            var info = {
                progress: Math.round(ba.progress * 100) / 100,
                actionType: ba.actionType,
                fileName: ba.file.name,
                fullPath: ba.file.fullPath || ba.file.name,
                hasPathNodes: !!ba.pathNodes,
                pathNodeCount: ba.pathNodes ? ba.pathNodes.length : 0,
                hasGlowSphere: !!ba.glowSphere,
                beamOffset: ba.beamOffset ? [Math.round(ba.beamOffset.x), Math.round(ba.beamOffset.y), Math.round(ba.beamOffset.z)] : null,
                beamIdx: ba.beamIdx !== undefined ? ba.beamIdx : 'N/A',
            };
            result.beams.push(info);
        }
        // Count action types
        var typeCounts = {};
        for (var i = 0; i < beamActions.length; i++) {
            var t = beamActions[i].actionType;
            typeCounts[t] = (typeCounts[t] || 0) + 1;
        }
        result.typeCounts = typeCounts;
        return JSON.stringify(result);
    },
    get overlapDebug() {
        if (!root || !forceLayoutNodes || forceLayoutNodes.length < 2) return { nodes: 0 };
        const nodes = forceLayoutNodes;
        let maxForceSize = 10;
        for (let i = 0; i < nodes.length; i++) {
            const fs = nodes[i].forceSize || 10;
            if (fs > maxForceSize) maxForceSize = fs;
        }
        const cellSize = maxForceSize + MIN_FILE_GAP + 50;

        // Spatial grid for fast overlap counting
        const grid = new Map();
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            if (!a || a === root) continue;
            const cx = Math.floor(a.targetPos.x / cellSize);
            const cz = Math.floor(a.targetPos.z / cellSize);
            const key = cx + ',' + cz;
            let cell = grid.get(key);
            if (!cell) { grid.set(key, []); cell = grid.get(key); }
            cell.push(i);
        }

        let totalChecked = 0, totalOverlapping = 0;
        let maxOverlap = 0;
        let sampleOverlaps = [];
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            if (!a || a === root) continue;
            const aSize = a.forceSize || 10;
            const cx = Math.floor(a.targetPos.x / cellSize);
            const cz = Math.floor(a.targetPos.z / cellSize);
            for (let gx = -1; gx <= 1; gx++) {
                for (let gz = -1; gz <= 1; gz++) {
                    const key = (cx + gx) + ',' + (cz + gz);
                    const cell = grid.get(key);
                    if (!cell) continue;
                    for (let k = 0; k < cell.length; k++) {
                        const j = cell[k];
                        if (j <= i) continue;
                        const b = nodes[j];
                        if (!b || b === root) continue;
                        const bSize = b.forceSize || 10;
                        const dx = b.targetPos.x - a.targetPos.x;
                        const dz = b.targetPos.z - a.targetPos.z;
                        const distSq = dx * dx + dz * dz;
                        totalChecked++;
                        const minDist = (aSize + bSize) / 2 + MIN_FILE_GAP;
                        if (distSq < (minDist - 1) * (minDist - 1)) {
                            totalOverlapping++;
                            const dist = Math.sqrt(distSq) || 0.01;
                            const overlap = minDist - dist;
                            if (overlap > maxOverlap) maxOverlap = overlap;
                            if (sampleOverlaps.length < 5) {
                                sampleOverlaps.push({
                                    a: a.name, aSize: aSize, aType: a.isDirectory ? 'dir' : 'file',
                                    b: b.name, bSize: bSize, bType: b.isDirectory ? 'dir' : 'file',
                                    dist: dist.toFixed(2), minDist: minDist.toFixed(2), overlap: overlap.toFixed(2)
                                });
                            }
                        }
                    }
                }
            }
        }
        return { nodes: nodes.length, maxForceSize, cellSize, totalChecked, totalOverlapping, maxOverlap, sampleOverlaps };
    },
    get fileColorInfo() {
        if (!fileInstancedMesh) return { exists: false, instanceCount: 0 };
        const ic = fileInstancedMesh.instanceColor;
        if (!ic || !ic.array) return { exists: fileInstancedMesh, instanceCount: fileInstanceCount, hasInstanceColor: false };
        const samples = [];
        for (let i = 0; i < Math.min(5, fileInstanceCount); i++) {
            const n = fileInstanceNodes[i];
            if (n) {
                const j = i * 3;
                samples.push({
                    instanceId: i,
                    r: ic.array[j], g: ic.array[j+1], b: ic.array[j+2],
                    nodeName: n.name,
                    heat: n.heat,
                    colourHex: n.colourHex || '',
                    forceSize: n.forceSize
                });
            }
        }
        return { instanceCount: fileInstanceCount, hasInstanceColor: true, samples };
    },
    checkOrphanedFiles: function() {
        if (!fileMap) return { total: 0, orphaned: [] };
        const orphaned = [];
        for (const [path, f] of fileMap.entries()) {
            if (!f.parentDir || !f.parentDir.targetPos || !f.targetPos) continue;
            if (f.pendingRemoval) continue;
            const dx = f.targetPos.x - f.parentDir.targetPos.x;
            const dz = f.targetPos.z - f.parentDir.targetPos.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            const expectedDist = (f.parentDir.forceSize || 50) + (f.forceSize || 10) + 20;
            if (dist > expectedDist * 3) {
                orphaned.push({
                    path,
                    dist: Math.round(dist),
                    expected: Math.round(expectedDist),
                    targetPos: [Math.round(f.targetPos.x), Math.round(f.targetPos.z)],
                    parentDir: f.parentDir.name,
                    parentPos: [Math.round(f.parentDir.targetPos.x), Math.round(f.parentDir.targetPos.z)],
                    depth: f.parentDir.depth
                });
            }
        }
        return { total: fileMap.size, orphanedCount: orphaned.length, orphaned };
    },
    checkStaleInstances: function() {
        // Check for mesh instances that are visible but not in fileMap
        if (!fileInstancedMesh || !fileMap) return { activeFiles: 0, totalInstances: 0, staleCount: 0 };
        let staleCount = 0;
        const staleFiles = [];
        for (let i = 0; i < fileInstanceCount; i++) {
            const node = fileInstanceNodes[i];
            if (node && node.fullPath) {
                // Check if this instance's file is still active in fileMap
                const fm = fileMap.get(node.fullPath);
                if (!fm || fm.instanceId !== i) {
                    staleCount++;
                    staleFiles.push({ instanceId: i, path: node.fullPath, instanceIdInNode: node.instanceId, fileMapHas: !!fm });
                }
            }
        }
        return { activeFiles: fileMap.size, totalInstances: fileInstanceCount, staleCount, staleFiles };
    },
    get radialDistribution() {
        if (!root) return null;
        const distribution = [];
        (function walk(node) {
            if (!node) return;
            const r = node.targetPos ? Math.sqrt(node.targetPos.x * node.targetPos.x + node.targetPos.z * node.targetPos.z) : 0;
            distribution.push({ name: node.name, depth: node.depth || 0, radius: Math.round(r), isDir: node.isDirectory || false });
            if (node.isDirectory) {
                node.childDirectories.forEach(walk);
                node.childFiles.forEach(walk);
            }
        })(root);
        return distribution.sort((a, b) => b.radius - a.radius);
    },
    get fileMaterialInfo() {
        if (!fileInstancedMesh) return { exists: false };
        const mat = fileInstancedMesh.material;
        return {
            exists: true,
            type: mat.type,
            vertexColors: mat.vertexColors,
            color: mat.color ? '#' + mat.color.getHexString() : null,
            hasInstanceColor: !!fileInstancedMesh.instanceColor,
            instanceCount: fileInstanceCount,
            renderCalls: renderer ? renderer.info.render.calls : 0,
            triangles: renderer ? renderer.info.render.triangles : 0,
        };
    },
};

init();
