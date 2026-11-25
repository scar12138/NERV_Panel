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
set "STARTTIME=%TIME: =0%"
node server\index.js
set CODE=%ERRORLEVEL%
set "ENDTIME=%TIME: =0%"

rem 正常退出（Ctrl+C 或收到关闭信号，服务端以 0 退出）时不再重启
if "%CODE%"=="0" goto :done

rem 端口占用等配置错误以 2 退出，不再自动重启
if "%CODE%"=="2" (
  echo.
  echo   [端口已被占用，请修改 config.json 中的 port，不再自动重启]
  pause
  goto :done
)

rem 运行时间超过 30 秒则视为稳定运行后崩溃，重置计数器
set /a SH=1%STARTTIME:~0,2%-100, SM=1%STARTTIME:~3,2%-100, SS=1%STARTTIME:~6,2%-100
set /a EH=1%ENDTIME:~0,2%-100, EM=1%ENDTIME:~3,2%-100, ES=1%ENDTIME:~6,2%-100
set /a ELAPSED=(EH-SH)*3600+(EM-SM)*60+(ES-SS)
if %ELAPSED% LSS 0 set /a ELAPSED+=86400
if %ELAPSED% GEQ 30 (
  set CRASH=0
  echo.
  echo   [服务已稳定运行 %ELAPSED% 秒后退出，已重置崩溃计数器]
)

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
