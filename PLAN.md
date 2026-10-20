# phource — Plan

## Goal
Combine gource's time-evolving animation with per-user commit actors, with city-blocks' file-size-proportional volume visualization (loc^3 volume, height factored by commit count).

## Decisions (confirmed by user)
1. **Technology**: Three.js (browser-based, WebGL) — reuses city-blocks' rendering approach.
2. **Animation model**: Hybrid — gource-style time evolution (commits stream in over time, users move toward files, files appear/disappear) with city-blocks-style 3D boxes that resize smoothly as loc/count change.
3. **Data input**: Direct from git repo. Log generation script produces an extended gource custom log format with LOC: `timestamp|username|action(A/M/D)|filepath|loc|optional_colour_hex`

## Source Repo Summary

### gource (C++ / OpenGL, native desktop, ~10k LOC) — REFERENCE ONLY
Key concepts to port:
- **Animation loop**: `commitqueue` holds commits; `currtime` advances by `days_per_second * dt * 86400`; commits fire when timestamp <= currtime.
- **User model**: Users appear at directory positions, move via physics (acceleration toward file actions, repulsion from other users). Fade after idle time.
- **File actions**: CreateAction (green beam), ModifyAction (orange beam), RemoveAction (red beam). Beam lines draw from user to file.
- **Commit processing**: `processCommit()` iterates commit's files; for each, finds or creates an `RFile` in the `RDirNode` tree, then creates an `RAction` linking the user to the file.
- **Log format (custom)**: `timestamp|username|action|filename|optional_colour`
- **Git log command**: `git log --reverse --raw --encoding=UTF-8 --no-renames --pretty=format:user:%aN%n%ct`
- **Directory tree**: `RDirNode` with QuadTree physics (repulsion/gravity). NOT used in phource — city-blocks' grid layout is preferred.

### city-blocks (JS / Three.js, browser, ~600 LOC) — REUSED + EXTENDED
Key components to reuse/extend:
- **File sizing model** (keep as-is):
  - Width = `loc * count^(-p/2)`, Depth = `loc * count^(-p/2)`, Height = `loc * count^p` (p=0.2)
  - Volume = `loc^3`
  - Heat color = `count / max(count)` mapped yellow→red
- **Directory layout** (adapt to be dynamic): Foundation boxes, darken 0.08 per depth level, grid packing with padding.
- **Three.js rendering** (reuse): OrbitControls, directional light + shadow, ambient light, raycaster for tooltips.
- **Data format**: Extended CSV / custom log with `timestamp|username|action|filepath|loc`

## phource Architecture

### Data Pipeline
1. `scripts/generate-log.py` — Given a git repo path, runs `git log` and produces a phource log:
   - Parse git log with custom format to get per-commit file modifications (timestamp, username, action, filepath)
   - For each modified file at each commit, compute its current LOC (lines in the file version at that commit) via `git show <commit>:<filepath>`
   - Also compute cumulative commit count per file for city-blocks-style height factoring
   - Output: `timestamp|username|action|filepath|loc|colour_hex`
   - Optional .stat_exclude support for filtering

### Visualization Engine (Three.js)
- **Time manager**: Advances simulation time, processes commits from a sorted queue
- **File system**: 3D boxes with volume = loc^3, height scaled by commit count (city-blocks formula). Smoothly interpolate size changes when loc updates.
- **User avatars**: Simple 3D objects (sprites or cones) that move toward files they're committing to. Draw beam lines (like gource) from user to file.
- **Directory tree**: Adapted from city-blocks grid packing. Rebuild layout when files are added/removed, animate position transitions.
- **Camera**: OrbitControls (from city-blocks). Optional auto-track of active users.
- **Scene**: Same lighting setup as city-blocks (ambient + directional + shadows).

### Project Structure
  bin/
    phource.js         (CLI tool — generates log, starts server, opens browser)
  public/
    index.html          (canvas + Three.js importmap + error handler)
    phource.js          (main visualization engine — 950 lines)
    js/three/            (local Three.js + OrbitControls, no CDN needed)
    test-gource-log.phource  (test log from gource repo — 2586 entries)
    phource.log          (generated log from current git repo)
    |    screenshot.png       (render output sample)
    |    scrubber CSS        (scrubber bar styles, embedded in index.html)
    |  scripts/
    generate-log.py     (git log -> phource log generator)
  tests/
    test-gource-log.phource  (test log output)
  _repos/               (source repos, not part of project)
    gource/
    city-blocks/

### CLI Usage
Install globally (once):
```bash
cd C:/Users/Lucas/Documents/2026/projects/phource
npm link
```

Then from any git repository:
```bash
cd /path/to/your/repo
phource              # generate log, start server, open browser
phource --port 8080  # custom port
phource --no-browser # start server without opening browser
phource /path/to/repo  # specify repo path (defaults to current dir)
```
