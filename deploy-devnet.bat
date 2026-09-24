@echo off
title Deploy Mermail Dead Man Vault to Solana Devnet
echo ===============================================================
echo Deploying Anchor Smart Contract to Solana Devnet via Docker
echo ===============================================================

docker run --rm -v "%cd%:/workdir" -w /workdir quay.io/ottersec/anchor:v1.2.0 solana program deploy target/deploy/mermail_deadman_vault.so --url devnet

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ===============================================================
    echo [EXITO] Contrato desplegado en Solana Devnet!
    echo ===============================================================
) else (
    echo.
    echo [AVISO] Para fondear la keypair de deploy en Devnet:
    echo solana airdrop 2 ^<PUBKEY^> --url devnet
)

pause
