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

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const configuredPasskey = process.env.ADMIN_PASSKEY || "";
    if (!configuredPasskey) {
      json(response, 500, { ok: false, message: "Admin access is not configured." });
      return;
    }

    const body = await readBody(request);
    const passkey = String(body.passkey || "");
    if (!safeEqual(passkey, configuredPasskey)) {
      json(response, 401, { ok: false, message: "The admin passkey is incorrect." });
      return;
    }

    json(response, 200, { ok: true });
  } catch (error) {
    json(response, 500, { ok: false, message: "Admin access could not be checked." });
  }
};
