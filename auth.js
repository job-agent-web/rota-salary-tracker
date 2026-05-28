const usersStorageKey = "shiftPatternUsers";
const currentUserStorageKey = "shiftPatternCurrentUser";
const rememberedSigninKey = "shiftPatternRememberedSignin";
const freeTrialDays = 30;

const signinForm = document.querySelector("#signinForm");
const signupForm = document.querySelector("#signupForm");
const signoutPanel = document.querySelector("#signoutPanel");
const signinIdentity = document.querySelector("#signinIdentity");
const signinPassword = document.querySelector("#signinPassword");
const rememberSigninDetails = document.querySelector("#rememberSigninDetails");
const signinMessage = document.querySelector("#signinMessage");
const signupUsername = document.querySelector("#signupUsername");
const signupEmail = document.querySelector("#signupEmail");
const signupPassword = document.querySelector("#signupPassword");
const signupConfirmPassword = document.querySelector("#signupConfirmPassword");
const signupMessage = document.querySelector("#signupMessage");
const appInstallStatus = document.querySelector("[data-install-status]");
const paymentModal = document.querySelector("#signinPaymentModal");
const paymentModalClose = document.querySelector("#paymentModalClose");
const paymentModalStatus = document.querySelector("#paymentModalStatus");
const signinOpenPayment = document.querySelector("#signinOpenPayment");
const paymentOpenButtons = document.querySelectorAll("[data-open-payment]");
const paymentPlanButtons = document.querySelectorAll("[data-payment-plan]");

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

function addDays(date, days) {
  return new Date(date.getTime() + Math.max(0, Number(days) || 0) * 86400000);
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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || "").trim());
}

function ensureUser(user) {
  const now = new Date().toISOString();
  const createdAt = user.createdAt || now;
  return {
    id: user.id || makeId(),
    username: user.username || "Shift user",
    email: user.email || "",
    role: user.role || "user",
    passwordHash: user.passwordHash || "",
    createdAt,
    createdByAdminAt: user.createdByAdminAt || "",
    lastUpdatedAt: user.lastUpdatedAt || createdAt,
    isLocked: Boolean(user.isLocked),
    planKey: user.planKey || "trial",
    planType: user.planType || "One month free",
    subscriptionDaysGranted: Number(user.subscriptionDaysGranted || freeTrialDays),
    subscriptionStartedAt: user.subscriptionStartedAt || createdAt,
    subscriptionUntil: user.subscriptionUntil || addDays(new Date(createdAt), freeTrialDays).toISOString(),
    paymentConfirmed: Boolean(user.paymentConfirmed)
  };
}

function loadUsers() {
  const stored = readJson(usersStorageKey, []);
  return (Array.isArray(stored) ? stored : []).map(ensureUser);
}

function saveUsers(users) {
  writeJson(usersStorageKey, users.map(ensureUser));
}

function findUser(identity) {
  const key = normalize(identity);
  return loadUsers().find((user) => normalize(user.email) === key || normalize(user.username) === key);
}

function daysLeftForUser(user) {
  if (user.planKey === "lifetime") return Infinity;
  const expiry = new Date(user.subscriptionUntil || "");
  if (!Number.isFinite(expiry.getTime())) return 0;
  return Math.max(0, Math.ceil((expiry - new Date()) / 86400000));
}

function showMessage(target, message, isError = false) {
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("error", Boolean(isError));
}

function openPaymentModal() {
  if (!paymentModal) return;
  paymentModal.hidden = false;
  document.body.classList.add("payment-modal-open");
  paymentModalClose?.focus();
}

function closePaymentModal() {
  if (!paymentModal) return;
  paymentModal.hidden = true;
  document.body.classList.remove("payment-modal-open");
}

function paymentUserDetails() {
  const identity = signinIdentity?.value.trim() || "";
  const user = identity ? findUser(identity) : null;
  const name = user?.username || identity || "PLEASE replace this text with your email and username";
  const email = user?.email && normalize(user.email) !== normalize(name) ? user.email : "";
  return [name, email].filter(Boolean).join(" - ");
}

function buildRevolutUrl(amountPence, planName) {
  const note = `Rota & Salary Tracker ${planName} plan - ${paymentUserDetails()}`;
  return `https://revolut.me/valourex?currency=GBP&amount=${amountPence}&note=${encodeURIComponent(note)}`;
}

function openPaymentPlan(button) {
  const plan = button.dataset.paymentPlan || "Selected";
  const price = Number(button.dataset.paymentPrice || 0);
  const amountPence = Math.max(0, Math.round(price * 100));

  if (paymentModalStatus) {
    paymentModalStatus.textContent = `Opening Revolut for the ${plan} plan. After payment, contact the admin so your subscription can be activated.`;
  }

  const url = buildRevolutUrl(amountPence, plan);
  try {
    const paymentWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (!paymentWindow) window.location.href = url;
  } catch {
    window.location.href = url;
  }
}

function rememberSignin(identity, password) {
  if (!rememberSigninDetails?.checked) {
    localStorage.removeItem(rememberedSigninKey);
    return;
  }
  writeJson(rememberedSigninKey, { identity, password });
}

function hydrateRememberedSignin() {
  if (!signinForm || !signinIdentity || !signinPassword || !rememberSigninDetails) return;
  const saved = readJson(rememberedSigninKey, null);
  if (!saved) return;
  signinIdentity.value = saved.identity || "";
  signinPassword.value = saved.password || "";
  rememberSigninDetails.checked = true;
}

function showSigninAccessNotice() {
  if (!signinForm || !signinMessage) return;
  const params = new URLSearchParams(window.location.search);
  const isExpired = params.get("expired") === "1";
  const isLocked = params.get("locked") === "1";
  if (!isExpired && !isLocked) return;

  const identity = params.get("identity") || "";
  localStorage.removeItem(currentUserStorageKey);
  if (identity && signinIdentity && !signinIdentity.value) {
    signinIdentity.value = identity;
  }
  if (isLocked) {
    showMessage(signinMessage, "");
    if (signinOpenPayment) signinOpenPayment.hidden = true;
    return;
  }
  showMessage(
    signinMessage,
    "Your plan has expired. Please pay for a plan before you can access the platform.",
    true
  );
  if (signinOpenPayment) signinOpenPayment.hidden = false;
}

function bindInstallHints() {
  document.querySelectorAll("[data-install-platform]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const platform = link.dataset.installPlatform;
      if (!appInstallStatus) return;
      if (platform === "pc") {
        appInstallStatus.textContent = "On PC, open this page in Edge or Chrome, then use the browser menu to install or pin this site.";
      } else if (platform === "ios") {
        appInstallStatus.textContent = "On iPhone or iPad, open in Safari, tap Share, then choose Add to Home Screen.";
      } else {
        appInstallStatus.textContent = "On Android, open in Chrome, tap the menu, then choose Install app or Add to Home screen.";
      }
    });
  });
}

function bindPaymentModal() {
  paymentOpenButtons.forEach((button) => {
    button.addEventListener("click", openPaymentModal);
  });

  paymentModalClose?.addEventListener("click", closePaymentModal);
  paymentModal?.addEventListener("click", (event) => {
    if (event.target === paymentModal) closePaymentModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && paymentModal && !paymentModal.hidden) closePaymentModal();
  });

  paymentPlanButtons.forEach((button) => {
    button.addEventListener("click", () => {
      paymentPlanButtons.forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      const plan = button.dataset.paymentPlan || "Selected";
      const price = button.dataset.paymentPrice || "";
      if (paymentModalStatus) {
        paymentModalStatus.textContent = `${plan} plan selected: £${price}. Opening Revolut...`;
      }
      openPaymentPlan(button);
    });
  });
}

signupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = signupUsername.value.trim();
  const email = signupEmail.value.trim();
  const password = signupPassword.value;
  const confirmPassword = signupConfirmPassword.value;
  const users = loadUsers();

  if (!isValidEmail(email)) {
    showMessage(signupMessage, "Enter a valid email address.", true);
    signupEmail.focus();
    return;
  }

  if (password !== confirmPassword) {
    showMessage(signupMessage, "Both passwords must match.", true);
    signupConfirmPassword.focus();
    return;
  }

  if (users.some((user) => normalize(user.username) === normalize(username))) {
    showMessage(signupMessage, "This username is already registered.", true);
    signupUsername.focus();
    return;
  }

  if (users.some((user) => normalize(user.email) === normalize(email))) {
    showMessage(signupMessage, "This email is already registered.", true);
    signupEmail.focus();
    return;
  }

  const now = new Date();
  const user = ensureUser({
    id: makeId(),
    username,
    email,
    passwordHash: await hashPassword(password),
    createdAt: now.toISOString(),
    lastUpdatedAt: now.toISOString(),
    planKey: "trial",
    planType: "One month free",
    subscriptionDaysGranted: freeTrialDays,
    subscriptionStartedAt: now.toISOString(),
    subscriptionUntil: addDays(now, freeTrialDays).toISOString(),
    paymentConfirmed: false
  });

  saveUsers([...users, user]);
  showMessage(signupMessage, "Account created. Opening sign in...");
  window.setTimeout(() => {
    window.location.href = "signin.html";
  }, 700);
});

signinForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (signinOpenPayment) signinOpenPayment.hidden = true;
  const identity = signinIdentity.value.trim();
  const password = signinPassword.value;
  const user = findUser(identity);
  const passwordHash = await hashPassword(password);

  if (!user || user.passwordHash !== passwordHash) {
    showMessage(signinMessage, "The username, email, or password is incorrect.", true);
    signinPassword.focus();
    return;
  }

  if (user.isLocked) {
    localStorage.removeItem(currentUserStorageKey);
    showMessage(signinMessage, "This account is locked. Contact admin for help.", true);
    return;
  }

  if (daysLeftForUser(user) <= 0) {
    localStorage.removeItem(currentUserStorageKey);
    showMessage(signinMessage, "Your plan has expired. Please pay for a plan before you can access the platform.", true);
    if (signinOpenPayment) signinOpenPayment.hidden = false;
    return;
  }

  const updatedUser = ensureUser({
    ...user,
    lastSignedInAt: new Date().toISOString(),
    signInCount: Number(user.signInCount || 0) + 1
  });
  saveUsers(loadUsers().map((item) => item.id === updatedUser.id ? updatedUser : item));
  writeJson(currentUserStorageKey, updatedUser);
  rememberSignin(identity, password);
  showMessage(signinMessage, "Signed in. Opening your tracker...");
  window.setTimeout(() => {
    window.location.href = "index.html";
  }, 500);
});

if (signoutPanel) {
  localStorage.removeItem(currentUserStorageKey);
  sessionStorage.removeItem("rotaSalaryOwnerAdminUnlocked");
  localStorage.removeItem("rotaSalaryOwnerAdminUnlocked");
}

bindInstallHints();
bindPaymentModal();
hydrateRememberedSignin();
showSigninAccessNotice();
