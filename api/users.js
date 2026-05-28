const crypto = require("crypto");
const {
  addDays,
  createSessionToken,
  daysLeftForUser,
  deleteUser,
  ensureUser,
  findUser,
  isValidEmail,
  listUsers,
  makeId,
  normalize,
  readSessionToken,
  safeEqual,
  safeUser,
  storeError,
  upsertUser
} = require("./user-store");

const freeTrialDays = 30;

const planOptions = {
  none: { label: "No subscription", days: 0 },
  trial: { label: "1 month free", days: 30 },
  month: { label: "1 month", days: 30 },
  sixMonths: { label: "6 months", days: 183 },
  year: { label: "1 year", days: 365 },
  lifetime: { label: "Lifetime", days: 999999 },
  custom: { label: "Custom days", days: 30 }
};

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

function requireAdmin(passkey) {
  const configuredPasskey = process.env.ADMIN_PASSKEY || "";
  if (!configuredPasskey) throw storeError(500, "Admin access is not configured.");
  if (!safeEqual(passkey, configuredPasskey)) throw storeError(401, "The admin passkey is incorrect.");
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

function readOtpToken(token, secret) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw storeError(400, "OTP token is missing.");
  const expectedSignature = signTokenPayload(payload, secret);
  if (!safeEqual(signature, expectedSignature)) throw storeError(400, "OTP token is no longer valid.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function verifyOtp({ email, code, otpToken }) {
  const secret = process.env.OTP_SECRET;
  if (!secret) throw storeError(500, "OTP_SECRET is missing in Vercel.");
  const cleanEmail = normalize(email);
  const cleanCode = String(code || "").replace(/\s+/g, "");
  const token = readOtpToken(otpToken, secret);
  const expiresAt = new Date(token.expiresAt || "");

  if (!cleanEmail || token.email !== cleanEmail) throw storeError(400, "Request a new OTP for this email address.");
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw storeError(400, "This OTP has expired. Please request a new one.");
  }
  if (!/^\d{6}$/.test(cleanCode)) throw storeError(400, "Enter the 6-digit OTP code.");

  const expectedHash = hashOtp({ email: cleanEmail, code: cleanCode, nonce: token.nonce, secret });
  if (!safeEqual(expectedHash, token.codeHash)) {
    throw storeError(400, "The OTP is incorrect. Please check the code and try again.");
  }
}

function subscriptionFromPlan(planKey, customDays = 30) {
  const plan = planOptions[planKey] || planOptions.month;
  const now = new Date();
  const days = planKey === "custom" ? Math.max(0, Number(customDays) || 0) : plan.days;

  if (planKey === "lifetime") {
    return {
      planKey,
      planType: plan.label,
      subscriptionDaysGranted: 999999,
      subscriptionStartedAt: now.toISOString(),
      subscriptionUntil: "9999-12-31T23:59:59.000Z",
      paymentConfirmed: true
    };
  }

  return {
    planKey,
    planType: plan.label,
    subscriptionDaysGranted: Math.max(0, Number(days) || 0),
    subscriptionStartedAt: now.toISOString(),
    subscriptionUntil: addDays(now, days).toISOString(),
    paymentConfirmed: planKey !== "trial" && planKey !== "none" && days > 0
  };
}

function sortedSafeUsers(users) {
  return users
    .map(safeUser)
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
}

async function assertNoDuplicate({ email, username, ignoreUserId = "" }) {
  const users = await listUsers();
  const duplicateEmail = users.find((user) => normalize(user.email) === normalize(email) && user.id !== ignoreUserId);
  if (duplicateEmail) throw storeError(409, "This email address already exists.");
  const duplicateUsername = users.find((user) => normalize(user.username) === normalize(username) && user.id !== ignoreUserId);
  if (duplicateUsername) throw storeError(409, "This username is already registered.");
}

function cleanUpdates(updates = {}) {
  const allowed = [
    "username",
    "email",
    "role",
    "passwordHash",
    "isLocked",
    "lockedAt",
    "unlockedAt",
    "planKey",
    "planType",
    "subscriptionDaysGranted",
    "subscriptionStartedAt",
    "subscriptionUntil",
    "paymentConfirmed",
    "createdByAdminAt",
    "otpVerified",
    "otpVerifiedAt"
  ];
  return allowed.reduce((clean, key) => {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      if (key === "passwordHash" && !updates[key]) return clean;
      clean[key] = updates[key];
    }
    return clean;
  }, {});
}

async function handleSignup(body) {
  const username = String(body.username || "").trim();
  const email = normalize(body.email);
  const passwordHash = String(body.passwordHash || "");
  if (username.length < 2) throw storeError(400, "Enter a username with at least 2 characters.");
  if (!isValidEmail(email)) throw storeError(400, "Enter a valid email address.");
  if (!passwordHash) throw storeError(400, "A password is required.");

  verifyOtp({ email, code: body.otpCode, otpToken: body.otpToken });
  await assertNoDuplicate({ email, username });

  const now = new Date();
  const user = await upsertUser({
    id: makeId(),
    username,
    email,
    passwordHash,
    role: "user",
    createdAt: now.toISOString(),
    lastUpdatedAt: now.toISOString(),
    planKey: "trial",
    planType: "One month free",
    subscriptionDaysGranted: freeTrialDays,
    subscriptionStartedAt: now.toISOString(),
    subscriptionUntil: addDays(now, freeTrialDays).toISOString(),
    otpVerified: true,
    otpVerifiedAt: now.toISOString(),
    paymentConfirmed: false
  });
  return { ok: true, user: safeUser(user) };
}

async function handleSignin(body) {
  const identity = String(body.identity || "").trim();
  const passwordHash = String(body.passwordHash || "");
  const user = await findUser(identity);
  if (!user) throw storeError(404, "No account was found for that username or email.");
  if (!safeEqual(user.passwordHash, passwordHash)) throw storeError(401, "The password is incorrect.");
  if (user.isLocked) throw storeError(423, "This account is locked.");
  if (daysLeftForUser(user) <= 0) throw storeError(402, "Your plan has expired.");

  const updatedUser = await upsertUser({
    ...user,
    lastSignedInAt: new Date().toISOString(),
    signInCount: Number(user.signInCount || 0) + 1,
    lastUpdatedAt: new Date().toISOString()
  });
  return {
    ok: true,
    user: safeUser(updatedUser),
    sessionToken: createSessionToken(updatedUser)
  };
}

async function handleMe(body) {
  const session = readSessionToken(body.sessionToken);
  const user = await findUser(session.email);
  if (!user || user.id !== session.id) throw storeError(401, "Please sign in again.");
  return { ok: true, user: safeUser(user), sessionToken: body.sessionToken };
}

async function handleAdminList(body) {
  requireAdmin(body.passkey);
  return { ok: true, users: sortedSafeUsers(await listUsers()) };
}

async function handleAdminCreate(body) {
  requireAdmin(body.passkey);
  const username = String(body.username || "").trim();
  const email = normalize(body.email);
  const passwordHash = String(body.passwordHash || "");
  const role = String(body.role || "user").trim() || "user";
  if (username.length < 2) throw storeError(400, "Enter a username with at least 2 characters.");
  if (!isValidEmail(email)) throw storeError(400, "Enter a valid email address.");
  if (!passwordHash) throw storeError(400, "A password is required.");
  await assertNoDuplicate({ email, username });

  const now = new Date().toISOString();
  await upsertUser({
    id: makeId(),
    username,
    email,
    role,
    passwordHash,
    createdAt: now,
    createdByAdminAt: now,
    lastUpdatedAt: now,
    ...subscriptionFromPlan(body.planKey || "month", body.customDays)
  });
  return { ok: true, users: sortedSafeUsers(await listUsers()) };
}

async function handleAdminUpdate(body) {
  requireAdmin(body.passkey);
  const userId = String(body.userId || "");
  const users = await listUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) throw storeError(404, "User not found.");
  const updates = cleanUpdates(body.updates || {});
  const username = updates.username || user.username;
  const email = updates.email || user.email;
  await assertNoDuplicate({ email, username, ignoreUserId: user.id });
  await upsertUser(ensureUser({
    ...user,
    ...updates,
    lastUpdatedAt: new Date().toISOString()
  }));
  return { ok: true, users: sortedSafeUsers(await listUsers()) };
}

async function handleAdminDelete(body) {
  requireAdmin(body.passkey);
  const users = await listUsers();
  const user = users.find((item) => item.id === String(body.userId || ""));
  if (user) await deleteUser(user);
  return { ok: true, users: sortedSafeUsers(await listUsers()) };
}

async function handleAdminImport(body) {
  requireAdmin(body.passkey);
  const users = Array.isArray(body.users) ? body.users : [];
  for (const user of users.slice(0, 1000)) {
    if (!isValidEmail(user.email) || !user.passwordHash) continue;
    await upsertUser(ensureUser(user));
  }
  return { ok: true, users: sortedSafeUsers(await listUsers()) };
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const body = await readBody(request);
    const action = String(body.action || "");
    const handlers = {
      signup: handleSignup,
      signin: handleSignin,
      me: handleMe,
      "admin-list": handleAdminList,
      "admin-create": handleAdminCreate,
      "admin-update": handleAdminUpdate,
      "admin-delete": handleAdminDelete,
      "admin-import": handleAdminImport
    };
    if (!handlers[action]) throw storeError(400, "Unknown user action.");
    json(response, 200, await handlers[action](body));
  } catch (error) {
    json(response, error.status || 500, {
      ok: false,
      code: error.status || 500,
      message: error.message || "User request failed."
    });
  }
};
