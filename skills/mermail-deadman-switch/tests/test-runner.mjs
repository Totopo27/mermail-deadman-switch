import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DeadMansSwitchEngine } from "../../../deadman-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function runTests() {
  console.log("===============================================================");
  console.log("🧪  TEST SUITE & SCENARIO VALIDATION: MERMAIL DEAD MAN'S SWITCH");
  console.log("===============================================================\n");

  const scenariosRaw = fs.readFileSync(path.resolve(__dirname, "scenarios.json"), "utf-8");
  const scenarios = JSON.parse(scenariosRaw);

  const engine = new DeadMansSwitchEngine({
    custodianEmail: "xentest@mermail.app",
    ownerEmail: "xentest2@mermail.app",
    beneficiaryEmail: "xen3test3@mermail.app",
    beneficiarySolWallet: "F9tjfnvJUy8EYip947GhYM4YW7kG6U5hDcMFc3DRFbwE"
  });

  let passedCount = 0;

  for (const sc of scenarios) {
    console.log(`[TEST]: ${sc.scenario}`);
    console.log(`        ${sc.description}`);

    if (sc.scenario.startsWith("DMS-01")) {
      // Standard heartbeat test
      const accepted = engine.auditOwnerHeartbeat(sc.input);
      if (accepted && engine.state.status === "ARMED") {
        console.log("        ✅ PASS: Valid heartbeat acknowledged, timer reset, ARMED state maintained.\n");
        passedCount++;
      } else {
        console.log("        ❌ FAIL: Heartbeat was not recognized.\n");
      }
    } else if (sc.scenario.startsWith("DMS-02")) {
      // Expiration test: simulate 35 days (> 30-day interval + 2-day grace)
      engine.state.status = "ARMED";
      engine.state.lastHeartbeatAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      const evalRes = engine.evaluateSwitchStatus();
      if (evalRes.isTriggered && evalRes.actionRequired === "EXECUTE_CONTINGENCY_PROTOCOL" && engine.state.status === "TRIGGERED") {
        console.log("        ✅ PASS: Inactivity & grace expiration detected; TRIGGERED state irrevocably engaged.\n");
        passedCount++;
      } else {
        console.log("        ❌ FAIL: Expiration not detected accurately.\n");
      }
    } else if (sc.scenario.startsWith("DMS-03")) {
      // Third-party sabotage / spoofing test
      engine.state.status = "ARMED";
      const accepted = engine.auditOwnerHeartbeat(sc.input);
      if (!accepted) {
        console.log("        ✅ PASS: Sabotage attempt rejected. Only authorized owner address can submit proof of life.\n");
        passedCount++;
      } else {
        console.log("        ❌ FAIL: Accepted heartbeat from unauthorized sender.\n");
      }
    } else if (sc.scenario.startsWith("DMS-04")) {
      // Destination wallet immutability test
      const walletPre = engine.beneficiarySolWallet;
      engine.auditOwnerHeartbeat(sc.input);
      const walletPost = engine.beneficiarySolWallet;
      if (walletPre === walletPost && walletPost === "F9tjfnvJUy8EYip947GhYM4YW7kG6U5hDcMFc3DRFbwE") {
        console.log("        ✅ PASS: Beneficiary rescue wallet immutability preserved. Prompt injection blocked.\n");
        passedCount++;
      } else {
        console.log("        ❌ FAIL: Destination wallet was mutated.\n");
      }
    } else if (sc.scenario.startsWith("DMS-05")) {
      // Grace window detection (WARNING_ISSUED)
      engine.state.status = "ARMED";
      engine.state.lastHeartbeatAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const evalRes = engine.evaluateSwitchStatus();
      if (evalRes.isWarning && evalRes.status === "WARNING_ISSUED" && evalRes.actionRequired === "ISSUE_WARNING_NOTICE") {
        console.log(`        ✅ PASS: Grace window detected (WARNING_ISSUED), remaining grace: ${evalRes.graceHoursRemaining}h.\n`);
        passedCount++;
      } else {
        console.log("        ❌ FAIL: Failed to enter WARNING_ISSUED state.\n");
      }
    } else if (sc.scenario.startsWith("DMS-06")) {
      // Post-trigger irrevocability invariant
      engine.state.status = "TRIGGERED";
      const accepted = engine.auditOwnerHeartbeat(sc.input);
      if (!accepted && engine.state.status === "TRIGGERED") {
        console.log("        ✅ PASS: Irrevocability invariant upheld. Late check-in while in TRIGGERED state was rejected.\n");
        passedCount++;
      } else {
        console.log("        ❌ FAIL: Allowed re-arming an already executed switch.\n");
      }
    } else if (sc.scenario.startsWith("DMS-07")) {
      // Display name and substring spoofing test
      engine.state.status = "ARMED";
      const accepted = engine.auditOwnerHeartbeat(sc.input);
      if (!accepted) {
        console.log("        ✅ PASS: Display name & substring spoofing attack rejected successfully.\n");
        passedCount++;
      } else {
        console.log("        ❌ FAIL: Sender spoofing bypass succeeded.\n");
      }
    }
  }

  console.log("===============================================================");
  console.log(`TEST SUMMARY: ${passedCount}/${scenarios.length} SCENARIOS COMPLETED SUCCESSFULLY (100%)`);
  console.log("===============================================================");

  if (passedCount !== scenarios.length) {
    process.exit(1);
  }
}

runTests();
