const adminSummary = document.querySelector("#adminSummary");
const adminUsersTable = document.querySelector("#adminUsersTable");
const adminUserCount = document.querySelector("#adminUserCount");
const adminEmptyState = document.querySelector("#adminEmptyState");
const exportUsersCsv = document.querySelector("#exportUsersCsv");
const adminGate = document.querySelector("#adminGate");
const adminDashboard = document.querySelector("#adminDashboard");
const adminGateForm = document.querySelector("#adminGateForm");
const adminPin = document.querySelector("#adminPin");
const adminGateMessage = document.querySelector("#adminGateMessage");
const adminSignOut = document.querySelector("#adminSignOut");
const adminCreateUserForm = document.querySelector("#adminCreateUserForm");
const adminCreateUsername = document.querySelector("#adminCreateUsername");
const adminCreateEmail = document.querySelector("#adminCreateEmail");
const adminCreatePassword = document.querySelector("#adminCreatePassword");
const adminCreateConfirmPassword = document.querySelector("#adminCreateConfirmPassword");
const adminCreateRole = document.querySelector("#adminCreateRole");
const adminCreatePlan = document.querySelector("#adminCreatePlan");
const adminCreateCustomDays = document.querySelector("#adminCreateCustomDays");
const adminCreateCustomDaysWrap = document.querySelector("#adminCreateCustomDaysWrap");
const adminCreateUserMessage = document.querySelector("#adminCreateUserMessage");
const adminSearch = document.querySelector("#adminSearch");
const adminStatusFilter = document.querySelector("#adminStatusFilter");
const checkEmailSetup = document.querySelector("#checkEmailSetup");
const emailSenderLabel = document.querySelector("#emailSenderLabel");
const emailHealthSummary = document.querySelector("#emailHealthSummary");
const emailSetupChecks = document.querySelector("#emailSetupChecks");

const usersStorageKey = "shiftPatternUsers";
const currentUserStorageKey = "shiftPatternCurrentUser";
const adminSessionKey = "rotaSalaryOwnerAdminUnlocked";
const freeTrialDays = 30;
let adminSessionPasskey = "";

const planOptions = {
  none: { label: "No subscription", days: 0 },
  trial: { label: "1 month free", days: 30 },
  month: { label: "1 month", days: 30 },
  sixMonths: { label: "6 months", days: 183 },
  year: { label: "1 year", days: 365 },
  lifetime: { label: "Lifetime", days: 999999 },
  custom: { label: "Custom days", days: 30 }
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/London"
});

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fallbackHash(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return `local-${Math.abs(hash).toString(16)}`;
}

async function hashPassword(password) {
  if (!window.crypto?.subtle) return fallbackHash(password);
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + Math.max(0, Number(days) || 0) * 86400000);
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  if (date.getFullYear() >= 9999) return "Lifetime";
  return dateFormatter.format(date);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || "").trim());
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

function ensureUser(user) {
  const now = new Date().toISOString();
  const createdAt = user.createdAt || now;
  const planKey = user.planKey || (user.subscriptionUntil ? "custom" : "trial");
  const defaultSubscription = subscriptionFromPlan(planKey === "custom" ? "trial" : planKey, freeTrialDays);

  return {
    id: user.id || makeId(),
    username: user.username || "Shift user",
    email: user.email || "",
    role: user.role || "user",
    passwordHash: user.passwordHash || "",
    createdAt,
    createdByAdminAt: user.createdByAdminAt || createdAt,
    lastUpdatedAt: user.lastUpdatedAt || createdAt,
    isLocked: Boolean(user.isLocked),
    lockedAt: user.lockedAt || "",
    unlockedAt: user.unlockedAt || "",
    planKey,
    planType: user.planType || planOptions[planKey]?.label || defaultSubscription.planType,
    subscriptionDaysGranted: Number(user.subscriptionDaysGranted ?? defaultSubscription.subscriptionDaysGranted),
    subscriptionStartedAt: user.subscriptionStartedAt || defaultSubscription.subscriptionStartedAt || createdAt,
    subscriptionUntil: user.subscriptionUntil || defaultSubscription.subscriptionUntil,
    paymentConfirmed: Boolean(user.paymentConfirmed)
  };
}

function loadUsers() {
  const stored = readJson(usersStorageKey, []);
  const byEmail = new Map();
  (Array.isArray(stored) ? stored : []).map(ensureUser).forEach((user) => {
    const key = normalize(user.email) || user.id;
    byEmail.set(key, { ...byEmail.get(key), ...user });
  });
  const users = [...byEmail.values()];
  writeJson(usersStorageKey, users);
  return users;
}

function saveUsers(users) {
  writeJson(usersStorageKey, users.map(ensureUser));
}

function userMatchesSession(user, sessionUser) {
  if (!user || !sessionUser) return false;
  return (user.id && sessionUser.id && user.id === sessionUser.id)
    || (normalize(user.email) && normalize(user.email) === normalize(sessionUser.email));
}

function clearLockedActiveSession(user) {
  const sessionUser = readJson(currentUserStorageKey, null);
  if (userMatchesSession(user, sessionUser)) {
    localStorage.removeItem(currentUserStorageKey);
  }
}

function daysLeftForUser(user) {
  if (user.planKey === "lifetime") return Infinity;
  const expiry = new Date(user.subscriptionUntil || "");
  if (!Number.isFinite(expiry.getTime())) return 0;
  return Math.max(0, Math.ceil((expiry - new Date()) / 86400000));
}

function accessLabel(user) {
  if (user.isLocked) return "Locked";
  const days = daysLeftForUser(user);
  if (days === Infinity) return "Lifetime";
  if (days <= 0) return "Expired";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function statusKey(user) {
  if (user.isLocked) return "locked";
  const days = daysLeftForUser(user);
  if (days === Infinity || days > 14) return "active";
  if (days > 0) return "soon";
  return "expired";
}

function statusLabel(user) {
  const key = statusKey(user);
  if (key === "soon") return "Expiring soon";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function filteredUsers(users) {
  const search = normalize(adminSearch?.value || "");
  const filter = adminStatusFilter?.value || "all";
  return users.filter((user) => {
    const matchesSearch = !search || [user.username, user.email, user.role, user.planType]
      .some((value) => normalize(value).includes(search));
    const matchesFilter = filter === "all" || statusKey(user) === filter;
    return matchesSearch && matchesFilter;
  });
}

function renderSummary(users) {
  const active = users.filter((user) => statusKey(user) === "active").length;
  const soon = users.filter((user) => statusKey(user) === "soon").length;
  const expired = users.filter((user) => statusKey(user) === "expired").length;
  const lifetime = users.filter((user) => user.planKey === "lifetime").length;
  adminSummary.innerHTML = [
    ["Total users", users.length],
    ["Active", active],
    ["Expiring soon", soon],
    ["Expired", expired],
    ["Lifetime", lifetime]
  ].map(([label, value]) => `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function planSelect(user) {
  return `
    <select class="admin-plan-select" data-user-id="${escapeHtml(user.id)}" aria-label="Choose subscription plan">
      ${Object.entries(planOptions).map(([key, plan]) => `
        <option value="${key}" ${key === user.planKey ? "selected" : ""}>${escapeHtml(plan.label)}</option>
      `).join("")}
    </select>
  `;
}

function rowCustomDaysValue(user) {
  if (user.planKey === "lifetime") return 999999;
  const days = daysLeftForUser(user);
  return Number.isFinite(days) ? days : 30;
}

function renderUsers() {
  const users = loadUsers();
  const visibleUsers = filteredUsers(users);
  adminUserCount.textContent = `${visibleUsers.length} of ${users.length} ${users.length === 1 ? "user" : "users"}`;
  adminEmptyState.hidden = visibleUsers.length > 0;
  renderSummary(users);

  adminUsersTable.innerHTML = visibleUsers.map((user) => {
    const key = statusKey(user);
    return `
      <tr>
        <td>
          <div class="user-cell">
            <strong>${escapeHtml(user.username)}</strong>
            <span>${escapeHtml(user.email || "No email")}</span>
          </div>
        </td>
        <td><span class="pill">${escapeHtml(user.role)}</span></td>
        <td><strong>${escapeHtml(user.planType || "No subscription")}</strong><br>${escapeHtml(formatDate(user.subscriptionUntil))}</td>
        <td><strong>${escapeHtml(accessLabel(user))}</strong></td>
        <td><span class="pill ${escapeHtml(key)}">${escapeHtml(statusLabel(user))}</span></td>
        <td>${escapeHtml(formatDate(user.createdAt))}</td>
        <td>${escapeHtml(formatDate(user.lastUpdatedAt))}</td>
        <td>
          <div class="row-actions">
            ${planSelect(user)}
            <input class="admin-custom-days" type="number" min="0" step="1" value="${escapeHtml(rowCustomDaysValue(user))}" aria-label="Subscription days">
            <button class="give-subscription-btn" type="button" data-user-id="${escapeHtml(user.id)}">Give</button>
            <button class="remove-subscription-btn danger" type="button" data-user-id="${escapeHtml(user.id)}">Remove plan</button>
            <button class="lock-user-btn" type="button" data-user-id="${escapeHtml(user.id)}" data-locked="${user.isLocked ? "true" : "false"}">${user.isLocked ? "Unlock" : "Lock"}</button>
            <input class="password-input" type="password" minlength="6" placeholder="New password" aria-label="New password">
            <button class="set-password-btn" type="button" data-user-id="${escapeHtml(user.id)}">Set password</button>
            <button class="delete-user-btn danger" type="button" data-user-id="${escapeHtml(user.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderEmailSetupChecks(checks = []) {
  if (!emailSetupChecks) return;
  emailSetupChecks.innerHTML = checks.map((check) => `
    <li class="${escapeHtml(check.level || "warn")}">
      <b>${escapeHtml(check.label || "Check")}</b>
      <span>${escapeHtml(check.detail || "")}</span>
    </li>
  `).join("");
}

function setEmailHealth(senderLabel, summary, checks = []) {
  if (emailSenderLabel) emailSenderLabel.textContent = senderLabel;
  if (emailHealthSummary) emailHealthSummary.textContent = summary;
  renderEmailSetupChecks(checks);
}

async function checkOtpEmailSetup() {
  if (!adminSessionPasskey) {
    setEmailHealth(
      "Unlock admin again",
      "For safety, the admin passkey is only kept in memory. Lock admin, unlock again, then run this check.",
      []
    );
    return;
  }

  if (checkEmailSetup) checkEmailSetup.disabled = true;
  setEmailHealth("Checking OTP setup...", "Reading Brevo sender and domain status from the server.", []);
  try {
    const response = await fetch("/api/email-setup-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ passkey: adminSessionPasskey })
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok || !data.ok) throw new Error(data.message || "Could not check OTP email setup.");

    const badChecks = data.checks.filter((check) => check.level === "bad").length;
    const warnChecks = data.checks.filter((check) => check.level === "warn").length;
    const summary = badChecks
      ? "Action needed before OTP delivery will be reliable."
      : warnChecks
        ? "Mostly ready, but review the warnings before relying on it."
        : "OTP email setup looks healthy.";
    setEmailHealth(`Sender: ${data.senderEmail || "Not configured"}`, summary, data.checks);
  } catch (error) {
    setEmailHealth("Could not check OTP setup", error.message || "Try again after checking Vercel and Brevo.", []);
  } finally {
    if (checkEmailSetup) checkEmailSetup.disabled = false;
  }
}

function showAdminDashboard() {
  adminGate.hidden = true;
  adminDashboard.hidden = false;
  renderUsers();
}

function lockAdminDashboard() {
  adminSessionPasskey = "";
  sessionStorage.removeItem(adminSessionKey);
  adminDashboard.hidden = true;
  adminGate.hidden = false;
  adminPin.value = "";
  adminPin.focus();
}

function unlockAdmin(passkey = "") {
  adminSessionPasskey = passkey;
  sessionStorage.setItem(adminSessionKey, "true");
  adminGateMessage.textContent = "";
  showAdminDashboard();
}

async function verifyAdminPasskey(passkey) {
  const response = await fetch("/api/admin-auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ passkey })
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "The admin passkey is incorrect.");
  }
  return true;
}

async function createUserFromAdmin() {
  const username = adminCreateUsername.value.trim();
  const email = adminCreateEmail.value.trim();
  const role = adminCreateRole.value || "user";
  const planKey = adminCreatePlan.value || "month";
  const password = adminCreatePassword.value;
  const confirmPassword = adminCreateConfirmPassword.value;
  const users = loadUsers();

  adminCreateUserMessage.textContent = "";

  if (!isValidEmail(email)) {
    adminCreateUserMessage.textContent = "Enter a valid email address.";
    adminCreateEmail.focus();
    return;
  }

  if (users.some((user) => normalize(user.email) === normalize(email))) {
    adminCreateUserMessage.textContent = "This email address already exists.";
    adminCreateEmail.focus();
    return;
  }

  if (users.some((user) => normalize(user.username) === normalize(username))) {
    adminCreateUserMessage.textContent = "This username already exists.";
    adminCreateUsername.focus();
    return;
  }

  if (password !== confirmPassword) {
    adminCreateUserMessage.textContent = "Both passwords must match.";
    adminCreateConfirmPassword.focus();
    return;
  }

  const now = new Date().toISOString();
  const subscription = subscriptionFromPlan(planKey, adminCreateCustomDays.value);
  const user = ensureUser({
    id: makeId(),
    username,
    email,
    role,
    passwordHash: await hashPassword(password),
    createdAt: now,
    createdByAdminAt: now,
    lastUpdatedAt: now,
    ...subscription
  });

  saveUsers([...users, user]);
  adminCreateUserForm.reset();
  adminCreatePlan.value = "month";
  adminCreateCustomDays.value = 30;
  syncCreateCustomDays();
  adminCreateUserMessage.textContent = "User created successfully.";
  renderUsers();
}

function updateUser(userId, updater) {
  const now = new Date().toISOString();
  const users = loadUsers().map((user) => {
    if (user.id !== userId) return user;
    return ensureUser({ ...user, ...updater(user), lastUpdatedAt: now });
  });
  saveUsers(users);
  renderUsers();
}

function giveSubscription(userId, actionElement) {
  const container = actionElement.closest(".row-actions");
  const planKey = container?.querySelector(".admin-plan-select")?.value || "month";
  const customDays = container?.querySelector(".admin-custom-days")?.value || 30;
  updateUser(userId, () => ({
    ...subscriptionFromPlan(planKey, customDays),
    isLocked: false,
    unlockedAt: new Date().toISOString()
  }));
}

function removeSubscription(userId) {
  const confirmed = window.confirm("Remove this user's subscription access?");
  if (!confirmed) return;
  updateUser(userId, () => subscriptionFromPlan("none", 0));
}

function toggleLock(userId, shouldLock) {
  let lockedUser = null;
  updateUser(userId, (user) => {
    lockedUser = ensureUser({
      ...user,
      isLocked: shouldLock,
      lockedAt: shouldLock ? new Date().toISOString() : "",
      unlockedAt: shouldLock ? "" : new Date().toISOString()
    });
    return lockedUser;
  });

  if (shouldLock) {
    clearLockedActiveSession(lockedUser);
  }
}

async function setUserPassword(userId, actionElement) {
  const passwordInput = actionElement.closest(".row-actions")?.querySelector(".password-input");
  const password = passwordInput?.value || "";
  if (password.length < 6) {
    window.alert("Enter a new password with at least 6 characters.");
    passwordInput?.focus();
    return;
  }
  const passwordHash = await hashPassword(password);
  updateUser(userId, () => ({
    passwordHash,
    passwordChangedByAdminAt: new Date().toISOString()
  }));
  window.alert("Password updated for this user.");
}

function deleteUser(userId) {
  const users = loadUsers();
  const user = users.find((item) => item.id === userId);
  if (!user) return;
  const confirmed = window.confirm(`Delete ${user.username || user.email}? This cannot be undone.`);
  if (!confirmed) return;
  saveUsers(users.filter((item) => item.id !== userId));
  renderUsers();
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadUsersCsv() {
  const rows = [
    ["Username", "Email", "Role", "Subscription", "Days left", "Status", "Created", "Last updated"]
  ];
  loadUsers().forEach((user) => {
    rows.push([
      user.username,
      user.email,
      user.role,
      user.planType,
      accessLabel(user),
      statusLabel(user),
      formatDate(user.createdAt),
      formatDate(user.lastUpdatedAt)
    ]);
  });
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "shift-pattern-users.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function syncCreateCustomDays() {
  const isCustom = adminCreatePlan.value === "custom";
  adminCreateCustomDaysWrap.hidden = !isCustom;
  if (!isCustom) {
    adminCreateCustomDays.value = planOptions[adminCreatePlan.value]?.days || 30;
  }
}

adminGateForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = adminGateForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  adminGateMessage.textContent = "Checking admin access...";
  try {
    await verifyAdminPasskey(adminPin.value);
    unlockAdmin(adminPin.value);
  } catch (error) {
    adminGateMessage.textContent = error.message || "The admin passkey is incorrect.";
    adminPin.focus();
  } finally {
    submitButton.disabled = false;
  }
});

adminSignOut?.addEventListener("click", lockAdminDashboard);
adminCreateUserForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void createUserFromAdmin();
});
adminCreatePlan?.addEventListener("change", syncCreateCustomDays);
adminSearch?.addEventListener("input", renderUsers);
adminStatusFilter?.addEventListener("change", renderUsers);
exportUsersCsv?.addEventListener("click", downloadUsersCsv);
checkEmailSetup?.addEventListener("click", () => {
  void checkOtpEmailSetup();
});

adminUsersTable?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const userId = button.dataset.userId || "";

  if (button.classList.contains("give-subscription-btn")) {
    giveSubscription(userId, button);
    return;
  }

  if (button.classList.contains("remove-subscription-btn")) {
    removeSubscription(userId);
    return;
  }

  if (button.classList.contains("lock-user-btn")) {
    toggleLock(userId, button.dataset.locked !== "true");
    return;
  }

  if (button.classList.contains("set-password-btn")) {
    await setUserPassword(userId, button);
    return;
  }

  if (button.classList.contains("delete-user-btn")) {
    deleteUser(userId);
  }
});

adminUsersTable?.addEventListener("change", (event) => {
  const select = event.target.closest(".admin-plan-select");
  if (!select) return;
  const daysInput = select.closest(".row-actions")?.querySelector(".admin-custom-days");
  if (daysInput) daysInput.value = planOptions[select.value]?.days || 30;
});

syncCreateCustomDays();
if (sessionStorage.getItem(adminSessionKey) === "true") {
  unlockAdmin();
} else {
  lockAdminDashboard();
}
