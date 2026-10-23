# phource

3D git commit history visualization combining gource's time-based animation with city-blocks' loc-proportional file volumes. Shows **which files are being churned** and **how branches diverge** — things gource cannot display.

## What problem does this solve?

A static bar chart tells you *how much* was committed. A gource animation tells you *when* files were touched. But neither tells you **which files are most actively churned** or **how two branches diverge**.

phource fills both gaps in a single 3D visualization:

- **File churn at a glance**: Each file is rendered as a 3D building whose size encodes cumulative lines of code × commit count. A heavily-modified file grows large and tall. A stale file stays small. One look tells you where the action is.
- **Branch comparison**: Compare two git branches side by side in a shared timeline. See where they diverge, which areas each branch touches, and how they might merge — without switching context.

## Features

- 3D city-blocks-style visualization with LOC-proportional file volumes
- Per-user avatar tracking with colored beams (green = add, purple = modify, red = delete)
- Time scrubbing and play/pause controls
- Predictive camera zoom with 5-commit lookahead
- Directory hover tooltips
- Branch-aware side-by-side comparison (coming soon)

## Quickstart

```bash
npm install
node index.js
```

Then open `http://localhost:3000` in your browser.

### Loading your git history

Generate a log from any git repository:

```bash
python scripts/generate-log.py /path/to/your/repo
```

This produces `public/phource.log` — a single file that phource reads on startup.

## Screenshots

![phource example](examples/phource-example.png)

*Example: phource visualization showing file buildings with churn-proportional volumes and user beams.*

![phource example 2](examples/phource-example2.png)

*The top-down monochrome view with colored action beams.*

## How it works

phource reads an extended gource custom log format:

```
timestamp|username|action|filepath|loc|count|colour_hex
```

- `timestamp` — Unix epoch seconds
- `username` — Git author name
- `action` — A (added), M (modified), D (deleted)
- `filepath` — Full path
- `loc` — Lines of code at that commit
- `count` — Cumulative commit count for that file

Each file is rendered as a 3D box whose width/depth = `loc * count^(-p/2)` and height = `loc * count^p` (p=0.2). This means:
- **Large files** appear wide
- **Frequently-touched files** appear tall
- **Volume = loc³** — a single metric combining size and churn

## Roadmap

- [ ] Branch support (side-by-side git branch comparison)
- [ ] GitHub PR integration (contextual file history during review)
- [ ] Focus mode (highlight one user/team, dim others)

## License

MIT
