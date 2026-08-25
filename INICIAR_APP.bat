@echo off
title Liquidity Lab V6
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ABRIR_LIQUIDITY_LAB.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo iniciar Liquidity Lab.
  pause
)
