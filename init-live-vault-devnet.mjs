/**
 * Live Solana Devnet Vault Initialization & Deposit Script
 * Interacts directly with the deployed Anchor Smart Contract on Devnet:
 * Program ID: E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX
 * 
 * 1. Derives the deterministic PDA: [b"deadman_vault", owner]
 * 2. Initializes the Vault on-chain (initialize_vault)
 * 3. Deposits real Devnet SOL into the Vault PDA (deposit_funds)
 * 4. Reads and validates the on-chain account state from Solana RPC
 */

import fs from "fs";
import crypto from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX");
const DEVNET_RPC = "https://api.devnet.solana.com";

function getAnchorDiscriminator(instructionName) {
  return crypto.createHash("sha256").update(`global:${instructionName}`).digest().subarray(0, 8);
}

async function main() {
  console.log("===============================================================");
  console.log("⚡ INICIALIZANDO BÓVEDA PDA REAL EN SOLANA DEVNET ⚡");
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);
  console.log("===============================================================\n");

  const connection = new Connection(DEVNET_RPC, "confirmed");

  // 1. Cargar la cuenta del owner (deployer)
  const keypairRaw = JSON.parse(fs.readFileSync("deployer-keypair.json", "utf-8"));
  const owner = Keypair.fromSecretKey(new Uint8Array(keypairRaw));
  const balanceSol = (await connection.getBalance(owner.publicKey)) / 1e9;

  console.log(`[1] Owner / Deployer Account:`);
  console.log(`   - Public Key: ${owner.publicKey.toBase58()}`);
  console.log(`   - Balance:    ${balanceSol} SOL en Devnet\n`);

  // 2. Beneficiario designado (usamos la wallet del beneficiario de las pruebas)
  const beneficiary = new PublicKey("F9tjfnvJUy8EYip947GhYM4YW7kG6U5hDcMFc3DRFbwE");
  console.log(`[2] Beneficiario Designado:`);
  console.log(`   - Public Key: ${beneficiary.toBase58()}\n`);

  // 3. Derivar la dirección de la Bóveda PDA en Solana
  const [vaultPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("deadman_vault"), owner.publicKey.toBuffer()],
    PROGRAM_ID
  );

  console.log(`[3] Bóveda Program Derived Address (PDA):`);
  console.log(`   - Seeds:      [b"deadman_vault", owner]`);
  console.log(`   - Vault PDA:  ${vaultPda.toBase58()} (Bump: ${bump})`);
  console.log(`   - Explorer:   https://explorer.solana.com/address/${vaultPda.toBase58()}?cluster=devnet\n`);

  // 4. Verificar si la cuenta ya existe en la blockchain
  const existingAccount = await connection.getAccountInfo(vaultPda);

  if (!existingAccount) {
    console.log(`[4] Creando e inicializando la Bóveda en Solana Devnet...`);

    const intervalSeconds = BigInt(30 * 86400); // 30 días
    const graceSeconds = BigInt(14 * 86400);    // 14 días

    const disc = getAnchorDiscriminator("initialize_vault");
    const intervalBuf = Buffer.alloc(8);
    intervalBuf.writeBigInt64LE(intervalSeconds);
    const graceBuf = Buffer.alloc(8);
    graceBuf.writeBigInt64LE(graceSeconds);

    const guardianOpt = Buffer.from([0]); // None
    const oracleOpt = Buffer.from([0]);   // None

    const instructionData = Buffer.concat([
      disc,
      intervalBuf,
      graceBuf,
      beneficiary.toBuffer(),
      guardianOpt,
      oracleOpt
    ]);

    const initIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: owner.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: instructionData
    });

    const tx = new Transaction().add(initIx);
    const txSig = await sendAndConfirmTransaction(connection, tx, [owner]);

    console.log(`   ✅ [EXITO] Bóveda inicializada on-chain!`);
    console.log(`   - Tx Hash:  ${txSig}`);
    console.log(`   - Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet\n`);
  } else {
    console.log(`[4] La Bóveda PDA ya se encuentra inicializada en Devnet.\n`);
  }

  // 5. Depositar fondos reales (0.1 SOL = 100,000,000 lamports) en la Bóveda PDA
  console.log(`[5] Depositando 0.1 SOL en la Bóveda PDA...`);
  const depositLamports = BigInt(100_000_000); // 0.1 SOL
  const depositDisc = getAnchorDiscriminator("deposit_funds");
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigInt64LE(depositLamports);
  const depositData = Buffer.concat([depositDisc, amountBuf]);

  const depositIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: depositData
  });

  const depositTx = new Transaction().add(depositIx);
  const depositSig = await sendAndConfirmTransaction(connection, depositTx, [owner]);

  console.log(`   ✅ [EXITO] 0.1 SOL depositados en el contrato on-chain!`);
  console.log(`   - Tx Hash:  ${depositSig}`);
  console.log(`   - Explorer: https://explorer.solana.com/tx/${depositSig}?cluster=devnet\n`);

  // 6. Enviar Ping de prueba (ping_heartbeat) para resetear el reloj on-chain
  console.log(`[6] Enviando Ping Heartbeat on-chain para resetear el reloj de vida...`);
  const pingDisc = getAnchorDiscriminator("ping_heartbeat");
  const pingIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false }
    ],
    data: pingDisc
  });

  const pingSig = await sendAndConfirmTransaction(connection, new Transaction().add(pingIx), [owner]);
  console.log(`   ✅ [EXITO] Ping de vida confirmado en la blockchain!`);
  console.log(`   - Tx Hash:  ${pingSig}`);
  console.log(`   - Explorer: https://explorer.solana.com/tx/${pingSig}?cluster=devnet\n`);

  // 7. Consultar y auditar el estado on-chain de la Bóveda
  console.log(`[7] Auditando estado final en la blockchain de Solana:`);
  const pdaAccount = await connection.getAccountInfo(vaultPda);
  const pdaBalance = pdaAccount.lamports / 1e9;

  console.log(`   - Owner del programa: ${pdaAccount.owner.toBase58()}`);
  console.log(`   - Balance total PDA:  ${pdaBalance} SOL (Fondos custodiados + Rent-Exempt)`);
  console.log(`   - Tamaño de datos:    ${pdaAccount.data.length} bytes`);

  // Deserializar campos de la cuenta Anchor (primeros 8 bytes son discriminador de cuenta)
  const data = pdaAccount.data;
  const storedOwner = new PublicKey(data.subarray(8, 40));
  const storedBeneficiary = new PublicKey(data.subarray(40, 72));

  console.log(`   - Owner guardado en PDA:       ${storedOwner.toBase58()}`);
  console.log(`   - Beneficiario guardado:       ${storedBeneficiary.toBase58()}`);

  console.log("\n===============================================================");
  console.log("🏆 BÓVEDA PDA OPERATIVA, FONDEADA Y PINGEADA EN DEVNET");
  console.log("===============================================================");
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
