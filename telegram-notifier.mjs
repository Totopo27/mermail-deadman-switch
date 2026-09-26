/**
 * Telegram Notifier Module - Mermail Dead Man's Switch
 * Enterprise-grade, hardened Telegram alert dispatcher.
 * 
 * Mitigations:
 * 1. HTML entity escaping prevents 400 Bad Request parser failures on emails with underscores/special chars.
 * 2. Token masking guarantees bot tokens never leak into console, CI logs, or error traces.
 * 3. Strict 8s timeout with AbortSignal prevents hung processes/connections.
 * 4. Automatic plain-text fallback if Telegram rejects rich entities.
 */

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
    html += `\n🔗 <a href="${escapeHtml(link.url)}">${escapeHtml(link.label || "View Details")}</a>`;
  }

  return html;
}

/**
 * Dispatches a Telegram notification with timeout, sanitization, and fallback.
 * @param {object} options
 * @param {string} [options.botToken] Telegram Bot Token from @BotFather
 * @param {string|number} [options.chatId] Target Telegram Chat ID
 * @param {string} options.htmlMessage Formatted HTML message
 * @param {string} [options.plainFallback] Optional plain-text fallback
 * @param {number} [options.timeoutMs=8000] Timeout in milliseconds
 * @returns {Promise<{ success: boolean, skipped?: boolean, messageId?: number, error?: string }>}
 */
export async function dispatchTelegramNotification({
  botToken = process.env?.TELEGRAM_BOT_TOKEN,
  chatId = process.env?.TELEGRAM_CHAT_ID,
  htmlMessage,
  plainFallback,
  timeoutMs = 8000
}) {
  if (!botToken || !chatId) {
    console.log("[NOTICE] Telegram notification skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured.");
    return { success: false, skipped: true, reason: "Missing credentials" };
  }

  const cleanChatId = String(chatId).trim();
  const cleanToken = String(botToken).trim();
  const masked = maskToken(cleanToken);

  // Intent 1: Rich HTML Mode
  try {
    const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text: htmlMessage,
        parse_mode: "HTML",
        disable_web_page_preview: false
      }),
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
      const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: cleanChatId,
          text: plainFallback
        }),
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
