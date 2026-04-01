@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo [灵感栗子树] 正在启动本地服务器（端口 5173）...
echo 请勿关闭随后出现的黑色窗口，否则页面会无法加载。
echo.
start "栗子树-本地服务" cmd /k "npx --yes serve -l 5173 ."
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173/"
echo 已在浏览器打开 http://localhost:5173/
echo.
pause
