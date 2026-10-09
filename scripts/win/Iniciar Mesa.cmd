@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Mesa Virtual
chcp 65001 >nul
pushd "%~dp0"

:run
if not exist "app\node\node.exe" if exist "app.old\node\node.exe" ren "app.old" "app"
"app\node\node.exe" "app\launcher\launcher.mjs" --root "%~dp0." %*
set "CODE=%ERRORLEVEL%"

if "%CODE%"=="75" (
  "%TEMP%\MesaVirtual-update\node.exe" "%TEMP%\MesaVirtual-update\launcher\launcher.mjs" --root "%~dp0." --apply-update
  if errorlevel 1 echo [Mesa Virtual] A atualizacao nao pode ser aplicada; continuando na versao atual.
  goto run
)

rem 130 e -1073741510 (0xC000013A) = Ctrl+C / fechar o console: saida normal.
if "%CODE%"=="130" set "CODE=0"
if "%CODE%"=="-1073741510" set "CODE=0"

if not "%CODE%"=="0" (
  echo.
  echo A mesa foi encerrada com erro ^(codigo %CODE%^).
  echo Registro: "%LOCALAPPDATA%\MesaVirtual\logs\launcher.log"
  pause
)
popd
endlocal & exit /b %CODE%
