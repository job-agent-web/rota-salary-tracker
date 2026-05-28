const crypto = require("crypto");

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

function signTokenPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashOtp({ email, code, nonce, secret }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${String(email).toLowerCase()}|${code}|${nonce}`)
    .digest("hex");
}

function readOtpToken(token, secret) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw new Error("OTP token is missing.");
  const expectedSignature = signTokenPayload(payload, secret);
  if (!safeEqual(signature, expectedSignature)) throw new Error("OTP token is no longer valid.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
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
    const code = String(body.code || "").replace(/\s+/g, "");
    const token = readOtpToken(body.otpToken, secret);
    const expiresAt = new Date(token.expiresAt || "");

    if (!email || token.email !== email) {
      json(response, 400, { ok: false, message: "Request a new OTP for this email address." });
      return;
    }
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
      json(response, 400, { ok: false, message: "This OTP has expired. Please request a new one." });
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      json(response, 400, { ok: false, message: "Enter the 6-digit OTP code." });
      return;
    }

    const expectedHash = hashOtp({ email, code, nonce: token.nonce, secret });
    if (!safeEqual(expectedHash, token.codeHash)) {
      json(response, 400, { ok: false, message: "The OTP is incorrect. Please check the code and try again." });
      return;
    }

    json(response, 200, { ok: true, message: "Email verified." });
  } catch (error) {
    json(response, 400, { ok: false, message: error.message || "Could not verify OTP." });
  }
};
