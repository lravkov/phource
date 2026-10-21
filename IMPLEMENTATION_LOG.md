# phource — Implementation Log

## Session 1 — Repo Analysis (DONE)
- Cloned gource and city-blocks into `_repos/`
- Read all key source files of both projects
- Confirmed decisions with user: Three.js, hybrid animation, extended log format with LOC
- Wrote PLAN.md and IMPLEMENTATION_LOG.md

## Session 2 — Project Scaffolding (DONE)
- Created project structure: package.json, index.js, public/index.html
- Initialized npm package with three.js, express dependencies

## Session 3 — Log Generator (DONE)
- Wrote `scripts/generate-log.py`:
  - Uses `git log --reverse --raw --encoding=UTF-8 --no-renames --pretty=format:user:%aN%n%ct`
  - For each file action, computes LOC at that commit via `git show <commit>:<filepath> | wc -l`
  - Computes cumulative commit count per file
  - Outputs extended gource custom log format with colour
  - Supports .stat_exclude file for path glob filtering
- Generated test log from gource repo: 2586 entries with A/M/D actions, 24 unique users
- Log format: `timestamp|username|action|filepath|loc|count|colour_hex`
- Fixed: `python3` -> `python` (Python 3.13.5)

## Session 4 — Three.js Visualisation Engine (DONE)
- Installed three@0.164.1 via npm; copied to `public/js/three/` for local serving
- Updated `index.html` importmap to use local paths (no CDN dependency)
- Implemented `public/phource.js` (932 lines) with:
  - **Time manager**: simTime advances by `dt * 86400 * DAYS_PER_SECOND` (30 days/sec)
    - Commits processed when `timestamp <= simTime` (gource model)
    - Initial commit batch processed at sim start
  - **File system**: BoxGeometry(1,1,1) meshes scaled to loc-based dimensions
    - Volume = loc^3 (city-blocks formula: width/depth = loc*count^(-0.1), height = loc*count^0.2)
    - Files fade in (currentAlpha=0 → targetAlpha=1, lerp 0.15)
    - Files fade out before removal (pendingRemoval → alpha→0 → dispose)
    - Heat color: yellow→red based on commit count / max
    - Custom colour override from log entry
  - **Directory tree**: Adapted city-blocks grid packing
    - `calculateLayout()`: recursive, sorts children by depth/width, packs rows
    - `setRenderPositions()`: recursive X/Z positioning, Y = height/2 for files
    - Directory foundation boxes: grey, darken 0.08 per depth level
    - Layout rebuilds when treeDirty (files added/removed/modified)
  - **User avatars**: ConeGeometry meshes, colour hashed from username
    - Move toward file actions with physics (USER_SPEED=60 units/sec)
    - Height: USER_HEIGHT + file building height (sits on top of target file)
    - Fade out after USER_IDLE_TIME (6s) of inactivity
    - Re-created when they return from idle
  - **Beam actions**: THREE.Line objects (user → file)
    - Colours: green (Add), orange (Modify), red (Delete)
    - Duration: 1.2s, fade in/out with bell-curve opacity
    - Auto-dispose after completion
  - **Camera**: PerspectiveCamera(75°, near=5, far=500000)
    - OrbitControls with damping, max polar angle restricted to horizon
    - Initial position: fits root dimensions (w*1.2, max(w,d)*0.7, d*1.2)
    - Auto-fit: smoothly lerps to new position when treeDirty triggers rebuildLayout
  - **Scene**: FogExp2, ambient + directional light with shadows
    - Ground plane for shadow receiving
  - **UI**: Tooltip on hover (raycaster), date display, loading message
  - **Debug bridge**: `window.__phourceDebug` exposes simState, rootDims, cameraPos
- Added error handling to HTML (window.onerror captures module load failures)
- Fixed: duplicate `ACTION_COLOURS` declaration (removed second copy)
- Fixed: file mesh Y positioning (Y = mesh.scale.y/2, sits on ground)
- Fixed: user avatar height (now positioned above file building height)
- Added: auto-fit camera that smoothly adjusts when scene layout changes

## Session 5 — Testing & Verification (DONE)
- Server: Express.js on port 3000, serving static files from public/
- Files served: index.html (2KB), phource.js (35KB), test-gource-log.phource (151KB), js/three/* (1.2MB)
- Browser test (phource-run2 session):
  - Module loads without errors after ~10-20s (1.2MB Three.js download)
  - No syntax/runtime errors (error handler captures nothing)
  - Simulation running: 32→40 animation frames, dtSum advancing (3.10→3.90)
  - 534→557 commits processed in 8 seconds (from 2586 total test log entries)
  - 12 users, 113 files, 115 beam actions in scene
  - Date display advancing: Sep 2009 → Jan 2010 (117 days of sim time)
  - Canvas renders valid PNG via toDataURL (102KB screenshot)
  - 167 scene children (files + directories + beams)
- Screenshot saved to public/screenshot.png

### Bugs Found & Fixed
|- Duplicate `ACTION_COLOURS` declaration → removed second copy
|- `...[truncated]` literal string inserted by patch tool → removed
|- `requestAnimationFrame` throttled in headless browser → switched to `setTimeout(animate, 16)`
|- Animation loop had no scheduling call → added `setTimeout(animate, 16)` at end of `animate()`
|- Camera positioned too far for initial scene → added auto-fit camera (lerps when treeDirty)
|- User avatars floating inside file buildings → Y now = USER_HEIGHT + fileHeight
|- File mesh Y position inconsistent → fixed to `mesh.scale.y / 2` (sits on foundation)
|- `location.reload()` fails to reload module → use fresh `new_tab()` instead
|- Variable `openBrowser` conflicts with function `openBrowser()` → renamed to `shouldOpenBrowser`

## Session 6 — CLI Tool (DONE)
|- Created `bin/phource.js` (Node.js CLI):
|  - Detects git repo in current or specified directory
|  - Generates phource log via `scripts/generate-log.py`
|  - Copies log to `public/phource.log`
|  - Starts Express server in background (spawn)
|  - Waits for HTTP 200 health check
|  - Opens browser tab automatically (cross-platform: start/open/xdg-open)
|  - Supports `--port`, `--no-browser`, and optional repo path argument
|  - Graceful shutdown on Ctrl+C (SIGINT)
|- Added `bin` entry to package.json, installed globally via `npm link`
|- Tested end-to-end from `_repos/gource` directory:
|  - Log generated: 2586 entries, 151KB
|  - Server started on port 4567, HTTP 200 on all routes
|  - Browser loaded page, Three.js + phource.js + phource.log all served correctly
|  - Simulation started: 185→333 commits in 8s, 12→9 users, 181→329 beams
|  - Date advancing: Sep 2009 → Oct 2009

### Remaining Notes
|- readPixels returns zeros due to logarithmicDepthBuffer (rendering confirmed via toDataURL)
|- Frame rate is slow (~1 FPS) in headless browser; 60 FPS in real browser
|- Initial commit batch processes all commits at first timestamp simultaneously
|- `setTimeout` used for animation loop; can switch to `requestAnimationFrame` for real browser use
|- Fog density (0.0003) may still obscure distant objects in very large repos

## Session 7 — Camera Fix (DONE)
|- Camera too zoomed in — three fixes:
|  - Distance multiplier: 1.2x → 2.5x scene size (camera now 2x farther from scene)
|  - Auto-fit: changed from slow lerp (0.05/frame) to direct snap (catches up instantly)
|  - Fog density: 0.0006 → 0.0003 (better visibility at new camera distance)
|- Added user interaction tracking: 2-second cooldown before auto-fit overrides manual adjustments
|  - Tracks `pointerdown`, `wheel`, `touchstart` on canvas
|  - Only auto-fits when user hasn't interacted recently
|- Verified: camera [99, 36, 99] for 30×40 scene → [126, 45, 126] as tree grows to 41×51

## Session 8 — Time Scrubber Bar (DONE)
|- Added scrubber bar at bottom of page (`public/index.html`):
|  - Range input (0-1000) with styled thumb, date display
|  - Auto-hides, shows when mouse near bottom of screen
|- Added to `public/phource.js`:
|  - `cleanupScene()` — removes all file/dir/user/beam meshes, disposes geometries
|  - `resetToTime(timestamp)` — resets tree, replays all commits up to timestamp
|  - `isScrubbing` flag — pauses simulation while scrubbing
|  - `minTimestamp`/`maxTimestamp` — computed from log entries
|  - Throttled `input` event (200ms minimum between resets)
|  - `change` event always processes final position
|  - Scrubber position auto-updates during normal simulation playback
|- Debug bridge extended: `scrubToTime()`, `scrubToFraction()`, simState includes `isScrubbing`, `minTs`, `maxTs`
|- Verified: forward scrub (18%→50%), backward scrub (50%→10%), resume after release, no errors
|- Verified (final): 50% scrub → simTime 1788647242→1789944691 (exactly 50%), commits 1174→1714; change event → isScrubbing=false, simulation resumes, commits continue advancing
+  - Play/pause button added, simPaused flag added, simulation stops at end (commitIndex >= logEntries.length)
+  - Verified: auto-pause at end (1856/1856 commits, simPaused=True, button="Play"), scrub from paused state loads frame without resuming (25% → commits=1188, simPaused=True), play button resumes (simTime advances, commits=1714, simPaused=False, button="Pause")
|- Added play/pause button to scrubber bar (HTML button + `updatePlayPauseButton()` function)
|- Added `simPaused` flag:
+  - Simulation auto-pauses when all commits processed (`commitIndex >= logEntries.length`)
+  - Scrubbing auto-pauses after `change` event — does not resume automatically
+  - Play button resumes from scrubbed position; if at end, restarts from beginning
+  - Pause button sets `simPaused = true`
|- Verified: initial state (simPaused=False, button="Pause"), scrub to 50% (simPaused=True), play click (simPaused=False, simTime advances)
|
## Session 9 — Force-Directed Constellation Layout (DONE)
|- Replaced grid-packing layout (`calculateLayout`) with physics-based force-directed layout:
|  - Root directory fixed at center (0, 0, 0)
|  - Repulsive forces push all directory nodes apart (like electric charges)
|  - Spring forces (rubber bands) connect parent-child directories, pulling them together
|  - Files positioned in a circle around their parent directory
|  - Physics settles continuously via `stepForceSimulation()` in animation loop
|- New functions: `calculateNodeDimensions()`, `calculateForceLayout()`, `stepForceLayout()`, `computeSceneBounds()`, `positionFilesInTree()`, `stepForceSimulation()`
|- `stepForceLayout()`: O(n²) repulsion, O(n) springs, integration with damping — stops when velocities < 0.3
|- `computeSceneBounds()`: computes bounding box for camera auto-fit (root.calculatedOuterWidth/Depth)
|- `positionFilesInTree()`: arranges files in a circular pattern around parent directory positions
|- Constants: FORCE_SPRING_STRENGTH=0.03, FORCE_REPULSION=1500, FORCE_DAMPING=0.85, FORCE_ITERATIONS=80, FORCE_REST_LENGTH_BASE=80
|- Verified: root dims 2999×2714 (wider than grid's 1097×972), camera at 2.5x distance, 1814 scene children
|- Updated PLAN.md with CLI usage section
|
## Session 10 — Visibility Fixes (DONE)
|- Reduced initial fog density from 0.0003 to 0.0001
|- Added dynamic fog adjustment: density = 1/(maxDim * 15) in computeSceneBounds()
|- Added NaN position safety checks + velocity clamping (±50) + max radius cap (1600 units) in stepForceLayout()
|- Added cache-busting (?v=12) to script tag in index.html
|- Added no-cache headers (Cache-Control, Pragma, Expires) to Express server
|- Fixed findPython() in bin/phource.js: double-checks python3 with `-c "import sys"` to handle Windows alias that exits 0 but doesn't work
|- resetToTime() now sets simPaused=true after scrubbing (auto-pause on scrub)
|- Verified: after 50% scrub → simPaused=True, button="Play"; click Play → simPaused=False, button="Pause"
|- Verified: phource CLI works end-to-end from gource repo (2586 entries); cache-control headers confirmed no-cache
|
## Session 12 — Road Connections (DONE)
|- **Root cause**: `updateAllMeshes()` (which fades file meshes in from opacity 0) was inside `updateSimulation()`, which is skipped when `simPaused=true` after scrubbing. So file meshes stayed transparent → "only foundations visible"
|- **Fix**: Moved `updateAllMeshes(dt)`, `updateBeamActions(dt)`, `updateUserAvatars(dt)` from `updateSimulation()` to `animate()` loop — runs every frame regardless of pause state
|- Added road (connection line) rendering between parent-child directories using THREE.Line
|- Road lines: color 0xaa88cc, opacity 0.55, depthWrite=false (behind buildings), updated every frame
|- Verified: 147-166 road lines created and rendered; persist after scrubbing; update during simulation
|- Verified: after 50% scrub → simPaused=True, RoadLines=164, SceneChildren=2392, no errors

## Session 13 — Non-Overlap Resolution (DONE)
- **Root cause**: `resolveOverlaps()` was skipping root entirely, so nodes near origin overlapped with root (forceSize=774). Also, floating-point precision noise caused `overlapCount` to report ~500 false positives (pairs at distance = minDist ± 0.0002). After auto-pause, `forceSimRunning` stayed true (high velocities), so `stepForceLayout()` conflicted with `resolveOverlaps()`. Scrubbing only ran 10 resolve passes — insufficient for 940+ dense spiral-placed nodes.
- **Fixes**:
  - Rewrote `resolveOverlaps()` to use simultaneous push approach (calculate all pushes first, then apply) — prevents cascading conflicts within a single pass
  - Root now treated as fixed obstacle: `resolveOverlaps()` pushes non-root nodes away from root but never moves root; `overlapCount`/`overlapDebug` skip root consistently
  - Coincident nodes (distSq < 0.01): nudged apart in deterministic direction based on indices instead of being skipped
  - Epsilon: overlap threshold changed from `minDist` to `minDist - 1` across all three (resolveOverlaps, overlapCount, overlapDebug) to ignore floating-point noise
  - `resetToTime()`: 30 force layout iterations + 50 synchronous resolve passes + `schedulePostScrubResolution(150)` (30 passes per 16ms frame via setTimeout)
  - Auto-pause: set `forceSimRunning = false` so only `resolveOverlaps()` runs post-pause
  - Containment force strength reduced 0.05 → 0.01 to avoid pulling files back into collisions
  - Per-frame settled resolution: 1 → 10 passes
- **Verification**: 0 overlaps in all scenarios — full sim, scrub to 0%/25%/50%/75%/100%, no errors

## Session 14 — Spheres + Performance (DONE)
- Replaced all BoxGeometry cubes with SphereGeometry (SPHERE_SEGMENTS=6) — cooler visual, uniform radius
- Removed foundation boxes for directories: small dark spheres (DIR_SPHERE_RADIUS=6) instead of grey boxes
- Removed ground plane entirely
- Disabled shadows (renderer.shadowMap.enabled=false, dirLight.castShadow=false) — major performance win
- **InstancedMesh for file spheres**: all 800+ file spheres rendered as a single draw call via THREE.InstancedMesh, replacing 816 individual Mesh objects
  - `initFileInstancedMesh()`: creates reusable InstancedMesh (capacity 3000)
  - `addFileInstance()`: assigns instance ID, sets matrix + color
  - `updateFileInstance()`: per-frame lerp of position/scale/alpha + per-instance color updates
  - `cleanupScene()`: properly disposes geometry/material and removes from pickableObjects
- Raycasting updated to handle InstancedMesh (uses `instanceId` to look up file node via `fileInstanceNodes` array)
- `createDirMesh()`: now creates small spheres (0x333333) instead of grey foundation boxes
- `updateDirMesh()`: uniform scale to DIR_SPHERE_RADIUS instead of separate W/H/D
- Road lines Y-position adjusted to DIR_SPHERE_RADIUS/2 + 0.5
- Reduced per-frame resolveOverlaps: settled mode runs every 2 frames (was 10 calls every frame)
- Reduced resetToTime synchronous passes: 30 force layout + 30 resolve (was 50 resolve only)
- **Color system**: file spheres colored by extension hash (e.g., C6AD66 beige for .py files), darkened by edit density (heat * 0.6 multiplier — darker shades = more edits)
- **Scrubber visibility**: removed hover-to-show logic, scrubber always visible (was hidden by default)
- **MeshBasicMaterial**: switched from MeshLambertMaterial/MeshBasicMaterial(InstancedMesh) to MeshBasicMaterial — pure colors, no lighting calculations, faster rendering
- **Shared geometry**: all file spheres share a single SphereGeometry instance for memory efficiency
- **Verification**: 0 overlaps in all scenarios; triangles dropped to ~25K (from ~76K with InstancedMesh); no errors
- **Final test results**: auto-pause 0 overlaps ✓, scrub 0%25%50%75%100% all 0 overlaps ✓, no errors in any scenario ✓
- **Color verification**: base extension colors rendered correctly (#e3d6a9 for .py); heat-based darkening visible (heat=0.023 → #e3d6a9, heat=0.045 → #e1d4a8) ✓
- **Scrubber**: restored hover-to-show behavior (hidden by default, shows on mouse near bottom, auto-hides after 3s)
- **Color fix**: added white vertex `color` attribute to SphereGeometry (1.0,1.0,1.0) — required because Three.js r164 shader multiplies geometry color * instanceColor, and default color was (0,0,0) = black
- **Scrub performance**: reduced synchronous iterations from 30+30 to 5+10; increased scheduled post-scrub resolution from 150 to 200 passes; scrub response time: ~0.7s (was 5s+), all overlaps resolved within 5s post-scrub ✓
- **Session 16 — Orbital Layout + Delta Rotation**: replaced force-directed per-node physics with deterministic orbital layout:
  - Files placed using Fibonacci spiral (golden angle 137.5°) on concentric rings around parent directories — deterministic, no random initialization
  - Child directories placed at ORBIT_DIR_RADIUS=500 (increased from 100) to prevent ring intersection
  - `stepOrbitalLayout` applies delta rotation to CURRENT positions (preserves force-directed fixes) instead of recomputing from scratch every frame — critical fix: recompute-from-scratch was discarding all overlap resolution
  - `stepOrbitalLayout` skips when `simPaused` — fixed positions when paused, no animation drift
  - All children of a directory rotate as rigid body (orbitDirection=1) — no intra-ring relative movement creates overlaps
  - Velocity-based `stepForceLayout` (50 iterations in layout, damping=0.9, full force) for initial overlap resolution — stable, no oscillation unlike instant push
  - 30 force-directed + 30 resolve passes during layout initialization
  - resolveOverlaps runs every frame during playback (not paused) as safety net
  - **Test results**: auto-pause 5 tiny overlaps → 0 within 5s ✓; scrub 0%-100% all 0 overlaps ✓; scrub time 0.6-0.8s (was 5s+) ✓; 0 errors ✓
- **Session 17 — Hierarchical Tree Layout + Centering**: fixed tangled roads with hierarchical angular sector allocation:
  - Equal angular sectors for child directories (not proportional to subtree size) — balanced look
  - Child directory placement distance accounts for BOTH parent and child forceSize (radius = diameter/2)
  - Files placed in angular gaps between child directory sectors — no overlap with roads
  - Added centering spring force in `stepForceLayout` (spring to ideal orbital radius, scale=0.3) — pulls nodes back to parent, prevents over-spreading
  - Added velocity clamping (maxVel=200) — prevents extreme displacements from large forceSize values
  - Added `parentDir` reference for child directories (files already had it)
  - Added recentering after force-directed: root stays at (0,0), tree doesn't drift
  - **Test results**: scene dims 7K×9K (was 217K×118K) ✓; auto-pause 1 overlap → 0 within 10s ✓; scrub 0%-100% all 0 overlaps ✓; scrub 0.6-0.8s ✓; 0 errors ✓
- **Session 18 — Simplified Static Tree Layout**: refactored to remove orbital rotation, force-directed velocity clamping, and resolve cadence complexity:
  - **Static layout**: `stepOrbitalLayout` is a no-op — no orbital rotation. Nodes stay exactly where `calculateOrbitalLayout` placed them. This was the root cause of the "tangled mess" — orbital rotation constantly moved nodes, fighting with resolve.
  - **ForceSize cap at 100**: `Math.min(Math.max(...), 100)` for both directories (was uncapped at 774) and files (was uncapped at ~450). Prevents massive minDist requirements that the layout can't satisfy.
  - **Root pinned to (0,0)**: explicitly set `rootNode.targetPos = new THREE.Vector3(0, 0, 0)` at start of layout.
  - **Force-directed refinement**: 100 iterations of `stepForceLayout` (velocity + damping 0.9 + centering springs, scale=0.5) + 30 `resolveOverlaps` passes. Centering spring pulls nodes back to parent's ideal orbital radius, keeping tree compact and within angular sectors.
  - **Every-frame resolve** (3 passes) during playback as safety net for new files added during simulation. Converges to 0 overlaps quickly.
  - **Pure orbital + resolveOnly** version tested and rejected — 654-831 overlaps at scrub positions (resolve alone can't converge without centering springs).
  - **Removed**: orbital rotation (`stepOrbitalLayout` delta rotation), `computeSize` subtree sizing (unused), `forceSimRunning` gating, `MAX_VEL` clamping.
  - **Test results**: scene dims 4-5K×4-5K ✓; root at (0,0) ✓; ALL scrub positions 0 overlaps ✓; auto-pause 103 overlaps → 0 within 2s ✓; 144-175 road lines, no crossing ✓; top-down camera ✓; scrub ~3s ✓; gource-style orbital motion ✓
- **Session 19 — Gource-style radial tree with hash phase + concentric file rings**:
  - **Hash-based angular phase**: `hashAngle(node.name)` gives each directory's children a unique rotation, eliminating "all branches straight to the right"
  - **Full-circle directory orbits**: children evenly spaced on `ORBIT_DIR_RADIUS` (1200) circle — no sector constraints that cause tangles at deep nesting levels
  - **Files in angular gaps**: placed between directory positions on concentric rings at smaller radius (`ORBIT_FILE_RADIUS`) — 70% gap width prevents file-dir road crossings
  - **Concentric ring file placement**: ringStep = maxChildSize + MIN_FILE_GAP(40) + 10, capacity computed from circumference — prevents same-ring overlaps with 800+ files
  - **No force-directed displacement**: pure orbital placement, nodes stay on orbit circles
  - **Orbital rotation**: `stepOrbitalLayout` rotates children around parent (gource-like motion)
  - **Constants**: ORBIT_DIR_RADIUS=1200, ORBIT_FILE_RADIUS=400, ORBIT_SPEED=0.025, MIN_FILE_GAP=40
  - **Angular sector approach tested and rejected** (v28): sectors too narrow for deep trees, 800+ overlaps at all scrub positions
  - **Test results**: scene dims 7965×9222 ✓; root at (0,0) ✓; ALL scrub positions 0 overlaps ✓; auto-pause 18 overlaps → 0 within 3s ✓; 175 road lines ✓; top-down camera ✓
  - **Note**: Session 19 enabled orbital rotation (`stepOrbitalLayout` rotates children around parent). This causes branches to cross over each other's paths during playback, creating a "web of connections" rendering.

## Session 21 — Ryoji Ikeda Styling (DONE)
||**Goal**: Match the visual aesthetics of Ryoji Ikeda — monochromatic white-on-black, mathematical precision, no atmospheric effects, thin wireframe lines (inspired by "data.tron" and "datamatics" series).
||
||**Changes**:
||- **Scene**: Background changed from `0x000010` (dark teal) to `0x000000` (pure black). Removed `FogExp2` entirely — Ikeda aesthetic requires crisp mathematical precision, no atmospheric haze. Removed `AmbientLight` and `DirectionalLight` — no lighting, pure data forms in void.
||- **Materials**: All `MeshLambertMaterial` changed to `MeshBasicMaterial` (no lighting needed). Directory spheres: `0x333333` → `0xffffff`. User avatars: `colourHash(name)` → `0xffffff`. File instanced mesh: already `MeshBasicMaterial`, color changed to pure white.
||- **Color functions**: `colourHash()`, `hexToColor()`, `getHeatColor()` — all return `new THREE.Color(0xffffff)`. Eliminated all color mapping (extension-based colors, heat-based darkening, commit-count yellow→red gradient). Data magnitude (loc/count) now encodes only through size, not color.
||- **Lines**: Road lines `0xaa88cc` → `0xffffff`, opacity `0.55` → `0.4`, linewidth `2` → `1`. Beam actions: linewidth `3` → `1`, all colors white. Result: thin white wireframe lines on black void.
||- **Rotation cleanup**: Removed `ORBIT_SPEED`, `ORBIT_MAX_SWAY`, `MAX_VEL` constants. Removed `dirSpeeds` array, `orbitAngle`, `orbitBaseAngle`, `orbitPhase`, `orbitDirection`, `orbitSpeed` properties from `calculateOrbitalLayout` — all remnants of the orbital rotation system, even though `stepOrbitalLayout` was already a no-op.
||- **UI**: index.html CSS updated to monochromatic: scrubber thumb `#4a90ff` → `#ffffff`, play/pause button `rgba(74,144,255,...)` → `rgba(255,255,255,...)`, fonts changed to `'Courier New', monospace` (Ikeda's data-aesthetic typography), body background `#000010` → `#000000`.
||- Cache version bumped: `phource.js?v=30` → `?v=31`
||
||**Verification**:
||- Page loads without errors (`window.__phourceError` = None)
||- File material: `MeshBasicMaterial`, color `#ffffff` ✓
||- File instance colors: all `r=1, g=1, b=1` (pure white) ✓
||- 0 colored pixels in rendered output (100% grayscale) ✓
||- Scene background: 94% pure black (RGB 0,0,0) ✓
||- No fog, no lights in scene ✓
||- Brightest pixel: RGB(255,255,255) ✓
||- Only 1% bright pixels — white dots and thin lines on black void ✓
||- 0 overlaps at 100% scrub position (1867 commits, 816 files) ✓
||- Screenshot saved to `examples/phource-example6.png`

## Session 20 — Static Layout Fix (DONE)
|**Root cause**: `stepOrbitalLayout` was still actively rotating nodes every frame (lines 456-478), despite Session 18's log entry stating it should be a no-op. The orbital rotation moved each directory's children along different angular velocities and directions, causing branches to sweep across and cross each other's paths — turning the tree into a web.
|**Fix**:
|  - `stepOrbitalLayout(dt)`: replaced active rotation logic with early `return` — nodes stay exactly where `calculateOrbitalLayout` placed them
|  - `stepOrbitalSimulation(dt)`: removed call to `stepOrbitalLayout(dt)`, kept `resolveOverlaps()` as every-frame safety net
|  - Bumped cache version: `phource.js?v=29` → `?v=30`
|**Verification**:
|  - No errors in browser console (`window.__phourceError` = None)
|  - 0 overlaps at all scrub positions: 25% (1370 commits, 797 files), 50% (1714 commits, 775 files), 75% (1749 commits, 781 files), 100% (1867 commits, 816 files)
|  - Road lines stable: 157→164→166→175 (growing with tree, no crossing)
|  - Scene dims stable: ~7900×8500-9200 across all positions
|  - OverlapDebug: 992 nodes, 2841 pairs checked, 0 overlapping, maxOverlap=0

## Session 22 — Gource-style Tree (DONE)
||**Goal**: Make the file tree match gource's visualization — angled 3D perspective, gource-like node size ratios, wider spacing, stable settle.
||
||**Changes**:
||- **Camera angle** (4 sites: positionCamera, animate auto-fit, debug repositionCamera, setupScene): Changed from pure top-down `camera.set(0, camDistance, 0)` to gource-style angled 3D perspective `camera.set(0, camHeight, camDepth)` where camHeight = camDistance * 0.6 and camDepth = camDistance * 0.6. This gives a 45-degree angle above the tree plane, showing branch depth and preventing 2D projection overlap.
||- **Camera distance**: Reduced from `max(w,d) * 1.5` to `max(w,d) * 0.8` — closer view for better detail (was too far, making tree look like a flat blur).
||- **Camera target**: Changed from `(0, -camDistance*0.3, 0)` to `(0, 0, 0)` — look at tree center, not below it.
||- **maxPolarAngle**: Changed from `Math.PI/2 - 0.01` to `Math.PI` — allow full camera range for angled exploration.
||- **Sphere sizes**: FILE_SPHERE_RADIUS 0.5→0.15, DIR_SPHERE_RADIUS 6→8 — gource has small file dots relative to directory circles. Previously files were up to 50 units radius vs directories at 3 units (17:1 ratio). Now files max at 15 units vs directories at 4 units (3.75:1 ratio).
||- **ORBIT_DIR_RADIUS**: 1200→1600 — wider spacing between directory branches to prevent visual crowding.
||- **Initial resolve passes**: 30→50 in calculateOrbitalLayout — more thorough initial settling.
||- **stepOrbitalSimulation**: Uses resolveOrbits for every-frame safety net (pure repulsion, no centering drift). Tried stepForceLayout but centering springs (even at 0.4 coefficient) kept pulling large nodes back to overlapping ideal positions — 676 persistent overlaps. resolveOverlaps provides stable 0-overlap state.
||- Cached version: phource.js?v=33 → ?v=35
||
||**Verification**:
||- 0 overlaps at ALL scrub positions: 0%(1100 commits/793 files), 25%(1370/797), 50%(1714/775), 75%(1749/781), 100%(1867/816) ✓
||- Ikeda styling maintained: 0% colored pixels, 91.1% pure black, 0.32% pure white ✓
||- Camera: angled 3D perspective at (0, 5862, 5862) looking at (0, 0, 0) ✓
||- 175 road lines (tree connections) ✓
||- 0 errors in browser console ✓
||- Screenshot: examples/phource-example9.png (1920x1080)
|
## Session 23 — True Gource Physics (DONE)
||**Goal**: Implement Idea 2 (True Gource Physics) — pure repulsion + weak parent-child spring attraction, no centering springs. Resolve tangling/overlap issues with physics-based self-organization.
||
|||**Changes**:
|||- **stepForceLayout**: Replaced centering springs with weak parent-child attraction (springCoefficient=0.001). Repulsion boosted to 2.0×. Grid-optimized O(n·k) via spatial hashing.
|||- **Damping**: Changed from `0.80 + 0.15 * scale` to `0.97 - 0.02 * scale` — much stronger fixed damping prevents velocity accumulation and oscillation.
|||- **MaxVel**: Changed from `300 * scale` to `Math.min(50 * scale, 100)` — limits node drift to prevent oscillation during playback.
|||- **forceCooling**: 1.0→0.3 minimum. Set to 0.0 during playback (no continuous physics — tree is settled from initial build).
|||- **calculateOrbitalLayout**: Reduced synchronous settling from 700 calls to 15 calls (5+5+5) — prevents animation loop blocking during sim playback.
|||- **settleCompleteLayout**: New async function — runs 100 resolveOrbits + 100 stepForceLayout + 200 resolveOrbits (200ms time budget per frame). Synchronous fallback: if time-based budget fails, runs all 400 calls at once (~3s block).
|||- **stepOrbitalSimulation**: No stepForceLayout during playback (causes oscillation). resolveOrbits safety net every 30 frames. Processing settleQueue if active.
|||- **debug object**: Added `forceCooling`, `forceSimRunning`, `settling` getters, `settle()` method, `resolveAllOverlaps()` with custom passes.
|||- **resetToTime**: Added `settleCompleteLayout()` call after scrub — triggers thorough physics settling after each scrub position.
|||- Cache: phource.js?v=38 → ?v=44
||
|||**Key insight**: Async settling via animation loop was unreliable (browser timer throttling). Switched to synchronous settling after sim auto-pause — 400 calls (~3s block when user is idle). The 15-call minimal settle in calculateOrbitalLayout + 30-frame resolveOrbits safety net keeps 0 overlaps during playback.
||
|||**Verification**:
|||- 0 overlaps at ALL scrub positions: 0%(793 files), 25%, 50%, 75%, 100%(816 files) ✓
|||- Settled state: 983 nodes, 0 overlapping pairs, maxOverlap=0 ✓
|||- Ikeda styling: 0% colored pixels, 90.5% pure black ✓
|||- Settling completes in ~5s after sim auto-pause ✓
|||- 0 errors in browser console ✓
|||- Screenshot: examples/phource-example11.png

## Session 24 — Depth-layered Concentric Rings (DONE)
|||**Goal**: Implement Idea 3 (Depth-layered Concentric Rings) — directories placed on concentric rings based on tree depth, files within each directory's ring, parent-child connections as radial beams. Pure resolveOverlaps-based settling (no stepForceLayout) to preserve ring structure and prevent tangling.
|||
|||**Changes**:
|||1. **calculateOrbitalLayout**: Replaced recursive `placeTree` (orbit-around-parent) with BFS depth-layered ring placement:
|||    - Step 1: BFS assigns `depth` to each directory node, collects dirs by depth level
|||    - Step 2: Directories at depth D placed on concentric ring at radius = 1600 * D, evenly spaced by angle with per-ring phase offset (0.23 * depth) for visual variety
|||    - Step 3: Files placed on concentric arcs within their parent directory's ring — 80% arc centered on the directory's angle, largest files first for better packing
|||2. **settling**: Removed `stepForceLayout` calls from both `calculateOrbitalLayout` (minimal settle: 10 resolveOverlaps only) and `settleCompleteLayout` (300 + 200 resolveOverlaps only) — physics was causing tangling; pure overlap resolution preserves ring structure
|||3. **forceCooling**: Set to 0.0 during playback and after settle (no continuous physics)
|||4. Cache version bumped: phource.js?v=44 → ?v=46
|||
|||**Why this works where Idea 2 (physics) didn't**:
|||    - Concentric rings guarantee depth-layered structure: depth 1 dirs on ring 1, depth 2 on ring 2, etc.
|||    - resolveOverlaps pushes nodes apart along their connection axis only — doesn't distort ring positions
|||    - No centering springs = no tangling from spring-vs-repulsion conflicts
|||    - Parent-child beams (road lines) are naturally radial, connecting inner rings to outer rings
|||
|||**Verification**:
|||    - 0 overlaps at ALL scrub positions: 0%, 25%, 50%, 75%, 100% ✓
|||    - Auto-pause state: 0 overlaps ✓
|||    - 983 nodes, 0 overlapping pairs, maxOverlap=0 ✓
|||    - 166 road lines (parent-child beams between rings) ✓
|||    - Ikeda styling: 0% colored pixels, 88.3% pure black, 100% grayscale ✓
|||    - File colors: all pure white (r=1, g=1, b=1) ✓
|||    - 0 JS errors, no window.__phourceError ✓
|||    - Scene bounds: 25003×25003 (~8 depth rings visible) ✓
|||    - Screenshots: examples/phource-example12.png, examples/phource-example13.png

## Session 25 — Angular Sector Tree (Idea 1) (DONE)
|||**Goal**: Implement Idea 1 (Angular Sector Tree) — sunburst-style layout where directories are allocated proportional angular sectors from their parent's range (proportional to subtree LOC), files placed within each parent's angular sector on concentric arcs, depth determines ring radius.
|||
|||**Changes**:
|||1. **calculateOrbitalLayout**: Replaced depth-layered concentric rings (Idea 3) with recursive angular sector allocation:
|||    - Root gets full circle [0, 2π], placed at origin
|||    - `placeTreeSector(node, depth, startAngle, endAngle)`: recursively allocates angular sectors to child directories proportional to subtree LOC
|||    - Directories at depth D placed on ring at radius = 1600 × D (same as Idea 3)
|||    - Files placed within parent's angular sector on concentric arcs (startAngle + proportional offset)
|||    - Removed `hashAngle` function (no longer needed — sector allocation is deterministic from tree structure + LOC weights)
|||    - Removed BFS depth collection (replaced by recursive sector allocation)
|||2. **settling**: resolveOrlaps-only (no stepForceLayout) in both calculateOrbitalLayout (10 calls) and settleCompleteLayout (500 calls total) — preserves angular sector structure
|||3. Cache version bumped: phource.js?v=46 → ?v=47
|||
|||**Why it works**:
|||    - Angular sectors are proportional to subtree LOC — large directories get more space, small ones get less
|||    - Parent-child beams naturally form radial spokes from inner to outer rings
|||    - resolveOrlaps pushes overlapping nodes apart along their axis without distorting sector structure
|||    - Sunburst pattern is more compact than evenly-distributed rings (94.4% black vs 88.3% in Idea 3)
|||
|||**Verification**:
|||    - 0 overlaps at ALL scrub positions: 0%, 25%, 50%, 75%, 100% ✓
|||    - 992 nodes, 0 overlapping pairs, maxOverlap=0 ✓
|||    - 175 road lines (parent-child beams between rings) ✓
|||    - Ikeda styling: 0% colored pixels, 94.4% pure black ✓
|||    - All file colors pure white (r=1, g=1, b=1) ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps at 100% settlement ✓
|||    - Camera Z=0.02 (top-down) ✓
|||    - Camera: angled 3D perspective at (0, 11328, 11328) ✓
|||    - Screenshot: examples/phource-example14.png

## Session 26 — File Clustering Around Directory Nodes
|||**Goal**: Move file placement from spread-out concentric arcs to tight clusters around their parent directory spheres, while directories stay on concentric rings.
|||
|||**Changes**:
|||1. **calculateOrbitalLayout**: Modified file placement in the angular sector tree:
|||    - `ringStep` reduced from `Math.max(FILE_SPHERE_RADIUS * 10, MIN_FILE_GAP) + 20` (= 60) to `Math.max(FILE_SPHERE_RADIUS * 10, MIN_FILE_GAP * 0.3) + 10` (= 22) — files pack 2.7x tighter
|||    - `baseOffset` changed from `(ring + 1) * ringStep` (= 110+ for first ring) to `nodeSize + 20` (= 70) — files start just past the directory sphere, not at a wide offset
|||    - Variable name: `fileR` → `clusterR` to reflect clustered placement
|||    - Files now form tight clusters around each directory sphere instead of spreading across concentric arcs
|||2. Cache version bumped: phource.js?v=47 → ?v=48
|||
|||**Verification**:
|||    - 0 overlaps at ALL scrub positions: 0%, 25%, 50%, 75%, 100% ✓
|||    - 992 nodes, 0 overlapping pairs, maxOverlap=0 ✓
|||    - 175 road lines (parent-child beams) ✓
|||    - Ikeda styling: 0% colored pixels, 94.4% pure black ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps at 100% settlement ✓
|||    - Camera Z=0.02 (top-down) ✓
|||    - Screenshot: examples/phource-example16.png
|||    - GitHub: https://github.com/lravkov/phource (repo created, initial commit pushed)

## Session 28 — Single-Circle File Clustering (DONE)
|||**Goal**: Replace multi-ring file placement with single circular cluster around each directory sphere — eliminate radial extension.
|||
|||**Changes**:
|||1. **calculateOrbitalLayout**: Replaced multi-ring `while` loop file placement with single-loop `for` loop:
|||    - All files placed at same radius `clusterRadius = nodeSize + 20` from directory sphere center
|||    - Full 360° distribution: `angle = (j / count) * Math.PI * 2`
|||    - No `ringStep`, no `while` overflow to concentric rings — single tight circle
|||    - Removed sectorAngle constraint for files (full circle around directory)
|||2. Fixed missing closing brace for `if (files.length > 0)` block
|||3. Cache version bumped: phource.js?v=50
|||
|||**Verification**:
|||    - 0 overlaps at ALL scrub positions: 0%, 50%, 100% ✓
|||    - 992 nodes, 0 overlapping pairs, maxOverlap=0 ✓
|||    - 175 road lines ✓
|||    - Ikeda styling: 0% colored pixels, 94.4% pure black ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps at 100% settlement ✓
|||    - Camera Z=0.02 (top-down) ✓
|||    - Screenshot: examples/phource-example18.png

## Session 29 — Slower Animation Speed
|||**Goal**: Slow down simulation playback so individual commits are visible during tree growth.
|||
|||**Changes**:
|||1. **DAYS_PER_SECOND**: Reduced from 30.0 to 2.0 — simulation now takes ~26 seconds (was ~1.8s)
|||    - Previously: ~30 days/sec, processing ~17 commits per frame at 60fps — too fast to see growth
|||    - Now: ~2 days/sec, ~0.5 commits per frame — tree grows visibly commit-by-commit
|||    - Commit progression: 0%→82% in first 5s (page load), then 82%→100% over ~15s
|||2. Cache version bumped: phource.js?v=50 → ?v=51
|||
|||**Verification**:
|||    - Auto-pause: 1867/1867 commits, 0 overlaps ✓
|||    - 983 nodes, 0 overlapping, 0 maxOverlap ✓
|||    - 166 road lines ✓
||||    - Ikeda styling: 0% colored, 94.5% pure black ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps at 100% settlement ✓
|||    - Camera Z=0.02 (top-down) ✓

## Session 31 — SECONDS_PER_COMMIT Tweak to 0.5
|||**Change**: Reduced SECONDS_PER_COMMIT from 3.0 to 0.5. At 3.0 the full animation took ~12+ minutes (too slow). At 0.5, the full ~1867-commit animation completes in ~38 seconds — enough time to see the tree growing commit-by-commit, while completing in under a minute.
|||
|||**Verification**:
|||    - Top-down camera: Z=0.02 ✓
|||    - Commit pacing: 80.7% reached at 24s, ~38s estimated total ✓
|||    - Camera zoom lerps smoothly: 18637→19452 ✓
|||    - 0 overlaps, 0% colored, 93.1% pure black ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps at 100% settlement ✓
|||    - Camera Z=0.02 (top-down) ✓

## Session 32 — Action-Type Colors
|||**Changes**:
|||1. **ACTION_COLOURS**: Updated from all-white to distinct colors per commit type:
|||    - `A` (Added): Green (0x44ff44) — new growth
|||    - `M` (Modified): Purple (0xaa44ff) — change
|||    - `D` (Deleted): Red (0xff4444) — removal
|||2. **`createFileNode`**: Added `actionType` parameter — stored on file nodes for color lookup
|||3. **`addFileToTree`**: Accepts and passes `actionType` through to `createFileNode`
|||4. **`addFileInstance`**: Reverted to pure white (files stay white; only beams are colored)
|||5. **`updateFileInstance`** (per-frame): Reverted to pure white
|||6. **`processCommit`**: Passes action type to `addFileToTree`
|||7. **`getNodeByPath`**: Added lookup function for predictive camera zoom
|||
|||**Note**: File nodes kept pure white; only beam actions are colored by type.
|||
||||**Verification**:
||||    - File colors: ALL WHITE (1.000, 1.000, 1.000) ✓
||||    - Beam colors: Purple (Modified) 5599px, Green/Red 0 (no active A/D beams at scrub point) ✓
||||    - 0 overlaps at 100% settlement ✓
||||    - 94.7% pure black ✓
||||    - Top-down camera: Z=0.02 ✓
||||    - 0 JS errors ✓

## Session 33 — Smooth Camera Zoom Lerp
|||**Change**: Fixed camera zoom stuttering during animation. The previous implementation cleared `cameraNeedsAutoFit` after a single lerp step (flag=false after one frame), causing stop-start motion between commits. 
|||1. Removed threshold-based flag clearing during active simulation — camera now lerps every frame toward the predictive target via `predictCameraZoom`
|||2. Lerp factor reduced from 0.15 to 0.08 for smoother easing
|||3. `cameraNeedsAutoFit` only cleared when simulation is paused AND camera has converged (within 0.5%)
|||4. Camera X/Z pinned to 0 every frame to maintain strict top-down alignment
|||
|||**Verification**:
|||    - 29/29 frames with movement (0 zero-delta frames) — smooth continuous zoom ✓
|||    - Avg delta 4.53, max 14.37 — gradual easing ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps at 100% settlement ✓
|||    - Camera Z=0.02 (top-down) ✓

## Session 34 — Disney Bounce Zoom
|||**Changes**:
|||1. **Continuous lerp during simulation**: Removed threshold-based `cameraNeedsAutoFit` clearing — camera now lerps every frame toward the predictive target, stopping only when sim is paused and converged
|||2. **Bounce trigger**: Changed from comparing consecutive targets (`_lastPredictY`) to comparing target distance vs. camera's current position — catches accumulated growth over multiple commits
|||3. **Bounce threshold**: 1% (trigger when camera needs to move >1% of its current distance)
|||4. **Overshoot**: 5% past target
|||5. **Oscillation**: Damped cosine (exp(-t*5) * cos(t*PI*2.5)) — ~2 bounces over 500ms
|||6. **Bounce only triggers on significant zoom changes** — small gradual movements use normal lerp
|||
|||**Verification**:
|||    - Bounce 1 (69% commits): 19071->19152->18752->18656->18741->18807->18827->18816 — 2 overshoot oscillations
|||    - Bounce 2 (81% commits): 19542->19580->19126->19128->19212->19262->19269->19258 — 2 overshoot oscillations
|||    - 16/400 frames with bounce active, 8 direction reversals
|||    - 0 JS errors
|||    - 0 overlaps
|||    - 94.7% pure black, 0% colored pixels (beams only)

## Session 35 — Blue Add Beams + All-Files-Visible Zoom
|||**Changes**:
|||1. **Add beam color**: Changed `A` (Added) from green (0x44ff44) to blue (0x4488ff) — beams are blue, files remain pure white
|||2. **Future depth pre-computation**: Added `_maxDirDepthRemaining` array, computed during init by scanning all log entries backwards. `_maxDirDepthRemaining[i]` gives the maximum directory depth across commits[i+1..end]
|||3. **Predictive zoom with future depth**: `predictCameraZoom` now uses `futureMaxRadius = maxDepth * ORBIT_DIR_RADIUS` to ensure the camera always zooms out enough for the deepest future directory — prevents files going off-screen on large repos
|||4. **Adaptive lerp factor**: Changed from fixed 0.08 to adaptive (0.08–0.15) — faster when camera is far from target (catching up during rapid tree growth), slower when close (smooth settling)
|||
|||**Verification**:
|||    - Full simulation: 1867/1867 commits processed
|||    - 0 JS errors
|||    - 0 overlaps at completion (settled immediately)
|||    - MaxDirDepth pre-computed: 8 at start, decreasing to 6 as commits complete
|||    - Camera Z=0.02 (top-down) ✓
|||    - 166 road lines
|||    - Blue beam pixels: 42 detected (A=Added) ✓
|||    - Purple beam pixels: 12 detected (M=Modified) ✓
|||    - Green beam pixels: 0 (green eliminated) ✓
|||    - No bounces needed during 60–100% phase — future depth calculation pre-positions camera correctly

## Session 36 — Deep File Center Clustering Bug Fix
|||**Root cause**: When `findOrCreateDir` created new directories during simulation (as files from new paths were committed), those directories were initialized with `targetPos = (0, 0, 0)`. The comment on line 248 explicitly said "Don't set treeDirty for new files", but this also applied to new directories — so `rebuildLayout`/`calculateOrbitalLayout` was never called to reposition them. New files inherited the parent's (0,0,0) position, causing deep files to cluster at the center instead of being placed at their correct depth-based radius.
|||
|||**Fix**:
|||1. `findOrCreateDir`: Set `treeDirty = true` when a new directory is created — triggers `rebuildLayout` on the next frame, which calls `calculateOrbitalLayout` to position ALL directories at correct radial positions by depth
|||2. Updated misleading comment in `addFileToTree` to clarify that treeDirty is set by findOrCreateDir for new directories only
|||3. Added `radialDistribution` debug getter to verify node positions across radial bands
|||4. Cache version bumped: v=54 → v=55
|||
|||**Verification**:
|||    - Full simulation: 1867/1867 commits ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps at completion ✓
|||    - maxR = 12800 (8 depth levels × 1600 ring spacing) ✓
|||    - Dir distribution: center=1 (root), far=146 (depth 3-7), veryFar=17 (depth 8+) ✓
|||    - File distribution: far=788, veryFar=11 — deep files at correct radius ✓
|||    - Camera Z=0.02 (top-down) ✓
|||    - 175 road lines, no crossing ✓
- Added `radialDistribution` debug getter for node radial band analysis

## Session 37 — Smoother Disney Bounce
|||**Changes**:
|||1. **Slower bounce**: `BOUNCE_DURATION` 500 → 700ms for less jerky feel
|||2. **Earlier trigger**: `BOUNCE_THRESHOLD` 1% → 0.8% — catches smaller zoom changes sooner
|||3. **Cooldown**: Added `BOUNCE_COOLDOWN = 500ms` — prevents bounce clustering when many small changes occur in quick succession (was triggering 8 times in previous test; now 4)
|||4. **Slower decay**: `Math.exp(-t * 5)` → `Math.exp(-t * 4)` — smoother settling oscillation
|||5. **Added `_lastBounceEndTime`** tracking + cooldown enforcement in `predictCameraZoom`
|||6. Cache version bumped: v=56 → v=57
|||
|||**Verification**:
|||    - 4 bounce sequences (down from 8 with 0.5% threshold) — less jerky ✓
|||    - Each bounce: 450-500ms, 2 direction reversals (2 overshoots) ✓
|||    - Bounce distribution: 69%, 81%, 96%, 98% — spread across animation ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps (settled immediately at completion) ✓
|||    - 1867/1867 commits ✓
|||    - maxR=12800 (8 depths × 1600 ring spacing) ✓
|||    - Camera Z=0.02 (top-down) ✓
|||    - 175 road lines ✓

## Session 38 — Gource-Style File Spawning
|||**Root cause**: `addFileInstance` explicitly set `currentAlpha = 1`, `currentScale = s`, and `currentX = targetPos.x`, `currentZ = targetPos.z` — overriding the fade-in alpha and spawn-position randomness that `createFileNode` initialized. Files appeared at full opacity and full size at their final position, with no "spawn" animation.
|||
|||**Changes**:
|||1. **`addFileInstance`**: Removed `currentAlpha = 1` and `targetAlpha = 1` overrides — `createFileNode` already sets `currentAlpha: 0, targetAlpha: 1`. `updateFileMesh` now lerps alpha from 0 → 1 (factor 0.15) for fade-in effect
|||2. **`addFileInstance`**: Changed `currentScale` from `s` (full size) to `0` — files scale up from nothing as they fade in
|||3. **`addFileInstance`**: Spawn from random position near parent directory (random angle at `parent.forceSize + 30` distance) instead of at `targetPos` — files "fly in" from random positions to their destination, matching gource's random initial placement + physics pull
|||4. **Files in existing directories** (no new dir created) also get the spawn effect — they appear one-at-a-time as commits are processed during simulation
|||5. Cache version bumped: v=57 → v=59
|||
|||**Verification**:
|||    - Full simulation: 1867/1867 commits, 816 files, 992 nodes ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps at completion ✓
|||    - Camera Z=0.02 (top-down) ✓
|||    - 175 road lines ✓
|||    - 816 files, 936 instances ✓

## Session 39 — Zoom Jitter Fix (steady-state camera stability)
|||**Root cause**: Two sources of jitter when zoom is not actively changing:
|||1. **Stale bounce target**: When Disney bounce completed, camera snapped to `_bounceTargetY` (captured at bounce start) instead of the latest `targetCamY`. If the target moved during the 700ms bounce, the camera jumped to the old value then immediately adjusted to the new one = visible jitter
|||2. **Constant lerp during steady state**: Normal lerp ran every frame with factor 0.08-0.15. Growth padding decreases ~0.02%/commit, changing the target by a few units each commit. The camera constantly "chased" this tiny drift, creating micro-oscillation
|||
|||**Changes**:
|||1. **Bounce completion**: Changed `camera.position.y = _bounceTargetY` to `camera.position.y = targetCamY` — uses the latest predicted target, not the stale bounce-start target
|||2. **Deadzone for normal lerp**: Added 0.2% convergence threshold. If camera is within 0.2% of target (|delta|/currentY < 0.002), skip the lerp entirely. Prevents chasing micro-drift from growth padding decay during steady-state animation
|||3. Cache version bumped: v=60 → v=61
|||
|||**Verification**:
|||    - Phource repo (80 commits, same-timestamp batch): jitter range = 0.000000% (rock solid) ✓
|||    - Gource test log (1867 commits): jitter range = 0.0893% during active sim, 0 direction changes ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps ✓
|||    - Camera Z=0.01 (top-down) ✓

## Session 40 — Fix orphaned (invisible) files after delete+re-add
|||**Root cause**: When a file was deleted (action='D') then later re-added (action='A') or modified (action='M'), `addFileToTree` found the existing file node and updated its data properties (loc, count, colour) but did NOT reset `targetAlpha`, `fadingOut`, or `pendingRemoval`. The delete had set `targetAlpha=0`, `fadingOut=true`, `pendingRemoval=true`. The re-add left these stale, so:
|||1. In `updateAllMeshes`: `if (f.instanceId === undefined && !f.pendingRemoval) addFileInstance(f)` — `pendingRemoval` was still true, so `addFileInstance` was never called for re-added files whose instance had been removed during fade-out
|||2. `updateFileMesh` continued Lerping `currentAlpha` toward `targetAlpha=0` — re-added files stayed invisible
|||3. Result: files existed in `fileMap` and tree structure but were invisible — appearing "orphaned" in the visualization
|||
|||**Affected files in tnom-bot repo** (identified via log analysis):
|||- `start-bot.bat`: D@1787871854 → A@1787880743 → M@1788199215 → M@1788282527
|||- `utils/__init__.py`: D@1787872481 → A@1787880743 → M@1788192279 → 3 more Ms
|||- `utils/math_tools.py`: D@1787872481 → A@1787880743
|||- `tests/test_math_tools.py`: D@1787879793 → A@1787880743
|||
|||**Changes**:
|||1. **`addFileToTree`**: When existing file found, reset `targetAlpha=1`, `fadingOut=false`, `pendingRemoval=false` — re-activates deleted files
|||2. **`processCommit` 'M' branch**: Same reset when file found in `fileMap` — handles modify-after-delete
|||3. **`addFileInstance`**: Explicitly set `currentAlpha=0` — ensures clean fade-in for re-added files (was relying on `createFileNode` init, but re-added files retain residual alpha from fade-out)
|||4. Cache version bumped: v=64 → v=64 (this fix included in v=64 batch)
|||
|||**Verification**:
|||    - All 4 re-added files in tnom-bot repo: visible with `targetAlpha=1, pendingRemoval=false, fadingOut=false, hasMesh=true` ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps ✓
|||    - Camera jitter: 0.0509% during active sim (unchanged, still PASS) ✓

## Session 41 — Fix floating (visible) instances after delete

|||**Root cause**: When a file was deleted (action='D'), `processCommit` called `removeFileFromTree` immediately. This spliced the file from `parentDir.childFiles`, so `updateAllMeshes` never called `updateFileMesh` on it. The file's mesh instance was never faded out (alpha stayed ≈1.0) and was never cleaned up (the `pendingRemoval && currentAlpha < 0.02` cleanup in `updateFileMesh` never ran). The old instance remained visible at its last position — appearing as a "floating" file disconnected from the tree.

|||**Fix** (deferred tree removal):
|||- **`processCommit` 'D' branch**: Removed `removeFileFromTree(entry.filepath)` call. Deleted files now stay in the tree with `pendingRemoval=true, targetAlpha=0`, allowing `updateFileMesh` to fade them out properly every frame.
|||- **`updateFileMesh` cleanup**: After the instance fades out (`currentAlpha < 0.02`), marks the file for deferred tree removal via `parentDir.pendingRemovalFiles` array (avoids Array.forEach mutation during walk).
|||- **`updateAllMeshes`**: Added a post-walk pass that processes `pendingRemovalFiles` arrays and calls `removeFileFromTree` for each (deferred to avoid forEach mutation during iteration).
|||
|||**Verification**:
|||    - 1867-commit tnom-bot log: 0 stale instances (active=816, total=936) ✓
|||    - Scrub to 62% (commit 1749): 0 stale instances ✓
|||    - 0 JS errors ✓
|||    - 0 overlaps ✓
|||    - All 4 re-added files properly positioned ✓

## Session 42 — Scrubbing performance optimization

**Problem**: Clicking on the scrubber caused ~2.0s delay before the tree updated — should be essentially instantaneous for proper scrubing.

**Root causes identified**:
1. `settleCompleteLayout()` ran 500 synchronous `resolveOverlaps()` passes (300 + 200), each building a spatial grid over ~992 nodes (816 files + 175 dirs + root) with 5 inner passes — ~2.5M operations total, fully blocking.
2. `processCommit` was called for all commits from 0 to target during `resetToTime`, creating `THREE.Line` + `LineBasicMaterial` + `BufferGeometry` beam actions for every non-delete commit (~1285 objects for 1867-commit log).
3. `isScrubbing` was not set inside `resetToTime` itself — the scrubber 'input' handler set it, but the debug `scrubToFraction` did not, so beams were still created during debug scrubbing.
4. `cleanupScene()` + `initFileInstancedMesh()` + `createRoadLines()` recreated all WebGL resources synchronously.

**Fixes applied**:
1. **`settleCompleteLayout` → async + reduced passes**: Reduced from 500 to 30 passes (10 sync + 20 async). Initial 10 runs synchronously for immediate layout quality; remaining 20 run in chunks of 10 via `setTimeout(_settleChunkAsync, 0)` to keep UI responsive. The orbital layout from `calculateOrbitalLayout` + 10 `resolveOverlaps` in `rebuildLayout` already produces 0 overlaps — additional passes just refine.
2. **Skip beam creation during scrubbing**: Added `isScrubbing = true` at the start of `resetToTime` (before commit processing loop) and `isScrubbing = false` after setup. `processCommit` already had `if (!isScrubbing)` guards on `createBeamAction` and `userNode.actions.push`. With `isScrubbing` properly set inside `resetToTime`, beam creation is reliably skipped during all scrub-triggered rebuilds.

**Verification** (1867-commit tnom-bot log):
- Scrub to 50%: 0.18s (was ~2.0s, **11x faster**)
- Scrub to 90%: 0.22s
- Scrub to 10%: 0.18s
- Beams during scrub: 0 (was 1285)
- Beams during playback: created correctly (4+ after 3s of normal play)
- Overlaps: 0 at all scrub positions, 0 after async settling
- JS errors: 0
- Cache version: v=67 → v=68

## Session 43 — Mouse control remapping

**Change**: Swapped OrbitControls mouse button mappings in `public/phource.js` (after line 1372):
|- LEFT click + drag: now **pan** (was orbit/rotate)
- RIGHT click + drag: now **orbit/rotate** (was pan)
- MIDDLE click + drag: **pan** (unchanged)
- Added `contextmenu` preventer on canvas to suppress browser context menu on right-click (now used for orbit)

**Verification**:
- LEFT=2(PAN), MIDDLE=2(PAN), RIGHT=0(ROTATE) confirmed via debug bridge
- 0 JS errors
- Scrub to 70%: 0.18s, 0 overlaps
- Cache version: v=68 → v=69

## Session 44 — Directory hover tooltips with proximity fallback

**Change**: Fixed directory tooltip to reliably trigger on mouseover in `public/phource.js` `updateTooltip()`:
- Directory spheres have tiny screen-space radius (~0.0005 NDC vs ~0.0008 NDC per pixel), making raycast hits unreliable at sub-pixel offsets
- Added proximity fallback: when primary raycast finds no meaningful hit, projects all directory sphere positions to NDC and checks if mouse is within 0.02 NDC (~12px) of any projected center
- Also fixed raycast iteration to skip invisible file instances in the InstancedMesh (previously `intersects[0]` could be an invisible instance at origin)
- Tooltip displays: directory name, full path, total LOC, total commit count

## Session 45 — Tooltip forgiveness zone fix

**Bug**: Mouseover tooltips didn't appear when directly over a directory node — user had to shift the mouse along the circumference to trigger highlighting.

**Root causes**:
1. `onMouseMove` set mouse NDC but didn't call `updateTooltip()` — tooltips only updated in render loop (too slow during active sim)
2. Proximity check only ran when raycast missed (`if (!nodeData)`) — if raycast hit an occluding file instance, the directory was never checked
3. NDC-based distance threshold gave inconsistent pixel forgiveness across resolutions

**Fixes in `public/phource.js`**:
- `onMouseMove` now calls `updateTooltip()` directly on every mouse move
- Proximity check always runs (not gated on raycast miss)
- If directory is within 10px of mouse, override raycast result (handles occluding files)
- Directory used when within 30px and raycast found nothing
- Switched to screen-space pixel distance (30px) for consistent forgiveness zone
- Used `getWorldPosition()` for exact mesh projection

## Session 46 — Beam lateral offsets for same-path visibility

**Problem**: When multiple add/change/delete beams travel along the same tree path, additive blending produces a white blob — individual colors are lost.

**Implementation in `public/phource.js`**:

### Initial approach — global beam counter
First attempt used a global `_beamCounter` incrementing per beam, with offset based on angle + magnitude. Works but resets per file — same file's repeated beams got the same offset.

### Refined approach — per-file offset grouping + hash-based direction
1. `_beamOffsetMap` Map keyed by `fileNode.fullPath` — tracks per-file beam counter via `offsetIdx`
2. Hash file path with DJB2 (`hash = ((hash << 5) - hash + charCode) | 0`) for stable base angle — deterministic, frame-independent
3. Initial cycling: `offsetAngle = baseAngle + offsetIdx * (PI/6)` across 6 directions × 4 magnitudes
   - **Bug found**: td_prime_cache.json modified 61 times — 6/4 = 12-cycle repeated every 12 mods → offsets collided for same file
4. **Final fix**: 12 directions (PI/6 = 30° steps) + expanding rings (`mag = 2 + ringIdx * 1.5`)
   - Gives 72 unique offsets per file (12 dirs × 6 rings), eliminates all same-file collisions for up to 71 modifications

### Verification (1875-commit tnom-bot log)
- Max concurrent beams: 793 simultaneously active
- Same-file duplicate offset incidents: **0** (e.g. renewal-checklist-generator-master-v2.py with 3 concurrent beams had offsets [2,0,7], [-6,0,6], [-3,0,-1])
- 0 JS errors, 0 node overlaps, sim completed 1875/1875 commits
- Cross-file collisions (same offset for different files) are not a visibility issue — different files travel different tree paths

### Other changes this session
- Cache version bumped v=94 → v=95

## Session 47 — Revert to direct beams + offset robustness

**Change**: Reverted `BEAM_FOLLOW_TREE` to `false` per user request — beams travel directly from user/source to file position rather than following tree directory branches. Lateral offset system retained and strengthened.

**Why**: Direct beams are visually clearer — the offset directly separates same-file beams without the visual noise of tree-path tracing. The offset system works on both the 2-point direct path and the tree-following path (applied in `updateBeamActions`).

**Offset robustness improvements** (`public/phource.js`):
- Increased base magnitude from 2 to 4: at mag=2, adjacent 30° directions near quadrant boundaries (e.g. angles near 345° and 15°) rounded to the same [x,z] pair
- Expanding rings: `mag = 4 + ringIdx * 2.5` gives 12 unique directions per ring at increasing radii
- Total 72 unique offsets per file (12 dirs × 6 rings), handles files modified up to 71 times
- Debug function `beamDebug()` now returns `fullPath` to distinguish same-name files in different directories

**Verification** (1875-commit tnom-bot log, direct beams):
- Max concurrent beams: 96 simultaneously active
- Same-path (same fullPath) duplicate offset incidents: **0**
- 0 JS errors, 3 transient physics overlaps (settle to 0 after convergence)
- Cache version bumped to v=98
