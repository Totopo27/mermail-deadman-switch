@echo off
title Anchor Solana Contract Builder (Docker)
echo ===============================================================
echo Compilando Smart Contract Anchor con Docker (Linux BPF Target)
echo ===============================================================

docker run --rm -v "%cd%:/workdir" -w /workdir quay.io/ottersec/anchor:v1.2.0 anchor build --no-idl

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ===============================================================
    echo [EXITO] Binario compilado en: target\deploy\mermail_deadman_vault.so
    echo ===============================================================
) else (
    echo.
    echo [ERROR] Fallo la compilacion en Docker. Revisa los mensajes arriba.
)

pause
