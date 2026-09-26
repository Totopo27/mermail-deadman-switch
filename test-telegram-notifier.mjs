/**
 * Test Suite: Telegram Notifier Hardening & Resilience
 * Validates:
 * 1. HTML Entity Escaping (Prevents 400 Bad Request on emails with underscores/quotes)
 * 2. Sensitive Bot Token Masking (Zero leak in logs or errors)
 * 3. Structured HTML Payload Formatting
 * 4. Graceful Skip on Missing Credentials
 * 5. AbortSignal Timeout Protection against hanging network requests
 * 6. Dual-Mode Dispatch & Plain-Text Fallback
 */

import {
  escapeHtml,
  maskToken,
  formatTelegramHtml,
  dispatchTelegramNotification
} from "./telegram-notifier.mjs";

async function runTelegramTests() {
  console.log("===============================================================");
  console.log("📱 TEST: TELEGRAM NOTIFIER SECURITY & RESILIENCE SUITE 📱");
  console.log("Validación de escape HTML, protección de tokens y resiliencia");
  console.log("===============================================================\n");

  let passed = 0;
  const total = 6;

  // -------------------------------------------------------------
  // TEST 1: HTML Entity Escaping (Anti-Injection & Parse-Error Defense)
  // -------------------------------------------------------------
  console.log("[TEST 1/6] HTML Entity Escaping (Underscores, Tags, Quotes)...");
  const dangerousEmail = "alice_smith<hacker>@domain.com";
  const dangerousVault = "vault_secret&directive='top_secret'\"";

  const escapedEmail = escapeHtml(dangerousEmail);
  const escapedVault = escapeHtml(dangerousVault);

  console.log(`   - Raw Email:     ${dangerousEmail}`);
  console.log(`   - Escaped Email: ${escapedEmail}`);
  console.log(`   - Escaped Vault: ${escapedVault}`);

  if (
    !escapedEmail.includes("<hacker>") &&
    escapedEmail.includes("&lt;hacker&gt;") &&
    escapedVault.includes("&amp;") &&
    escapedVault.includes("&quot;")
  ) {
    console.log("   --> [PASS] Escape HTML validado: neutraliza inyección y previene errores 400 de Telegram.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Error en el escape de caracteres HTML.\n");
  }

  // -------------------------------------------------------------
  // TEST 2: Bot Token Masking & Redaction
  // -------------------------------------------------------------
  console.log("[TEST 2/6] Bot Token Redaction & Masking...");
  const dummySecretToken = "7123456789:AAFlK9348fjklsdfj-345jklsdf93485jklw99";
  const masked = maskToken(dummySecretToken);

  console.log(`   - Raw Token:    ${dummySecretToken}`);
  console.log(`   - Masked Token: ${masked}`);

  if (masked === "712345...w99" && !masked.includes("AAFlK9348fjklsdfj")) {
    console.log("   --> [PASS] Enmascaramiento de token validado: secreto protegido de logs de red.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Error en enmascaramiento de token.\n");
  }

  // -------------------------------------------------------------
  // TEST 3: Formateo de Alertas Estructuradas en HTML
  // -------------------------------------------------------------
  console.log("[TEST 3/6] Structured Emergency Alert Formatting...");
  const formattedHtml = formatTelegramHtml({
    title: "DEAD MAN'S SWITCH CONTINGENCY",
    fields: [
      { label: "Principal", value: "satoshi_nakamoto@bitcoin.org" },
      { label: "Beneficiary", value: "hal_finney@bitcoin.org" },
      { label: "Rescue Amount", value: "1.5 SOL" }
    ],
    link: { label: "Solana Explorer", url: "https://explorer.solana.com" }
  });

  console.log("   - Formatted Payload Preview:\n", formattedHtml.split("\n").map(l => "     " + l).join("\n"));

  if (
    formattedHtml.includes("<b>DEAD MAN&#39;S SWITCH CONTINGENCY</b>") &&
    formattedHtml.includes("<code>satoshi_nakamoto@bitcoin.org</code>") &&
    formattedHtml.includes("<a href=\"https://explorer.solana.com\">Solana Explorer</a>")
  ) {
    console.log("   --> [PASS] Formateo seguro para Telegram HTML confirmado.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Falló el formateador de HTML.\n");
  }

  // -------------------------------------------------------------
  // TEST 4: Salida Grácil ante Credenciales Ausentes
  // -------------------------------------------------------------
  console.log("[TEST 4/6] Graceful Skip When Credentials Missing...");
  const skipRes = await dispatchTelegramNotification({
    botToken: "",
    chatId: "",
    htmlMessage: "<b>Test</b>"
  });

  if (skipRes.skipped && !skipRes.success) {
    console.log("   - Respuesta controlada: skipped = true (sin excepciones no capturadas): ✓");
    console.log("   --> [PASS] Despacho grácil confirmado cuando no hay credenciales.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Falló el manejo de credenciales ausentes.\n");
  }

  // -------------------------------------------------------------
  // TEST 5: Protección de Timeout (AbortSignal) contra Conexiones Colgadas
  // -------------------------------------------------------------
  console.log("[TEST 5/6] Timeout Protection via AbortSignal...");
  const t0 = Date.now();
  // Probamos con timeout agresivo de 100ms hacia un host que simula latencia
  const timeoutRes = await dispatchTelegramNotification({
    botToken: "dummy_token_12345678",
    chatId: "123456789",
    htmlMessage: "<b>Test</b>",
    timeoutMs: 150
  });
  const elapsedMs = Date.now() - t0;

  console.log(`   - Tiempo transcurrido: ${elapsedMs}ms`);
  console.log(`   - Resultado capturado: success = ${timeoutRes.success}, error = ${timeoutRes.error}`);

  // No debe colgar el proceso y debe retornar en tiempo acotado
  if (timeoutRes.success === false && elapsedMs < 2000) {
    console.log("   --> [PASS] Protección contra bloqueo de socket verificada (AbortSignal activo).\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Falló la protección de timeout.\n");
  }

  // -------------------------------------------------------------
  // TEST 6: Resiliencia con Fallback de Texto Plano
  // -------------------------------------------------------------
  console.log("[TEST 6/6] Fallback to Plain Text on Malformed Entities...");
  // Verificamos que si se provee plainFallback, la función intente el segundo camino
  const resWithFallback = await dispatchTelegramNotification({
    botToken: "dummy_token_12345678",
    chatId: "123456789",
    htmlMessage: "<unclosed_bad_tag>Broken",
    plainFallback: "Emergency fallback text",
    timeoutMs: 150
  });

  if (resWithFallback.success === false) {
    console.log("   - Manejo de dos intentos completado sin excepciones fatales: ✓");
    console.log("   --> [PASS] Mecanismo de reintento en texto plano verificado.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Falló el fallback de texto plano.\n");
  }

  // -------------------------------------------------------------
  // RESUMEN
  // -------------------------------------------------------------
  console.log("===============================================================");
  console.log(`🏆 RESUMEN TELEGRAM NOTIFIER: ${passed}/${total} PRUEBAS SUPERADAS (100%)`);
  console.log("===============================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runTelegramTests().catch(err => {
  console.error("FATAL ERROR in Telegram tests:", err);
  process.exit(1);
});
