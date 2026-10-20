@echo off
REM phource — Generate log from current git repo, start server, open browser
REM Usage: phource [repo_path]

setlocal

REM --- Resolve phource project directory ---
set "PHOURCE_DIR=%~dp0.."
pushd "%PHOURCE_DIR%" >nul 2>&1
set "PHOURCE_DIR=%cd%"
popd >nul 2>&1

REM --- Determine repo path ---
set "REPO_PATH=%~1"
if "%REPO_PATH%"=="" (
    set "REPO_PATH=%cd%"
)

REM --- Check if repo_path is a git repo ---
if not exist "%REPO_PATH%\.git" (
    if not exist "%REPO_PATH%\.git" (
        echo phource: "%REPO_PATH%" is not a git repository.
        echo Usage: phource [repo_path]
        echo   If no repo_path is given, the current directory is used.
        exit /b 1
    )
)

REM --- Generate log ---
echo [phource] Generating log from "%REPO_PATH%"...
python "%PHOURCE_DIR%\scripts\generate-log.py" "%REPO_PATH%" -o "%PHOURCE_DIR%\public\phource.log"
if errorlevel 1 (
    echo [phource] WARNING: Log generation failed. Serving with existing test-gource-log.phource.
)

REM --- Start server ---
echo [phource] Starting server on http://localhost:3000
cd /d "%PHOURCE_DIR%"
start "" "http://localhost:3000"
node index.js
