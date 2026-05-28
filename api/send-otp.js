const crypto = require("crypto");

const appName = "Rota & Salary Tracker";
const defaultFrom = "Rota & Salary Tracker <onboarding@resend.dev>";

function json(response, status, payload) {
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.status(status).send(JSON.stringify(payload));
}

async function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || "").trim());
}

function safeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function senderDomain(sender) {
  const match = String(sender || "").match(/@([^>\s]+)/);
  return match ? match[1].toLowerCase() : "";
}

function parseEmailAddress(value) {
  const text = String(value || "").trim();
  const wrapped = text.match(/<([^>\s]+@[^>\s]+)>/);
  if (wrapped) return wrapped[1].trim();
  const direct = text.match(/[^\s<>]+@[^\s<>]+/);
  return direct ? direct[0].trim() : "";
}

function chooseSender() {
  const configured = String(process.env.OTP_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || "").trim();
  const blockedDomains = new Set([
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "icloud.com",
    "aol.com"
  ]);
  if (!configured) return defaultFrom;
  return blockedDomains.has(senderDomain(configured)) ? defaultFrom : configured;
}

function brevoSenderEmail() {
  return parseEmailAddress(process.env.BREVO_SENDER_EMAIL || process.env.BREVO_FROM_EMAIL || "");
}

function brevoReplyToEmail() {
  return parseEmailAddress(process.env.BREVO_REPLY_TO_EMAIL || process.env.OTP_REPLY_TO_EMAIL || "");
}

function providerMessage(detail) {
  const text = String(detail || "").trim();
  if (!text) return "The email provider could not send the OTP.";
  try {
    const parsed = JSON.parse(text);
    return parsed?.message || parsed?.error?.message || parsed?.error_description || text;
  } catch {
    return text;
  }
}

function signTokenPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function hashOtp({ email, code, nonce, secret }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${String(email).toLowerCase()}|${code}|${nonce}`)
    .digest("hex");
}

function createOtpToken({ email, code, expiresAt, secret }) {
  const nonce = crypto.randomBytes(18).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    email: String(email).toLowerCase(),
    nonce,
    codeHash: hashOtp({ email, code, nonce, secret }),
    expiresAt
  })).toString("base64url");
  const signature = signTokenPayload(payload, secret);
  return `${payload}.${signature}`;
}

async function sendWithResend({ email, username, code, expiresMinutes }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      sent: false,
      status: 503,
      message: "OTP email is not configured yet. Add BREVO_API_KEY or RESEND_API_KEY in Vercel."
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: chooseSender(),
      reply_to: process.env.OTP_REPLY_TO_EMAIL || undefined,
      to: [email],
      subject: `Your ${appName} OTP`,
      html: `
        <div style="margin:0;padding:24px;background:#f1f8ff;font-family:Arial,sans-serif;color:#0d1b35">
          <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #c8dcff;border-radius:14px;padding:26px">
            <p style="margin:0 0 8px;font-size:13px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#2369e8">${appName}</p>
            <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#0d1b35">Your sign-up code</h1>
            <p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#536581">Hello ${safeText(username || "there")}, use this one-time code to finish creating your account.</p>
            <p style="margin:0 0 18px;font-size:38px;letter-spacing:8px;font-weight:900;color:#2369e8">${safeText(code)}</p>
            <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#536581">This code expires in ${expiresMinutes} minutes.</p>
            <p style="margin:0;font-size:14px;line-height:1.5;color:#536581">If you did not request this, you can ignore this email.</p>
          </div>
        </div>
      `
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      sent: false,
      status: response.status,
      message: providerMessage(detail)
    };
  }

  return { sent: true };
}

async function sendWithBrevo({ email, username, code, expiresMinutes }) {
  const apiKey = process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY;
  if (!apiKey) return { sent: false, message: "Missing BREVO_API_KEY" };

  const senderEmail = brevoSenderEmail();
  if (!senderEmail) {
    return {
      sent: false,
      status: 503,
      message: "BREVO_SENDER_EMAIL is missing in Vercel."
    };
  }

  const replyToEmail = brevoReplyToEmail();
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      sender: {
        email: senderEmail,
        name: process.env.BREVO_SENDER_NAME || appName
      },
      to: [
        {
          email,
          name: username || email
        }
      ],
      replyTo: replyToEmail
        ? {
            email: replyToEmail,
            name: process.env.BREVO_REPLY_TO_NAME || appName
          }
        : undefined,
      subject: `Your ${appName} OTP`,
      htmlContent: `
        <div style="margin:0;padding:24px;background:#f1f8ff;font-family:Arial,sans-serif;color:#0d1b35">
          <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #c8dcff;border-radius:14px;padding:26px">
            <p style="margin:0 0 8px;font-size:13px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#2369e8">${appName}</p>
            <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#0d1b35">Your sign-up code</h1>
            <p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#536581">Hello ${safeText(username || "there")}, use this one-time code to finish creating your account.</p>
            <p style="margin:0 0 18px;font-size:38px;letter-spacing:8px;font-weight:900;color:#2369e8">${safeText(code)}</p>
            <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#536581">This code expires in ${expiresMinutes} minutes.</p>
            <p style="margin:0;font-size:14px;line-height:1.5;color:#536581">If you did not request this, you can ignore this email.</p>
          </div>
        </div>
      `
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      sent: false,
      status: response.status,
      message: providerMessage(detail)
    };
  }

  return { sent: true };
}

async function sendOtpEmail(details) {
  const brevoResult = await sendWithBrevo(details);
  if (brevoResult.sent) return brevoResult;

  const resendResult = await sendWithResend(details);
  if (resendResult.sent) return resendResult;

  if (process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY) return brevoResult;
  return resendResult;
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const secret = process.env.OTP_SECRET;
    if (!secret) {
      json(response, 500, { ok: false, message: "OTP_SECRET is missing in Vercel." });
      return;
    }

    const body = await readBody(request);
    const email = String(body.email || "").trim().toLowerCase();
    const username = String(body.username || "").trim();
    if (!isValidEmail(email)) {
      json(response, 400, { ok: false, message: "Enter a valid email address." });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresMinutes = Math.max(1, Number(process.env.OTP_TTL_MINUTES || 10));
    const expiresAt = new Date(Date.now() + expiresMinutes * 60000).toISOString();
    const delivery = await sendOtpEmail({ email, username, code, expiresMinutes });

    if (!delivery.sent) {
      json(response, delivery.status || 503, { ok: false, message: delivery.message || "OTP could not be sent." });
      return;
    }

    json(response, 200, {
      ok: true,
      otpToken: createOtpToken({ email, code, expiresAt, secret }),
      expiresAt,
      message: "OTP sent. Check your email and enter the 6-digit code."
    });
  } catch (error) {
    json(response, 500, { ok: false, message: error.message || "Could not send OTP." });
  }
};
