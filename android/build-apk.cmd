@echo off
rem Wrapper for build-apk.ps1: the default Windows execution policy blocks
rem running a .ps1 directly, so this launches it with a Bypass scope for the
rem current process only (no system setting is changed).
rem Usage: build-apk.cmd [-Release] [-SkipWeb]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1" %*
exit /b %ERRORLEVEL%
