@echo off
chcp 65001 >nul
title NERV PANEL
cd /d "%~dp0"

echo.
echo   NERV PANEL / 启动中
echo   ----------------------------------------
echo.

set CRASH=0

:loop
node server\index.js
set CODE=%ERRORLEVEL%

rem 正常退出（Ctrl+C 或收到关闭信号，服务端以 0 退出）时不再重启
if "%CODE%"=="0" goto :done

set /a CRASH+=1
echo.
echo   [服务异常退出：代码 %CODE%，第 %CRASH% 次]
echo   [5 秒后自动重启，按 Ctrl+C 可中止]
echo.
if %CRASH% GEQ 20 (
  echo   连续崩溃 20 次，已停止自动重启。
  echo   请查看 logs 目录下的日志排查原因，或直接运行 npm start 观察报错。
  pause
  goto :done
)
timeout /t 5 /nobreak >nul
goto :loop

:done
echo.
echo   服务已停止。
pause
