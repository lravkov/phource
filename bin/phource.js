#!/usr/bin/env node
/**
 * phource — CLI tool for phource.git visualization
 *
 * Generates a log from the current git repo (or a specified path),
 * starts the Express server, and opens a browser tab.
 *
 * Usage:  phource [repo_path] [--port 3000] [--no-browser]
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PROJECT_DIR = path.resolve(__dirname, '..');

// --- Parse args ---
const args = process.argv.slice(2);
let repoPath = process.cwd();
let port = 3000;
let shouldOpenBrowser = true;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') {
        port = parseInt(args[++i], 10);
    } else if (args[i] === '--no-browser' || args[i] === '-b') {
        shouldOpenBrowser = false;
    } else if (!args[i].startsWith('-')) {
        repoPath = path.resolve(args[i]);
    }
}

function log(msg) {
    console.log('[phource] ' + msg);
}

function findPython() {
    for (const name of ['python3', 'python', 'py']) {
        try {
            execSync(`${name} --version`, { stdio: 'ignore' });
            // Double-check: some Windows aliases (python3) exit 0 but don't work
            execSync(`${name} -c "import sys"`, { stdio: 'ignore' });
            return name;
        } catch (e) {
            // try next
        }
    }
    return null;
}

function isGitRepo(dir) {
    return fs.existsSync(path.join(dir, '.git'));
}

function generateLog(python, repoDir, outputPath) {
    const script = path.join(PROJECT_DIR, 'scripts', 'generate-log.py');
    log(`Generating log from ${repoDir}...`);
    try {
        execSync(`${python} "${script}" "${repoDir}" -o "${outputPath}"`, {
            stdio: 'inherit',
            cwd: PROJECT_DIR,
        });
        log(`Log saved to ${outputPath}`);
    } catch (e) {
        log(`WARNING: Log generation failed. Using existing test log.`);
    }
}

function openBrowser(url) {
    const startCmd = {
        darwin: 'open',
        win32: 'start',
        linux: 'xdg-open',
    }[process.platform];

    if (!startCmd) {
        log(`Could not open browser. Please visit ${url} manually.`);
        return;
    }

    try {
        if (process.platform === 'win32') {
            execSync(`start "" "${url}"`, { stdio: 'ignore' });
        } else {
            execSync(`"${startCmd}" "${url}"`, { stdio: 'ignore' });
        }
        log(`Browser opened at ${url}`);
    } catch (e) {
        log(`Could not open browser automatically. Please visit ${url}`);
    }
}

function waitForServer(url, maxRetries = 30) {
    return new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
            const req = http.get(url, (res) => {
                if (res.statusCode === 200) {
                    resolve(true);
                } else {
                    attempts++;
                    if (attempts < maxRetries) {
                        setTimeout(check, 500);
                    } else {
                        resolve(false);
                    }
                }
            });
            req.on('error', () => {
                attempts++;
                if (attempts < maxRetries) {
                    setTimeout(check, 500);
                } else {
                    resolve(false);
                }
            });
        };
        check();
    });
}

async function main() {
    log(`phource visualization engine`);
    log(`Project directory: ${PROJECT_DIR}`);

    // 1. Check for git repo
    if (isGitRepo(repoPath)) {
        const python = findPython();
        if (python) {
            const logPath = path.join(PROJECT_DIR, 'public', 'phource.log');
            generateLog(python, repoPath, logPath);
        } else {
            log('Python not found. Skipping log generation. Using existing log.');
        }
    } else {
        log(`"${repoPath}" is not a git repository. Using existing test log.`);
    }

    // 2. Start server
    log(`Starting server on port ${port}...`);
    const server = spawn('node', [path.join(PROJECT_DIR, 'index.js')], {
        cwd: PROJECT_DIR,
        stdio: 'pipe',
        env: { ...process.env, PORT: String(port) },
    });

    server.stdout.on('data', (data) => {
        const text = data.toString().trim();
        if (text) log(text);
    });
    server.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) console.error('[phource] ' + text);
    });

    // 3. Wait for server to be ready
    const url = `http://localhost:${port}`;
    log('Waiting for server to start...');
    const ready = await waitForServer(url);

    if (ready) {
        log('Server is ready!');
        // 4. Open browser
        if (shouldOpenBrowser) {
            openBrowser(url);
        }
        log('Press Ctrl+C to stop the server.');
    } else {
        log('ERROR: Server did not start within the expected time.');
    }

    // Keep the process alive
    process.on('SIGINT', () => {
        log('Shutting down...');
        server.kill();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        server.kill();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error('[phource] Fatal error:', err.message);
    process.exit(1);
});
