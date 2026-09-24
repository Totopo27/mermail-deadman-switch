# Mermail Dead Man's Switch - Tool Mapping Reference

This document specifies the exact integration between the Dead Man's Switch workflow and the official Mermail MCP tool catalog.

---

## 1. Inspection & Read-Only Tools

### `list_emails`
- **Purpose:** Scoped mailbox discovery to detect incoming messages from the owner (`OWNER_EMAIL`).
- **Recommended Parameters:**
  ```json
  {
    "mailboxId": "CUSTODIAN_MAILBOX_ID",
    "query": {
      "folder": "inbox",
      "limit": 10,
      "sortColumn": "date",
      "sortDirection": "DESC",
      "metadata_only": false
    }
  }
  ```

### `get_email`
- **Purpose:** Retrieve the sanitized body of an email suspected of containing a heartbeat or directive.
- **Recommended Parameters:**
  ```json
  {
    "mailboxId": "CUSTODIAN_MAILBOX_ID",
    "emailId": "EMAIL_UUID",
    "agent_safe_content": true
  }
  ```
  *(The `agent_safe_content: true` flag strips unsafe technical headers and mitigates prompt injection vectors).*

---

## 2. Dispatch & External Effect Tools

### `send_email` (Grace Period Warning Notice)
- **Purpose:** Notify the principal before the grace window expires.
- **Payload:**
  ```json
  {
    "mailboxId": "CUSTODIAN_MAILBOX_ID",
    "body": {
      "from": "CUSTODIAN_EMAIL",
      "to": "OWNER_EMAIL",
      "subject": "[URGENT] Proof of Life Check-in - Dead Man's Switch",
      "text": "Activity confirmation required within 48 hours to avoid contingency protocol activation."
    }
  }
  ```

### `send_email` (Irrevocable Contingency Notice)
- **Purpose:** Deliver encrypted directives, secret share vault IDs, and settlement receipts to the designated beneficiary.
- **Payload:**
  ```json
  {
    "mailboxId": "CUSTODIAN_MAILBOX_ID",
    "body": {
      "from": "CUSTODIAN_EMAIL",
      "to": "BENEFICIARY_EMAIL",
      "subject": "[CONTINGENCY ACTIVATION] Dead Man's Switch Protocol Executed",
      "text": "Certified irrevocable execution of digital contingency directives and asset release."
    }
  }
  ```

---

## 3. Financial Tools (Agent Wallet / PayBox)

### `paybox_request_transfer`
- **Purpose:** Dispatch emergency rescue funds (e.g., `0.05 SOL`) from the delegated agent wallet to the beneficiary's public address upon trigger.
- **Recommended Parameters:**
  ```json
  {
    "credential": "sol-default",
    "recipient": "BENEFICIARY_SOL_WALLET",
    "amount_decimal": 0.05,
    "memo": "DMS_EMERGENCY_RESCUE_TRANSFER"
  }
  ```
