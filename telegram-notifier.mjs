/**
 * Telegram Notifier Module - Mermail Dead Man's Switch
 * Enterprise-grade, hardened Telegram alert dispatcher and TWA/Webhook security engine.
 * 
 * Mitigations & Standards (from Section 16 - telegram-bot-builder & telegram-mini-app):
 * 1. HTML entity escaping prevents 400 Bad Request parser failures on emails with underscores/special chars.
 * 2. Token masking guarantees bot tokens never leak into console, CI logs, or error traces.
 * 3. Strict 8s timeout with AbortSignal prevents hung processes/connections.
 * 4. Automatic plain-text fallback if Telegram rejects rich entities.
 * 5. Webhook Ingress Authentication via timing-safe X-Telegram-Bot-Api-Secret-Token validation.
 * 6. Sender authorization middleware (ALLOWED_CHAT_IDS whitelist).
 * 7. Cryptographic HMAC-SHA256 initData validation for Telegram Mini Apps (TWA) with replay attack protection.
 * 8. URL sanitization on inline_keyboard buttons to prevent javascript: pseudo-protocol injection.
 */

import crypto from "node:crypto";

/**
 * Escapes special HTML characters for Telegram HTML parse_mode.
 * @param {string} text 
 * @returns {string}
 */
export function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitizes URLs for Telegram inline keyboards to prevent protocol injection.
 * @param {string} url 
 * @returns {string|null}
 */
export function sanitizeTelegramUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  // Strictly enforce https:// to prevent javascript: or data: URIs
  if (/^https:\/\/[a-zA-Z0-9\-\._~:\/\?#\[\]@!\$&'\(\)\*\+,;=%]+$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Masks a sensitive bot token for safe logging.
 * Example: "123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" -> "123456...w11"
 * @param {string} token 
 * @returns {string}
 */
export function maskToken(token) {
  if (!token || typeof token !== "string") return "[REDACTED]";
  if (token.length <= 10) return token.slice(0, 3) + "...";
  return `${token.slice(0, 6)}...${token.slice(-3)}`;
}

/**
 * Validates incoming Telegram Webhook secret token using timing-safe comparison.
 * Prevents unauthorized actors from forging Telegram webhook push requests.
 * @param {string} providedSecret Value from 'X-Telegram-Bot-Api-Secret-Token' header
 * @param {string} expectedSecret Expected secret configured in setWebhook
 * @returns {boolean}
 */
export function validateTelegramWebhookSecret(providedSecret, expectedSecret) {
  if (!providedSecret || !expectedSecret) return false;
  const provBuf = Buffer.from(String(providedSecret));
  const expBuf = Buffer.from(String(expectedSecret));
  if (provBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(provBuf, expBuf);
}

/**
 * Checks if a sender chat ID is permitted to interact with the bot.
 * @param {string|number} chatId 
 * @param {string|string[]|number[]} allowedChatIds Comma-separated or array of IDs
 * @returns {boolean}
 */
export function isAuthorizedTelegramSender(chatId, allowedChatIds) {
  if (!chatId || !allowedChatIds) return false;
  const allowed = Array.isArray(allowedChatIds)
    ? allowedChatIds.map(String)
    : String(allowedChatIds).split(",").map(s => s.trim());
  return allowed.includes(String(chatId).trim());
}

/**
 * Validates Telegram Mini App (TWA) initData cryptographic HMAC-SHA256 signature.
 * Essential for authenticating users opening a Telegram WebApp dashboard.
 * @param {string} initDataString Raw query string from Telegram.WebApp.initData
 * @param {string} botToken Telegram Bot API token
 * @param {number} [maxAgeSeconds=86400] Maximum allowed age in seconds (default: 24h)
 * @returns {{ valid: boolean, reason?: string, user?: object, authDate?: number }}
 */
export function validateTelegramInitData(initDataString, botToken, maxAgeSeconds = 86400) {
  if (!initDataString || typeof initDataString !== "string") {
    return { valid: false, reason: "Missing or invalid initData string" };
  }
  if (!botToken || typeof botToken !== "string") {
    return { valid: false, reason: "Missing botToken for signature validation" };
  }

  const urlParams = new URLSearchParams(initDataString);
  const hash = urlParams.get("hash");
  if (!hash) {
    return { valid: false, reason: "Missing hash parameter in initData" };
  }

  urlParams.delete("hash");

  // Sort remaining parameters alphabetically
  const params = Array.from(urlParams.entries());
  params.sort(([a], [b]) => a.localeCompare(b));

  const dataCheckString = params.map(([k, v]) => `${k}=${v}`).join("\n");

  // WebAppData HMAC-SHA256 derivation per Telegram official spec
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // Timing-safe comparison to prevent timing attacks
  const hashBuf = Buffer.from(hash, "hex");
  const calcBuf = Buffer.from(calculatedHash, "hex");
  if (hashBuf.length !== calcBuf.length || !crypto.timingSafeEqual(hashBuf, calcBuf)) {
    return { valid: false, reason: "Hash mismatch: cryptographic signature is invalid" };
  }

  // Validate auth_date freshness (replay-attack defense)
  const authDate = parseInt(urlParams.get("auth_date"), 10);
  if (!authDate || isNaN(authDate)) {
    return { valid: false, reason: "Missing or invalid auth_date parameter" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSeconds) {
    return { valid: false, reason: `initData expired (age: ${now - authDate}s exceeds max ${maxAgeSeconds}s)` };
  }

  let user = null;
  const userStr = urlParams.get("user");
  if (userStr) {
    try {
      user = JSON.parse(userStr);
    } catch (_) {}
  }

  return { valid: true, authDate, user };
}

/**
 * Formats a structured emergency alert into safe Telegram HTML.
 * @param {object} params
 * @param {string} params.title Header headline
 * @param {Array<{ label: string, value: string }>} params.fields Key-value fields
 * @param {{ label: string, url: string }} [params.link] Optional link button/URL
 * @returns {string}
 */
export function formatTelegramHtml({ title, fields = [], link = null }) {
  let html = `🚨 <b>${escapeHtml(title)}</b>\n\n`;

  for (const field of fields) {
    html += `<b>${escapeHtml(field.label)}:</b> <code>${escapeHtml(field.value)}</code>\n`;
  }

  if (link && link.url) {
    const safeUrl = sanitizeTelegramUrl(link.url);
    if (safeUrl) {
      html += `\n🔗 <a href="${escapeHtml(safeUrl)}">${escapeHtml(link.label || "View Details")}</a>`;
    }
  }

  return html;
}

/**
 * Formats an action button or keyboard row for Telegram inline_keyboard.
 * @param {Array<Array<{ text: string, url?: string, callback_data?: string }>>} buttons
 * @returns {object|null}
 */
export function formatInlineKeyboard(buttons) {
  if (!buttons || !Array.isArray(buttons)) return null;

  const sanitizedRows = buttons.map(row => {
    return row.map(btn => {
      const formatted = { text: String(btn.text) };
      if (btn.url) {
        const safeUrl = sanitizeTelegramUrl(btn.url);
        if (safeUrl) formatted.url = safeUrl;
      } else if (btn.callback_data) {
        formatted.callback_data = String(btn.callback_data).slice(0, 64);
      }
      return formatted;
    }).filter(btn => btn.url || btn.callback_data);
  }).filter(row => row.length > 0);

  if (sanitizedRows.length === 0) return null;
  return { inline_keyboard: sanitizedRows };
}

/**
 * Dispatches a Telegram notification with timeout, sanitization, inline keyboard, and fallback.
 * @param {object} options
 * @param {string} [options.botToken] Telegram Bot Token from @BotFather
 * @param {string|number} [options.chatId] Target Telegram Chat ID
 * @param {string} options.htmlMessage Formatted HTML message
 * @param {string} [options.plainFallback] Optional plain-text fallback
 * @param {object} [options.replyMarkup] Optional inline keyboard markup
 * @param {number} [options.timeoutMs=8000] Timeout in milliseconds
 * @returns {Promise<{ success: boolean, skipped?: boolean, messageId?: number, error?: string }>}
 */
export async function dispatchTelegramNotification({
  botToken = process.env?.TELEGRAM_BOT_TOKEN,
  chatId = process.env?.TELEGRAM_CHAT_ID,
  htmlMessage,
  plainFallback,
  replyMarkup = null,
  timeoutMs = 8000
}) {
  if (!botToken || !chatId) {
    console.log("[NOTICE] Telegram notification skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured.");
    return { success: false, skipped: true, reason: "Missing credentials" };
  }

  const cleanChatId = String(chatId).trim();
  const cleanToken = String(botToken).trim();
  const masked = maskToken(cleanToken);

  const payload = {
    chat_id: cleanChatId,
    text: htmlMessage,
    parse_mode: "HTML",
    disable_web_page_preview: false
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  // Intent 1: Rich HTML Mode
  try {
    const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const data = await res.json();
    if (data.ok) {
      console.log(`[OK] Telegram alert dispatched to Chat ID ${cleanChatId} (Msg ID: ${data.result?.message_id})`);
      return { success: true, messageId: data.result?.message_id };
    }

    console.warn(`[WARN] Telegram HTML dispatch rejected (${data.error_code}): ${data.description}. Attempting plain-text fallback...`);
  } catch (err) {
    // Sanitize any error message that might expose the token in the URL
    const sanitizedError = err.message.replace(cleanToken, masked);
    console.warn(`[WARN] Telegram network error on HTML dispatch: ${sanitizedError}`);
  }

  // Intent 2: Fallback to plain text (resilient against parser rejections)
  if (plainFallback) {
    try {
      const fallbackPayload = {
        chat_id: cleanChatId,
        text: plainFallback
      };
      if (replyMarkup) {
        fallbackPayload.reply_markup = replyMarkup;
      }

      const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fallbackPayload),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const data = await res.json();
      if (data.ok) {
        console.log(`[OK] Telegram plain-text fallback delivered to Chat ID ${cleanChatId}`);
        return { success: true, messageId: data.result?.message_id, fallbackUsed: true };
      }
      return { success: false, error: data.description };
    } catch (err) {
      const sanitizedError = err.message.replace(cleanToken, masked);
      return { success: false, error: sanitizedError };
    }
  }

  return { success: false, error: "Dispatch failed" };
}
