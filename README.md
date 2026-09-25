# Mermail Dead Man's Switch: Autonomous Digital Contingency & Inheritance Protocol

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Superteam Earn](https://img.shields.io/badge/Superteam_Earn-Bounty-purple.svg)](https://earn.superteam.fun/)
[![Solana Devnet](https://img.shields.io/badge/Solana_Devnet-Verified_Program-green.svg)](https://explorer.solana.com/address/E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX?cluster=devnet)
[![Tests: 11/11 Passing](https://img.shields.io/badge/Unit_Tests-11%2F11_Passing-brightgreen.svg)]()
[![Red Team: 8/8 Neutralized](https://img.shields.io/badge/Red_Team-8%2F8_Neutralized-brightgreen.svg)]()

> **Autonomous Digital Contingency, Multi-Asset Inheritance, and Dead Man's Switch Protocol for Mermail and Solana.**  
> Built for the Superteam Earn *"Build and Demo a Mermail Agent Skill"* Bounty.

---

## Overview & Architecture

In Web3 and decentralized finance, catastrophic events such as incapacitation or sudden demise frequently lead to the permanent loss of crypto assets, seed phrases, private keys, and infrastructure access. Traditional centralized custodians (notaries, legacy banks) are slow, expensive, and introduce trusted third-party risk. Conversely, naive AI agents reading emails suffer from Indirect Prompt Injection (IPI), SMTP header spoofing, single-point key exposure, and fatal false positives.

The **Mermail Dead Man's Switch** transforms an AI agent into an autonomous, non-custodial contingency notary leveraging a **Dual-Core Architecture**:

1. **Deterministic Mathematical Kernel (Solana Anchor + Node.js Engine):**
   - **Passive Mixed Liveness:** Monitors on-chain Solana activity (`getSignaturesForAddress`). If the principal executes swaps on Jupiter or transfers on-chain, the timer resets automatically without requiring manual emails.
   - **Ed25519 Cryptographic Proof of Life:** Active email heartbeats require detached digital signatures matching the owner's Solana keypair, neutralizing spoofed email relays.
   - **Threshold Custody (Shamir's Secret Sharing 2-of-3):** Secret keys are fragmented across Galois Field $\text{GF}(2^8)$. The agent custodially locks only Shard #2. Breaching the server or inbox yields only useless mathematical noise.
   - **Native Solana Anchor Smart Contract (`mermail_deadman_vault`):** A PDA-governed vault (`[b"deadman_vault", owner]`, Program ID: `E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX`) enforcing on-chain timelocks, self-custodial withdrawals, SPL Token (USDC) multi-asset custody, Pyth Network price feeds, Squads Multisig compatibility, and legal oracle bypasses (`attest_oracle_trigger`).
   - **Serverless Cloudflare Worker:** $0/month edge execution with Cron Triggers every 12 hours, 1-Click Vault Setup API, and real-time Mermail webhook receivers.

2. **AI Notary Advisor (Human-Facing Layer):**
   - Decoupled from execution authority (cannot trigger the switch or mutate recipient wallets).
   - Generates empathetic, step-by-step recovery guidance for non-technical beneficiaries upon contingency execution.
   - Analyzes natural language medical/travel distress reports to suggest emergency guardian verification holds.

---

## Multi-Tiered Deterministic Lifecycle

```
[ARMED] ──(T1: Inactivity)──► [TIER 1: Soft Ping] ──(T2: Warning)──► [TIER 2: Urgent Alert]
   ▲                                                                          │
   │                                                                          ▼
   │                                                             [TIER 3: Guardian Escalation]
   │                                                                    │              │
   │                                                 (Guardian Hold)    │              │ (Grace Expired)
   │                                                        ▼           │              ▼
   └──(Valid Ed25519 Heartbeat)──────────────────── [GUARDIAN_HOLD] ────┘        [TRIGGERED (Irrevocable)]
```

1. **`ARMED` (Continuous Vigilance):**
   - Refreshed passively by Solana on-chain activity or actively by Ed25519-signed emails.
2. **`TIER 1 (Soft Ping - Day 30)`:**
   - Dispatches a private, non-alarming reminder to the owner with Pyth Network USD valuations.
3. **`TIER 2 (Multi-Channel Urgent Notice - Day 37)`:**
   - Escalates priority and warns of impending contingency procedures via email and Telegram.
4. **`TIER 3 (Guardian Escalation - Day 45)`:**
   - Alerts designated trusted guardians (or Guardian Squads multisig). Guardians can invoke `applyGuardianHold` (14-day hold, max 60 days cumulative) during medical emergencies.
5. **`TRIGGERED` (Irrevocable Contingency Protocol - Day 60):**
   - Releases the custodied Shamir Shard #2 to the beneficiary via secure Mermail email.
   - Dispatches on-chain rescue funds via PayBox (`paybox_request_transfer`).
   - Unlocks autonomous multi-asset on-chain inheritance claim (SOL + USDC) via the Anchor Smart Contract PDA.

---

## Security Architecture & Zero-Trust Threat Model

| Attack Vector | Threat Scenario | Mitigation Mechanism |
|---|---|---|
| **Indirect Prompt Injection (IPI)** | Attacker sends email claiming to be system admin demanding instant asset transfer. | **Dual-Core Decoupling:** Time evaluation and state progression are deterministic mathematical code; LLMs never make financial liquidation decisions. |
| **Sender Spoofing & Substring Bypass** | Attacker uses display names (`"owner@mermail.app" <hacker@evil.com>`) or substring domains. | **Ed25519 Signature Requirement:** Heartbeats require detached digital signatures verified on-chain; forged SMTP headers are completely ignored. |
| **Replay & Post-Trigger Sabotage** | Attacker attempts to cancel contingency or re-arm switch after directives have been released. | **Anti-Replay Filter & Irrevocable State Lock:** Nonces must be unique, timestamps fresh (<24h), and status `TRIGGERED` permanently locks state. |
| **Destination Wallet Mutation** | Attacker tries to alter settlement wallet address via email instructions. | **Config Immutability & PDA Constraint:** Beneficiary addresses are hardcoded in verified deployment config and Anchor `has_one = beneficiary` constraints. |
| **Guardian Griefing / Denial of Service** | Corrupt guardian attempts infinite holds to prevent heirs from ever receiving inheritance. | **Cumulative Hold Limit:** Contract enforces `MAX_CUMULATIVE_HOLD_SECONDS = 60 * 86400` total lifetime cap. |
| **Premature Oracle Trigger** | Malicious or erroneous oracle attempts to trigger vault while owner is alive. | **48h Dispute Window:** Vault enters `OracleDisputePending`; living owner can ping and revert false triggers before claim. |

---

## Mermail MCP Tool Integration

| Operation | MCP Tool | Purpose | Risk Tier |
|---|---|---|---|
| Mailbox Discovery | `list_emails` | Scoped inbox scan for principal check-ins | `Read-only` |
| Message Audit | `get_email` | Reads email with `agent_safe_content: true` | `Read-only` |
| Tiered Warning Notice | `send_email` | Alerts principal during grace period with Pyth valuations | `External effect` |
| Contingency Release | `send_email` | Releases Shamir Shard #2 and AI Notary claim guidance | `External effect` |
| Emergency Transfer | `paybox_request_transfer` | Dispatches rescue SOL/USDC to beneficiary wallet | `Financial write` |

---

## On-Chain Solana Devnet Evidence

- **Anchor Program ID:** [`E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX`](https://explorer.solana.com/address/E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX?cluster=devnet)
- **Live Upgraded Deploy Tx:** [`L98mtYU5jnTTuYeFqZiy6HDAy2ipaQBRiuBtZJGdbFJonTDZRqJdPmufMSo5sZFR1ZMgKEWpBRdTRPin82Bt8Rg`](https://explorer.solana.com/tx/L98mtYU5jnTTuYeFqZiy6HDAy2ipaQBRiuBtZJGdbFJonTDZRqJdPmufMSo5sZFR1ZMgKEWpBRdTRPin82Bt8Rg?cluster=devnet)
- **Live Operational Vault PDA:** [`9DpG5ZiHx25Qd5DJemP4CoA1Q4vtdy2WEAxeV31UNQVx`](https://explorer.solana.com/address/9DpG5ZiHx25Qd5DJemP4CoA1Q4vtdy2WEAxeV31UNQVx?cluster=devnet)
- **Vault Deposit Tx (0.1 SOL):** [`3gx81wN7uMWv6dnKwTdBpkctmoLQupWyaujnuSxQofJnMuTcAsATMAPWa89KUQeZhZiVtsSfe687SLfUHM83N1FR`](https://explorer.solana.com/tx/3gx81wN7uMWv6dnKwTdBpkctmoLQupWyaujnuSxQofJnMuTcAsATMAPWa89KUQeZhZiVtsSfe687SLfUHM83N1FR?cluster=devnet)
- **Vault Ping Heartbeat Tx:** [`2GSxAbVnF8PxisZhvTTsu49CVrkzRBd4NrpcKfGFtZmuYNP51dFaDfS46CLdYEBT7hLfqkJ9R6LitBpRjfz91s2i`](https://explorer.solana.com/tx/2GSxAbVnF8PxisZhvTTsu49CVrkzRBd4NrpcKfGFtZmuYNP51dFaDfS46CLdYEBT7hLfqkJ9R6LitBpRjfz91s2i?cluster=devnet)

---

## Repository Structure

```text
mermail-deadman-switch/
├── programs/
│   └── mermail-deadman-vault/
│       ├── Cargo.toml                    # Anchor SPL & Pyth dependencies
│       └── src/
│           └── lib.rs                    # Solana Anchor Smart Contract (PDA, SPL, Pyth, Timelocks)
├── client/
│   └── deadman-vault-client.mjs          # Client SDK for Solana PDA interaction
├── deadman-engine.mjs                    # Core dual-core state machine & mixed liveness
├── shamir.mjs                            # Galois Field GF(2^8) Shamir Secret Sharing (2-of-3)
├── worker.mjs                            # Serverless Cloudflare Edge Worker with Cron Triggers
├── wrangler.jsonc                        # Cloudflare configuration
├── Anchor.toml                           # Anchor project configuration
├── Cargo.toml                            # Cargo workspace definition
├── package.json                          # Scripts & dependencies
├── test-real-resources.mjs               # Live Solana Devnet RPC & Mermail MCP integration tests
├── test-cloudflare-worker.mjs            # Serverless Edge simulation tests
├── test-solana-smart-contract.mjs        # Anchor Smart Contract invariant & token tests
├── test-adversarial-redteam.mjs          # Adversarial Red Team stress-test suite
├── init-live-vault-devnet.mjs            # Live Devnet Vault initialization & funding script
├── SUBMISSION_PACK.md                    # Official Superteam Earn submission details
├── README.md                             # Project documentation
└── skills/
    └── mermail-deadman-switch/
        ├── SKILL.md                      # Mermail Agent Skill definition
        ├── agents/
        │   └── openai.yaml               # Tool bindings & agent policy
        ├── references/
        │   ├── protocol-guide.md         # Operational step-by-step lifecycle
        │   ├── security.md               # Detailed threat model & invariants
        │   └── tools.md                  # MCP tool payloads & parameters
        └── tests/
            ├── scenarios.json            # 11 structured threat & operational test scenarios
            └── test-runner.mjs           # Autonomous test validation suite
```

---

## Comprehensive Test Execution

Run the complete validation battery covering unit, live network, serverless edge, smart contract, and red-teaming layers:

```bash
# 1. Deterministic Unit & Lifecycle Suite (11 scenarios)
npm test

# 2. Live Solana Devnet RPC & Mermail Console MCP Suite (12 scenarios)
npm run test:live

# 3. Serverless Cloudflare Edge Worker Suite (5 scenarios)
npm run test:worker

# 4. Anchor Smart Contract SPL & Pyth Protocol Suite (7 scenarios)
npm run test:contract

# 5. Adversarial Red Team Stress-Test Suite (8 attack vectors)
npm run test:redteam

# 6. Advanced Boundary & On-Chain Rejection Suite (5 scenarios)
npm run test:boundary
```

---

## License
MIT License. Created by [Totopo27](https://github.com/Totopo27) for the Superteam Earn Bounty.
