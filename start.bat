@echo off
title CBT Platform launcher
echo Starting CBT Platform (API :4001 + Client :5174)...
:: free the ports first (targeted — only kills what holds 4001/5174)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":4001" ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5174" ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
timeout /t 1 >nul
start "cbt-api" cmd /k "cd /d %~dp0server && node src/index.js"
start "cbt-client" cmd /k "cd /d %~dp0client && npm run dev -- --port 5174"
powershell -NoProfile -Command "$i=0; while($i -lt 90 -and -not (Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue)){ Start-Sleep -Seconds 1; $i++ }"
start http://localhost:5174
