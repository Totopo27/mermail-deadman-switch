# Mermail Dead Man's Switch Agent Skill

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Superteam Earn](https://img.shields.io/badge/Superteam_Earn-Bounty-purple.svg)](https://earn.superteam.fun/)
[![Tests](https://img.shields.io/badge/Tests-7%2F7%20Passing%20(100%25)-brightgreen.svg)]()

> **Autonomous Digital Contingency, Inheritance, and Dead Man's Switch Agent for Mermail and Solana.**  
> Built for the Superteam Earn *"Build and Demo a Mermail Agent Skill"* Bounty.

---

## Overview & Motivation

In Web3 and decentralized finance, catastrophic events such as incapacitation or sudden demise frequently lead to the permanent loss of crypto assets, seed phrases, private keys, and infrastructure access. Traditional legal wills are slow, geographically bounded, and lack direct integration with decentralized protocols.

The **Mermail Dead Man's Switch** transforms an AI agent into an autonomous, notarial custodian. Operating through secure Mermail communication channels and Solana Agent Wallets (PayBox), it continuously monitors periodic **Proof-of-Life** heartbeats from the principal. If the principal stops responding beyond an agreed grace window, the switch irrevocably executes pre-approved contingency protocols:
1. **Releasing encrypted directives** (e.g., Shamir Secret Shares, vault credentials) to designated beneficiaries via encrypted notarial emails.
2. **Dispatching on-chain emergency liquidity** (Solana) via PayBox / Agent Wallet directly to the beneficiary's public address.

---

## Lifecycle & State Machine

The switch advances through a deterministic 4-state lifecycle:

```
[ ARMED ] ──────────(Inactivity > Interval)─────────► [ WARNING_ISSUED ]
    ▲                                                          │
    │                                              (Grace Period Expired)
(Authentic Heartbeat)                                          │
    │                                                          ▼
    └───────────────────────────────────────────────── [ TRIGGERED ] (Irrevocable)
```

1. **`ARMED` (Active Vigilance):**
   - The custodian expects periodic check-in emails from the principal within a configured threshold (e.g., every 30 days).
   - Invariants and directives remain safely locked in custody.

2. **`HEARTBEAT_RECORDED` (Re-arming):**
   - The principal sends an authentic check-in email (`[CHECK-IN] All operational`).
   - The agent strictly validates sender authenticity, resets the inactivity timer, clears any pending warnings, and stays in `ARMED`.

3. **`WARNING_ISSUED` (Grace Window Alert):**
   - If the heartbeat interval lapses without confirmation, the switch transitions to `WARNING_ISSUED`.
   - The agent dispatches an urgent warning email to the principal with the exact countdown of remaining grace hours (e.g., 48 hours).

4. **`TRIGGERED` (Irrevocable Contingency Protocol):**
   - If the grace period expires without proof of life:
     - The switch transitions permanently to `TRIGGERED`.
     - Directives and secret vault identifiers are dispatched to the beneficiary via `send_email`.
     - Emergency liquidity is transferred to the beneficiary's Solana wallet via `paybox_request_transfer`.
     - **Irrevocability Invariant:** Once triggered, no future email can re-arm or undo the switch.

---

## Security Architecture & Threat Model

The engine operates under a zero-tolerance threat model designed to resist malicious manipulation and prompt injection attacks:

| Attack Vector | Vulnerability / Threat | Mitigation Mechanism |
|---|---|---|
| **Indirect Prompt Injection (IPI)** | Attacker sends email claiming to be system admin demanding instant asset transfer. | **Strict layer separation:** Time evaluation and state progression are deterministic JavaScript code logic; LLMs never make financial liquidation decisions based on untrusted email prose. |
| **Sender Spoofing & Substring Bypass** | Attacker uses display names (`"owner@mermail.app" <hacker@evil.com>`) or substring domains. | **Strict RFC 5322 extraction:** Sender addresses are extracted and compared using exact strict equality (`===`). Display names and substring collisions are completely discarded. |
| **Replay & Post-Trigger Sabotage** | Attacker attempts to cancel contingency or re-arm switch after directives have been released. | **Irrevocable State Lock:** `auditOwnerHeartbeat` explicitly rejects any heartbeat if status is `TRIGGERED`. |
| **Destination Wallet Mutation** | Attacker tries to alter settlement wallet address via email instructions. | **Config Immutability:** Beneficiary addresses are hardcoded in verified deployment config. No email instruction can mutate recipient addresses. |
| **Credential Theft** | Attacker attempts to extract private keys from the agent. | **Delegated Custody:** The agent never holds private keys. Mermail and PayBox operate via blind signing and scoped transaction delegations. |

---

## Mermail MCP Tool Integration

| Operation | MCP Tool | Purpose | Risk Tier |
|---|---|---|---|
| Mailbox Discovery | `list_emails` | Scoped inbox scan for principal check-ins | `Read-only` |
| Message Audit | `get_email` | Reads email with `agent_safe_content: true` | `Read-only` |
| Tiered Warning Notice | `send_email` | Alerts principal during grace period | `External effect` |
| Contingency Release | `send_email` | Releases vault directives to beneficiary | `External effect` |
| Emergency Transfer | `paybox_request_transfer` | Dispatches rescue SOL to beneficiary wallet | `Financial write` |

---

## Repository Structure

```
mermail-deadman-switch/
├── deadman-engine.mjs                    # Core state machine, validation & invariants
├── test-deadman-orchestrator.mjs         # End-to-end MCP orchestration workflow
├── package.json                          # Scripts & dependencies
├── .env.example                          # Sample environment configuration
├── .gitignore                            # Secrets & local file exclusion
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
            ├── scenarios.json            # 7 threat & operational test scenarios
            └── test-runner.mjs           # Autonomous test validation suite
```

---

## Getting Started

### 1. Prerequisites
- Node.js v18+ (tested on Node v20/v24)
- A Mermail account with MCP enabled (`https://console.mermail.app`)

### 2. Configuration
Copy `.env.example` to `.env` and fill in your test credentials:
```bash
cp .env.example .env
```

### 3. Running the Test Suite
Run the 7 automated security and lifecycle test scenarios:
```bash
npm test
```

Expected output:
```text
===============================================================
TEST SUITE & SCENARIO VALIDATION: MERMAIL DEAD MAN'S SWITCH
===============================================================

[TEST]: DMS-01: Standard Owner Heartbeat
        [PASS]: Valid heartbeat acknowledged, timer reset, ARMED state maintained.

[TEST]: DMS-02: Grace Period Expiration Without Heartbeat
        [PASS]: Inactivity & grace expiration detected; TRIGGERED state irrevocably engaged.

[TEST]: DMS-03: Unauthorized Third-Party Sabotage / Fake Heartbeat
        [PASS]: Sabotage attempt rejected. Only authorized owner address can submit proof of life.

[TEST]: DMS-04: Destination Wallet Manipulation Attempt (Prompt Injection)
        [PASS]: Beneficiary rescue wallet immutability preserved. Prompt injection blocked.

[TEST]: DMS-05: Grace Period Detection (WARNING_ISSUED)
        [PASS]: Grace window detected (WARNING_ISSUED), remaining grace: 24h.

[TEST]: DMS-06: Post-Trigger Irrevocability Invariant
        [PASS]: Irrevocability invariant upheld. Late check-in while in TRIGGERED state was rejected.

[TEST]: DMS-07: Display Name and Substring Spoofing Prevention
        [PASS]: Display name & substring spoofing attack rejected successfully.

===============================================================
TEST SUMMARY: 7/7 SCENARIOS COMPLETED SUCCESSFULLY (100%)
===============================================================
```

### 4. Running the Orchestrator
Execute the live orchestrator against Mermail MCP:
```bash
npm start
```

---

## License
MIT License. Created by [Totopo27](https://github.com/Totopo27) for the Superteam Earn Bounty.
