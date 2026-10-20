#!/usr/bin/env python3
"""
phource log generator.

Generates a phource log from a git repository. The phource log extends
gource's custom log format with lines-of-code (loc) and cumulative commit
count (count) per file, enabling both time-based animation (like gource)
and loc-proportional file volumes (like city-blocks).

Log format (pipe-delimited):
    timestamp|username|action|filepath|loc|count

Where:
    timestamp  - unix timestamp of the commit
    username   - committer/author name
    action     - A (added), M (modified), D (deleted)
    filepath   - file path relative to repo root
    loc        - lines of code in the file at this commit
    count      - cumulative number of commits touching this file (including this one)

Usage:
    python3 generate-log.py <repo-path> [--output <file>] [--exclude <pattern>]

If --output is omitted, prints to stdout.
"""

import sys
import os
import subprocess
import argparse
import hashlib
import fnmatch


def colour_hash(filepath):
    """Generate a deterministic RGB hex colour from the file path/extension."""
    ext = filepath.rsplit('.', 1)[-1] if '.' in filepath else ''
    h = int(hashlib.md5(ext.encode()).hexdigest(), 16)
    r = (h >> 0) & 0xFF
    g = (h >> 8) & 0xFF
    b = (h >> 16) & 0xFF
    return f"{r:02X}{g:02X}{b:02X}"


def parse_args():
    p = argparse.ArgumentParser(description='Generate a phource log from a git repository.')
    p.add_argument('repo', help='Path to the git repository')
    p.add_argument('--output', '-o', default=None,
                   help='Output file (default: stdout)')
    p.add_argument('--exclude', '-e', action='append', default=[],
                   help='Glob pattern to exclude (e.g. "*.json"). Can be repeated.')
    p.add_argument('--author-time', action='store_true',
                   help='Use author timestamp instead of committer timestamp')
    return p.parse_args()


def matches_exclusions(filepath, patterns):
    """Check if a filepath matches any exclusion glob pattern."""
    if not patterns:
        return False
    name = filepath
    for pat in patterns:
        if fnmatch.fnmatch(name, pat):
            return True
        # Also check just the basename
        basename = os.path.basename(name)
        if fnmatch.fnmatch(basename, pat):
            return True
    return False


def run_git_log(repo_path, author_time=False):
    """
    Run git log with --numstat to get per-commit file changes with LOC data.

    Returns raw output string.

    Uses: git log --reverse --numstat --no-renames --pretty=format:user:%aN%n%ct
    """
    time_format = '%at' if author_time else '%ct'
    cmd = [
        'git', 'log',
        '--reverse',
        '--numstat',
        '--no-renames',
        '--pretty=format:user:%aN%n' + time_format,
    ]
    result = subprocess.run(cmd, cwd=repo_path, capture_output=True,
                            text=True, check=True)
    return result.stdout


def parse_numstat_log(output, exclude_patterns):
    """
    Parse the git log --numstat output.

    Yields tuples: (timestamp, username, action, filepath, loc, count)

    Uses a running LOC tracker per filepath to determine added/removed/modified.
    """
    lines = output.split('\n')
    i = 0

    # State per file
    file_locs = {}       # filepath -> current loc
    file_counts = {}     # filepath -> cumulative commit count

    while i < len(lines):
        line = lines[i]
        i += 1

        # Look for the start of a commit entry
        if not line.startswith('user:'):
            continue

        username = line[5:]  # strip 'user:' prefix
        if i < len(lines):
            timestamp = lines[i].strip()
            i += 1
        else:
            break

        if not timestamp:
            break

        try:
            timestamp_int = int(timestamp)
        except ValueError:
            continue

        # Collect numstat lines until we hit the next 'user:' or end of output
        commit_files = []
        while i < len(lines):
            numstat_line = lines[i]
            i += 1

            if numstat_line.startswith('user:'):
                # Next commit starts; back up
                i -= 1
                break

            if numstat_line.strip() == '':
                continue

            parts = numstat_line.split('\t')
            if len(parts) < 3:
                continue

            added_str, removed_str, filepath = parts[0], parts[1], parts[2]

            # Skip excluded files
            if matches_exclusions(filepath, exclude_patterns):
                continue

            # Handle binary files (shown as '-' for added/removed)
            if added_str == '-' or removed_str == '-':
                added, removed = 0, 0
                is_binary = True
            else:
                try:
                    added = int(added_str)
                    removed = int(removed_str)
                    is_binary = False
                except ValueError:
                    continue

            prev_loc = file_locs.get(filepath, 0)
            new_loc = prev_loc + added - removed

            # Determine action
            if prev_loc == 0 and new_loc > 0:
                action = 'A'
            elif new_loc <= 0:
                action = 'D'
                new_loc = 0
            else:
                action = 'M'

            # Update state
            file_locs[filepath] = new_loc
            if action != 'D':
                file_counts[filepath] = file_counts.get(filepath, 0) + 1
            else:
                file_counts[filepath] = file_counts.get(filepath, 0) + 1

            commit_files.append((timestamp_int, username, action, filepath,
                                  new_loc, file_counts[filepath]))

        # Output files for this commit
        for entry in commit_files:
            yield entry


def main():
    args = parse_args()

    repo_path = os.path.abspath(args.repo)

    if not os.path.isdir(os.path.join(repo_path, '.git')):
        print(f"Error: {repo_path} is not a git repository", file=sys.stderr)
        sys.exit(1)

    # Load exclusion patterns from .stat_exclude in repo if not provided via CLI
    exclude_file = os.path.join(repo_path, '.stat_exclude')
    if os.path.isfile(exclude_file) and not args.exclude:
        with open(exclude_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    args.exclude.append(line)

    output_handle = None
    if args.output:
        output_handle = open(args.output, 'w')

    count = 0
    try:
        raw = run_git_log(repo_path, args.author_time)
        for timestamp, username, action, filepath, loc, file_count in \
                parse_numstat_log(raw, args.exclude):
            colour = colour_hash(filepath)
            line = f"{timestamp}|{username}|{action}|{filepath}|{loc}|{file_count}|{colour}"
            if output_handle:
                output_handle.write(line + '\n')
            else:
                print(line)
            count += 1
    finally:
        if output_handle:
            output_handle.close()

    print(f"\nGenerated {count} log entries", file=sys.stderr)


if __name__ == '__main__':
    main()
