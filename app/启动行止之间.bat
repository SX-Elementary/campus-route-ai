@echo off
setlocal
cd /d "D:\个人科研工作生活平台"
start "" /b "C:\Users\Jenny\Miniconda3\envs\deep_research\python.exe" -m http.server 4180
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:4180"
endlocal
