# Paquete de Postulación Oficial - Superteam Earn
## Bounty: Build and Demo a Mermail Agent Skill
### Skill: `mermail-deadman-switch` (Autonomous Digital Inheritance & Contingency Protocol)

---

## 1. Título y Resumen para el Formulario de Superteam Earn

### Project Title:
`Mermail Dead Man's Switch: Autonomous Digital Inheritance & Asset Rescue Protocol`

### Short Description (Elevator Pitch):
`An autonomous, dual-core AI notary and digital contingency custodian powered by Mermail MCP and Solana Anchor. It features passive on-chain liveness monitoring (swaps/transfers reset the timer automatically), Ed25519 cryptographic email heartbeats, multi-tiered grace escalation with guardian emergency holds, Shamir's Secret Sharing (2-of-3) threshold vault custody, and a native Solana PDA Smart Contract with Squads multisig and legal oracle bypass support.`

---

## 2. Descripción Completa (Submission Details & Technical Write-up)

```markdown
### Problem Statement
In Web3, private keys, seed phrases, and digital directives are irrevocably lost if a holder becomes incapacitated or permanently unresponsive. Traditional centralized custodians (notaries, legacy banks) are slow, expensive, and introduce trusted third-party risk. Conversely, naive AI agents reading emails suffer from Indirect Prompt Injection (IPI), SMTP header spoofing, single-point key exposure, and fatal false positives (e.g. triggering while an owner is on vacation).

### The Solution: Mermail Dead Man's Switch (Dual-Core Protocol)
`mermail-deadman-switch` transforms an AI agent into an autonomous, non-custodial contingency notary leveraging:
1. **Mermail Inbox MCP (`list_emails`, `get_email`, `send_email`)**: For private, spam-filtered identity, proof-of-life check-in monitoring, and confidential Shamir Shard #2 delivery.
2. **PayBox / Agent Wallet (`paybox_request_transfer`)**: For programmatic, policy-bounded asset rescue transfers on Solana Devnet/Mainnet without exposing raw private keys.
3. **Passive On-Chain Liveness Sensor**: Polls Solana RPC (`getSignaturesForAddress`). If the owner executes swaps, transfers, or governance votes, the timer resets automatically with zero manual effort.
4. **Shamir's Secret Sharing (2-of-3)**: Implemented in Galois Field GF(2^8). Shard #1 is kept offline by the beneficiary, Shard #2 is custodied by the agent, and Shard #3 is held by a guardian. Breaching the agent yields only useless mathematical noise.
5. **Solana Anchor Smart Contract (`mermail_deadman_vault`)**: PDA-governed vault (`[b"deadman_vault", owner]`, Program ID: `E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX`) enforcing on-chain timelocks, self-custodial withdrawals, Squads Multisig accounts, and legal oracle bypasses (`attest_oracle_trigger`).
6. **Serverless Cloudflare Worker**: 24/7/365 edge execution ($0/month) with Cron Triggers every 12h, 1-Click Vault Setup API (`POST /api/setup-vault`), and real-time Mermail webhook receivers (`POST /webhooks/mermail`).

### Multi-Tiered Deterministic Lifecycle
- **[ARMED]**: Continuous vigilance. Refreshed passively by Solana on-chain activity or actively by Ed25519-signed emails.
- **[TIER 1: Soft Ping (Day 30)]**: Private, non-alarming reminder dispatched to the owner.
- **[TIER 2: Urgent Notice (Day 37)]**: Multi-channel warning alerting of impending contingency procedures.
- **[TIER 3: Guardian Escalation (Day 45)]**: Escalates to trusted guardians. Guardians can invoke `applyGuardianHold` (14-day hold) during medical hospitalization or travel emergencies.
- **[TRIGGERED (Irrevocable - Day 60)]**: Upon full grace expiration:
  - Dispatches Shamir Shard #2 and AI Notary claim guidance to the beneficiary via Mermail.
  - Executes controlled asset rescue micro-transfer on Solana Devnet.
  - Allows autonomous on-chain inheritance claim via the Anchor Smart Contract PDA.

### Security & Threat Model (Zero-Trust Design)
- **Dual-Core Decoupling**: State transitions, timers, and mathematical verifications are executed exclusively by the deterministic Kernel; LLMs have zero authority over fund releases, neutralizing Indirect Prompt Injection (IPI).
- **Cryptographic Ed25519 Proof of Life**: Heartbeats require authentic digital signatures matching the owner's Solana keypair, neutralizing spoofed email relays.
- **Threshold Custody**: Breaching the agent or email inbox reveals only 1 of 3 shards, cryptographically preserving vault confidentiality.
- **Immutable Beneficiary Policy**: Destination wallets and beneficiary identities are fixed at instantiation and cannot be redirected by email instructions.

### Verified Test Evidence
- **Unit & Scenario Test Suite**: 11/11 tests passed (100% pass rate covering check-ins, expiration, sabotage rejection, wallet immutability, Ed25519, Shamir, and AI Notary).
- **Live Resources Test Suite**: 12/12 tests passed against live Solana Devnet RPC (Slot verified, 10 SOL balance) and Mermail Cloud Console MCP (`https://console.mermail.app/mcp`).
- **Cloudflare Worker Test Suite**: 5/5 tests passed (1-Click API, Status, Cron Trigger, Webhooks, Guardian Hold).
- **Solana Smart Contract Test Suite**: 6/6 tests passed (PDA derivation, self-custody deposits/withdrawals, ping, timelock enforcement, guardian hold, autonomous claim).

### Live Solana Devnet Deployment & Operational Vault PDA
- **Program ID**: `E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX`
- **Deploy Tx Hash**: `3kr8rU4tncvGsNPSjkRzL3dGTbxGP2agNmJSuW7VHCAXtdTmXhJErrU2671KL2EfdCjSTW1GRe5S32Xbc1eF1occ`
- **Solana Explorer**: https://explorer.solana.com/address/E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX?cluster=devnet
- **Program Loader**: `BPFLoaderUpgradeab1e11111111111111111111111` (Executable: true)
- **Live Vault PDA Address**: `9DpG5ZiHx25Qd5DJemP4CoA1Q4vtdy2WEAxeV31UNQVx`
- **Vault Init Tx**: `5vQMbJM6SgFWpSsK7yRJcEoUd1BwJ9H2zaMnEkv2MdKeE5uVxqTY5QBA3bkSMeHRsVK8RDsZX8zUW9BqfCjRnx8k`
- **Vault Deposit Tx (0.1 SOL)**: `3gx81wN7uMWv6dnKwTdBpkctmoLQupWyaujnuSxQofJnMuTcAsATMAPWa89KUQeZhZiVtsSfe687SLfUHM83N1FR`
- **Vault Ping Tx**: `2GSxAbVnF8PxisZhvTTsu49CVrkzRBd4NrpcKfGFtZmuYNP51dFaDfS46CLdYEBT7hLfqkJ9R6LitBpRjfz91s2i`
```

---

## 3. Texto para el Pull Request en GitHub (`Nudgen-Marketing/mermail-skills`)

### PR Title:
`feat(skills): add mermail-deadman-switch — autonomous digital inheritance & contingency protocol`

### PR Description:
```markdown
## Summary
Adds the `mermail-deadman-switch` skill: an autonomous digital contingency, inheritance, and asset rescue protocol utilizing Mermail MCP, Solana Anchor, and PayBox.

- `skills/mermail-deadman-switch/SKILL.md` — Core skill definition, dual-core lifecycle, and security invariants.
- `skills/mermail-deadman-switch/agents/openai.yaml` — Agent interface and hosted Mermail MCP dependencies.
- `skills/mermail-deadman-switch/references/tools.md` — Full mapping of read, external-effect (`send_email`), and financial (`paybox_request_transfer`) tools.
- `skills/mermail-deadman-switch/references/security.md` — Zero-trust threat model, prompt injection mitigation, and immutable beneficiary policies.
- `skills/mermail-deadman-switch/references/protocol-guide.md` — Step-by-step contingency operational manual.
- `skills/mermail-deadman-switch/tests/scenarios.json` — 11 verified test scenarios.
- `skills/mermail-deadman-switch/tests/test-runner.mjs` — Automated regression test runner.

## Key Breakthroughs
1. **Passive Mixed Liveness**: Automatic heartbeat refresh whenever the owner interacts on-chain in Solana (swaps, transfers, voting).
2. **Ed25519 Cryptographic Proof of Life**: Digital detached signatures prevent SMTP header spoofing.
3. **Shamir's Secret Sharing (2-of-3)**: Master keys are split across Beneficiary, Agent, and Guardian.
4. **Anchor Smart Contract Companion**: PDA-governed vault on Solana with Squads multisig and legal oracle bypass support (`attest_oracle_trigger`).
5. **Serverless Cloudflare Worker**: $0/month edge execution with Cron Triggers every 12 hours.

## Test Validation
- **Unit Suite (`npm test`)**: 11/11 passed (100%).
- **Live Suite (`npm run test:live`)**: 12/12 passed on live Solana Devnet + Mermail Console MCP.
- **Worker Suite (`npm run test:worker`)**: 5/5 passed.
- **Contract Suite (`npm run test:contract`)**: 6/6 passed.
```
