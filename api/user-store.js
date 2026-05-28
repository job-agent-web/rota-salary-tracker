const crypto = require("crypto");

const appMarker = "rota-salary-tracker";
const freeTrialDays = 30;

const attr = {
  app: "RSTA_APP",
  id: "RSTA_ID",
  username: "RSTA_USER",
  role: "RSTA_ROLE",
  passwordHash: "RSTA_PWHASH",
  planKey: "RSTA_PLAN",
  planType: "RSTA_PLAN_TYPE",
  subscriptionDaysGranted: "RSTA_DAYS",
  subscriptionStartedAt: "RSTA_START",
  subscriptionUntil: "RSTA_UNTIL",
  paymentConfirmed: "RSTA_PAYCONF",
  isLocked: "RSTA_LOCKED",
  createdAt: "RSTA_CREATED",
  createdByAdminAt: "RSTA_ADMIN_AT",
  lastUpdatedAt: "RSTA_UPDATED",
  otpVerified: "RSTA_OTP",
  otpVerifiedAt: "RSTA_OTP_AT",
  lockedAt: "RSTA_LOCKED_AT",
  unlockedAt: "RSTA_UNLOCKED",
  lastSignedInAt: "RSTA_SIGNIN_AT",
  signInCount: "RSTA_SIGNINS"
};

const attrNames = Object.values(attr);
let ensureAttributesPromise = null;

function storeError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function brevoApiKey() {
  return process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY || "";
}

function requireBrevoApiKey() {
  const apiKey = brevoApiKey();
  if (!apiKey) {
    throw storeError(503, "Cloud account storage is not configured. Add BREVO_API_KEY in Vercel.");
  }
  return apiKey;
}

async function brevoFetch(path, options = {}) {
  const apiKey = requireBrevoApiKey();
  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      "api-key": apiKey,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    throw storeError(response.status, data.message || data.error || `Brevo request failed with ${response.status}.`);
  }
  return data;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `user-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + Math.max(0, Number(days) || 0) * 86400000);
}

function boolValue(value) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || "").trim());
}

function ensureUser(user) {
  const now = new Date().toISOString();
  const createdAt = user.createdAt || now;
  return {
    id: user.id || makeId(),
    username: user.username || "Rota user",
    email: normalize(user.email),
    role: user.role || "user",
    passwordHash: user.passwordHash || "",
    createdAt,
    createdByAdminAt: user.createdByAdminAt || "",
    lastUpdatedAt: user.lastUpdatedAt || createdAt,
    isLocked: Boolean(user.isLocked),
    lockedAt: user.lockedAt || "",
    unlockedAt: user.unlockedAt || "",
    planKey: user.planKey || "trial",
    planType: user.planType || "One month free",
    subscriptionDaysGranted: Number(user.subscriptionDaysGranted || freeTrialDays),
    subscriptionStartedAt: user.subscriptionStartedAt || createdAt,
    subscriptionUntil: user.subscriptionUntil || addDays(new Date(createdAt), freeTrialDays).toISOString(),
    otpVerified: Boolean(user.otpVerified),
    otpVerifiedAt: user.otpVerifiedAt || "",
    paymentConfirmed: Boolean(user.paymentConfirmed),
    lastSignedInAt: user.lastSignedInAt || "",
    signInCount: Number(user.signInCount || 0)
  };
}

function daysLeftForUser(user) {
  if (user.planKey === "lifetime") return Infinity;
  const expiry = new Date(user.subscriptionUntil || "");
  if (!Number.isFinite(expiry.getTime())) return 0;
  return Math.max(0, Math.ceil((expiry - new Date()) / 86400000));
}

function safeUser(user) {
  const ensured = ensureUser(user);
  const { passwordHash, ...rest } = ensured;
  return rest;
}

function toBrevoAttributes(user) {
  const ensured = ensureUser(user);
  return {
    [attr.app]: appMarker,
    [attr.id]: ensured.id,
    [attr.username]: ensured.username,
    [attr.role]: ensured.role,
    [attr.passwordHash]: ensured.passwordHash,
    [attr.planKey]: ensured.planKey,
    [attr.planType]: ensured.planType,
    [attr.subscriptionDaysGranted]: String(ensured.subscriptionDaysGranted),
    [attr.subscriptionStartedAt]: ensured.subscriptionStartedAt,
    [attr.subscriptionUntil]: ensured.subscriptionUntil,
    [attr.paymentConfirmed]: String(Boolean(ensured.paymentConfirmed)),
    [attr.isLocked]: String(Boolean(ensured.isLocked)),
    [attr.createdAt]: ensured.createdAt,
    [attr.createdByAdminAt]: ensured.createdByAdminAt,
    [attr.lastUpdatedAt]: ensured.lastUpdatedAt,
    [attr.otpVerified]: String(Boolean(ensured.otpVerified)),
    [attr.otpVerifiedAt]: ensured.otpVerifiedAt,
    [attr.lockedAt]: ensured.lockedAt,
    [attr.unlockedAt]: ensured.unlockedAt,
    [attr.lastSignedInAt]: ensured.lastSignedInAt,
    [attr.signInCount]: String(ensured.signInCount)
  };
}

function fromBrevoContact(contact) {
  const attributes = contact?.attributes || {};
  if (attributes[attr.app] !== appMarker && !attributes[attr.passwordHash]) return null;
  return ensureUser({
    id: attributes[attr.id],
    username: attributes[attr.username],
    email: contact.email || attributes.EMAIL,
    role: attributes[attr.role],
    passwordHash: attributes[attr.passwordHash],
    createdAt: attributes[attr.createdAt],
    createdByAdminAt: attributes[attr.createdByAdminAt],
    lastUpdatedAt: attributes[attr.lastUpdatedAt],
    isLocked: boolValue(attributes[attr.isLocked]),
    lockedAt: attributes[attr.lockedAt],
    unlockedAt: attributes[attr.unlockedAt],
    planKey: attributes[attr.planKey],
    planType: attributes[attr.planType],
    subscriptionDaysGranted: numberValue(attributes[attr.subscriptionDaysGranted], freeTrialDays),
    subscriptionStartedAt: attributes[attr.subscriptionStartedAt],
    subscriptionUntil: attributes[attr.subscriptionUntil],
    paymentConfirmed: boolValue(attributes[attr.paymentConfirmed]),
    otpVerified: boolValue(attributes[attr.otpVerified]),
    otpVerifiedAt: attributes[attr.otpVerifiedAt],
    lastSignedInAt: attributes[attr.lastSignedInAt],
    signInCount: numberValue(attributes[attr.signInCount], 0)
  });
}

async function ensureAttributes() {
  if (ensureAttributesPromise) return ensureAttributesPromise;
  ensureAttributesPromise = (async () => {
    const data = await brevoFetch("/contacts/attributes");
    const existing = new Set((data.attributes || []).map((item) => String(item.name || "").toUpperCase()));
    for (const name of attrNames) {
      if (existing.has(name)) continue;
      try {
        await brevoFetch(`/contacts/attributes/normal/${encodeURIComponent(name)}`, {
          method: "POST",
          body: JSON.stringify({ type: "text" })
        });
      } catch (error) {
        if (error.status !== 400) throw error;
      }
    }
  })();
  return ensureAttributesPromise;
}

async function listUsers() {
  const users = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const data = await brevoFetch(`/contacts?limit=${limit}&offset=${offset}&sort=desc`);
    const contacts = data.contacts || [];
    contacts.map(fromBrevoContact).filter(Boolean).forEach((user) => users.push(user));
    if (contacts.length < limit) break;
    offset += limit;
  }
  return users;
}

async function getUserByEmail(email) {
  if (!isValidEmail(email)) return null;
  try {
    const contact = await brevoFetch(`/contacts/${encodeURIComponent(normalize(email))}`);
    return fromBrevoContact(contact);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function findUser(identity) {
  const key = normalize(identity);
  if (!key) return null;
  if (isValidEmail(key)) return getUserByEmail(key);
  const users = await listUsers();
  return users.find((user) => normalize(user.username) === key) || null;
}

async function upsertUser(user) {
  const ensured = ensureUser(user);
  if (!isValidEmail(ensured.email)) throw storeError(400, "Enter a valid email address.");
  if (!ensured.passwordHash) throw storeError(400, "A password is required.");
  await ensureAttributes();
  const payload = {
    email: ensured.email,
    updateEnabled: true,
    attributes: toBrevoAttributes(ensured)
  };
  await brevoFetch("/contacts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return getUserByEmail(ensured.email);
}

async function deleteUser(user) {
  const ensured = ensureUser(user);
  if (!isValidEmail(ensured.email)) return;
  await brevoFetch(`/contacts/${encodeURIComponent(ensured.email)}`, {
    method: "DELETE"
  });
}

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.OTP_SECRET || process.env.ADMIN_PASSKEY || "";
}

function signPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionToken(user) {
  const secret = sessionSecret();
  if (!secret) throw storeError(500, "Session signing is not configured.");
  const ensured = ensureUser(user);
  const payload = Buffer.from(JSON.stringify({
    id: ensured.id,
    email: ensured.email,
    expiresAt: addDays(new Date(), 30).toISOString()
  })).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

function readSessionToken(token) {
  const secret = sessionSecret();
  if (!secret) throw storeError(500, "Session signing is not configured.");
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw storeError(401, "Please sign in again.");
  if (!safeEqual(signature, signPayload(payload, secret))) throw storeError(401, "Please sign in again.");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const expiry = new Date(data.expiresAt || "");
  if (!Number.isFinite(expiry.getTime()) || expiry <= new Date()) throw storeError(401, "Please sign in again.");
  return data;
}

module.exports = {
  addDays,
  createSessionToken,
  daysLeftForUser,
  deleteUser,
  ensureUser,
  findUser,
  getUserByEmail,
  isValidEmail,
  listUsers,
  makeId,
  normalize,
  readSessionToken,
  safeEqual,
  safeUser,
  storeError,
  upsertUser
};
