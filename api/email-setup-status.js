const crypto = require("crypto");

const supportEmail = "rota.salary.tracker@gmail.com";
const freeSenderDomains = new Set([
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

function parseEmailAddress(value) {
  const text = String(value || "").trim();
  const wrapped = text.match(/<([^>\s]+@[^>\s]+)>/);
  if (wrapped) return wrapped[1].trim();
  const direct = text.match(/[^\s<>]+@[^\s<>]+/);
  if (!direct) return "";
  const email = direct[0].replace(/^.*?([^\s<>]+@[^\s<>]+)$/, "$1");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function emailDomain(email) {
  const atIndex = String(email || "").lastIndexOf("@");
  return atIndex >= 0 ? String(email).slice(atIndex + 1).toLowerCase() : "";
}

function brevoSenderEmail() {
  return parseEmailAddress(process.env.BREVO_SENDER_EMAIL || process.env.BREVO_FROM_EMAIL || supportEmail);
}

async function brevoGet(path) {
  const apiKey = process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY;
  if (!apiKey) return { ok: false, status: 503, data: null, message: "BREVO_API_KEY is not configured." };

  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    headers: {
      "api-key": apiKey,
      accept: "application/json"
    }
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    message: data?.message || data?.error?.message || (response.ok ? "" : "Brevo request failed.")
  };
}

function addCheck(checks, level, label, detail) {
  checks.push({ level, label, detail });
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
    if (!safeEqual(String(body.passkey || ""), configuredPasskey)) {
      json(response, 401, { ok: false, message: "The admin passkey is incorrect." });
      return;
    }

    const senderEmail = brevoSenderEmail();
    const senderDomain = emailDomain(senderEmail);
    const usesFreeSenderDomain = freeSenderDomains.has(senderDomain);
    const checks = [];

    addCheck(
      checks,
      process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY ? "good" : "bad",
      "Brevo API key",
      process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY
        ? "Configured in Vercel."
        : "Missing. OTP email cannot be sent through Brevo."
    );
    addCheck(
      checks,
      senderEmail ? "good" : "bad",
      "Sender email",
      senderEmail || "Missing sender email."
    );
    const [sendersResult, domainsResult] = await Promise.all([
      brevoGet("/senders"),
      brevoGet("/senders/domains")
    ]);

    const senders = Array.isArray(sendersResult.data?.senders) ? sendersResult.data.senders : [];
    const domains = Array.isArray(domainsResult.data?.domains) ? domainsResult.data.domains : [];
    const matchingSender = senders.find((sender) => String(sender.email || "").toLowerCase() === senderEmail.toLowerCase()) || null;
    const matchingDomain = domains.find((domain) => String(domain.domain_name || "").toLowerCase() === senderDomain) || null;
    const senderIsActive = Boolean(matchingSender?.active);

    if (sendersResult.ok) {
      addCheck(
        checks,
        matchingSender?.active ? "good" : "warn",
        "Brevo sender",
        matchingSender
          ? `${matchingSender.email} is ${matchingSender.active ? "active" : "not active yet"}.`
          : "This sender was not found in the Brevo sender list."
      );
    } else {
      addCheck(checks, "warn", "Brevo sender", sendersResult.message || "Could not read sender list.");
    }

    addCheck(
      checks,
      usesFreeSenderDomain ? (senderIsActive ? "warn" : "bad") : "good",
      "Sender domain",
      usesFreeSenderDomain
        ? senderIsActive
          ? "This matches the Dividend setup: an active Brevo sender using Gmail, with the app email kept as reply-to. A custom domain is still best for maximum delivery."
          : "This is a free email domain and it is not an active Brevo sender."
        : "Custom sender domain configured."
    );

    if (!usesFreeSenderDomain && domainsResult.ok) {
      addCheck(
        checks,
        matchingDomain?.authenticated && matchingDomain?.verified ? "good" : "bad",
        "Domain authentication",
        matchingDomain
          ? `${matchingDomain.domain_name} is ${matchingDomain.authenticated ? "" : "not "}authenticated and ${matchingDomain.verified ? "" : "not "}verified.`
          : "This sender domain was not found in Brevo domains."
      );
    } else if (usesFreeSenderDomain) {
      addCheck(
        checks,
        senderIsActive ? "warn" : "bad",
        "Domain authentication",
        senderIsActive
          ? "Gmail/Yahoo/Outlook-style domains cannot be domain-authenticated in Brevo, but this sender is active in Brevo."
          : "Gmail/Yahoo/Outlook-style domains cannot be domain-authenticated in Brevo."
      );
    } else {
      addCheck(checks, "warn", "Domain authentication", domainsResult.message || "Could not read domain authentication status.");
    }

    json(response, 200, {
      ok: true,
      checkedAt: new Date().toISOString(),
      provider: "brevo",
      senderEmail,
      senderDomain,
      usesFreeSenderDomain,
      matchingSender: matchingSender
        ? {
            email: matchingSender.email || "",
            name: matchingSender.name || "",
            active: Boolean(matchingSender.active)
          }
        : null,
      matchingDomain: matchingDomain
        ? {
            domainName: matchingDomain.domain_name || "",
            authenticated: Boolean(matchingDomain.authenticated),
            verified: Boolean(matchingDomain.verified)
          }
        : null,
      availableSenders: senders.map((sender) => ({
        email: sender.email || "",
        name: sender.name || "",
        active: Boolean(sender.active)
      })).filter((sender) => sender.email),
      availableDomains: domains.map((domain) => ({
        domainName: domain.domain_name || "",
        authenticated: Boolean(domain.authenticated),
        verified: Boolean(domain.verified)
      })).filter((domain) => domain.domainName),
      checks
    });
  } catch (error) {
    json(response, 500, { ok: false, message: "Email setup could not be checked." });
  }
};
