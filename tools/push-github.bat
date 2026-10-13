@echo off
REM ============================================================
REM  Ice Voice Changer - one-shot GitHub upload helper
REM  ASCII-only on purpose: avoids .bat encoding problems.
REM  Usage:  push-github.bat <github-user> <repo-name>
REM  Token : set env  GITHUB_TOKEN  before running,
REM          you will be prompted if it is missing.
REM  All temporary data stays on the drive where this .bat lives.
REM ============================================================
setlocal
cd /d "%~dp0.."

if "%~1"=="" (
  echo [ERROR] Usage: push-github.bat ^<github-user^> ^<repo-name^>
  pause & exit /b 1
)
set OWNER=%~1
set REPO=%~2
set BRANCH=main

echo.
echo === Ice Voice Changer uploader ===
echo    repo   : https://github.com/%OWNER%/%REPO%
echo    branch : %BRANCH%
echo    folder : %CD%
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] git not found in PATH. Install Git for Windows first.
  pause & exit /b 1
)

REM ---- 1. token ----
if "%GITHUB_TOKEN%"=="" (
  set /p GITHUB_TOKEN=Personal Access Token (hidden recommended): 
)
if "%GITHUB_TOKEN%"=="" (
  echo [ERROR] No token. Create one at https://github.com/settings/tokens
  echo         with scope 'repo'. Never type it here if you can avoid it.
  pause & exit /b 1
)

REM ---- 2. init / remote ----
if not exist ".git" (
  git init -q
  echo [ok] git init done
)
git branch -M %BRANCH% 2>nul

git remote remove origin 2>nul
git remote add origin https://%OWNER%:%GITHUB_TOKEN%@github.com/%OWNER%/%REPO%.git

REM ---- 3. stage everything that should ship ----
git add -A
git status --short
echo.

set /p GO=Proceed with commit + push? (y/n) :
if /i not "%GO%"=="y" (
  echo Aborted by user. Nothing was pushed.
  pause & exit /b 0
)

git -c user.name="%OWNER%" -c user.email="%OWNER%@users.noreply.github.com" commit -q -m "Update: full library (index.html + js/docs/tools/examples) + standalone build"
git push -u origin %BRANCH%

REM ---- 4. safety: strip the token out of remote URL ----
git remote set-url origin https://github.com/%OWNER%/%REPO%.git
echo.
echo [done] Token removed from remote URL. Verify:
echo        https://github.com/%OWNER%/%REPO%
echo        https://raw.githubusercontent.com/%OWNER%/%REPO%/%BRANCH%/js/ice-voice-core.js
pause
endlocal
