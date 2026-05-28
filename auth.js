const usersStorageKey = "shiftPatternUsers";
const currentUserStorageKey = "shiftPatternCurrentUser";
const rememberedSigninKey = "shiftPatternRememberedSignin";
const freeTrialDays = 30;
const supportEmail = "rota.salary.tracker@gmail.com";

const signinForm = document.querySelector("#signinForm");
const signupForm = document.querySelector("#signupForm");
const signoutPanel = document.querySelector("#signoutPanel");
const signinIdentity = document.querySelector("#signinIdentity");
const signinPassword = document.querySelector("#signinPassword");
const rememberSigninDetails = document.querySelector("#rememberSigninDetails");
const signinMessage = document.querySelector("#signinMessage");
const signupUsername = document.querySelector("#signupUsername");
const signupEmail = document.querySelector("#signupEmail");
const signupOtp = document.querySelector("#signupOtp");
const signupOtpPanel = document.querySelector("#signupOtpPanel");
const signupOtpLabel = document.querySelector("#signupOtpLabel");
const signupOtpStatus = document.querySelector("#signupOtpStatus");
const signupSendOtp = document.querySelector("#signupSendOtp");
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
const contactUsFab = document.querySelector("#contactUsFab");
const contactUsModal = document.querySelector("#contactUsModal");
const closeContactUsBtn = document.querySelector("#closeContactUsBtn");
const cancelContactUsBtn = document.querySelector("#cancelContactUsBtn");
const sendContactMessageBtn = document.querySelector("#sendContactMessageBtn");
const contactUserName = document.querySelector("#contactUserName");
const contactUserEmail = document.querySelector("#contactUserEmail");
const contactSubject = document.querySelector("#contactSubject");
const contactMessage = document.querySelector("#contactMessage");
const contactUsStatus = document.querySelector("#contactUsStatus");
let signupOtpToken = "";
let signupOtpEmail = "";
let signupOtpExpiresAt = "";
let signupOtpCooldownTimer = null;

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
    otpVerified: Boolean(user.otpVerified),
    otpVerifiedAt: user.otpVerifiedAt || "",
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

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { response, data };
}

function setSignupOtpStatus(message, isError = false) {
  showMessage(signupOtpStatus, message, isError);
}

function clearSignupOtp() {
  signupOtpToken = "";
  signupOtpEmail = "";
  signupOtpExpiresAt = "";
  window.clearInterval(signupOtpCooldownTimer);
  if (signupOtp) signupOtp.value = "";
  if (signupOtpLabel) signupOtpLabel.hidden = true;
  if (signupSendOtp) {
    signupSendOtp.disabled = false;
    signupSendOtp.textContent = "Send OTP";
  }
}

function signupPasswordReadyForOtp() {
  const password = signupPassword?.value || "";
  const confirmPassword = signupConfirmPassword?.value || "";
  return password.length >= 6 && password === confirmPassword;
}

function syncSignupOtpPanel() {
  if (!signupOtpPanel) return;
  const isReady = signupPasswordReadyForOtp();
  signupOtpPanel.hidden = !isReady;
  if (!isReady) {
    setSignupOtpStatus("");
    return;
  }
  if (!signupOtpToken && signupOtpStatus && !signupOtpStatus.textContent.trim()) {
    setSignupOtpStatus("Send OTP to verify email.");
  }
}

function resetSignupOtpAndSyncPanel() {
  clearSignupOtp();
  setSignupOtpStatus("");
  syncSignupOtpPanel();
}

function signupValues() {
  return {
    username: signupUsername?.value.trim() || "",
    email: signupEmail?.value.trim() || "",
    password: signupPassword?.value || "",
    confirmPassword: signupConfirmPassword?.value || "",
    users: loadUsers()
  };
}

function validateSignup({ requirePassword = false } = {}) {
  const values = signupValues();

  if (values.username.length < 2) {
    showMessage(signupMessage, "Enter a username with at least 2 characters.", true);
    signupUsername?.focus();
    return null;
  }

  if (!isValidEmail(values.email)) {
    showMessage(signupMessage, "Enter a valid email address.", true);
    signupEmail?.focus();
    return null;
  }

  if (values.users.some((user) => normalize(user.username) === normalize(values.username))) {
    showMessage(signupMessage, "This username is already registered.", true);
    signupUsername?.focus();
    return null;
  }

  if (values.users.some((user) => normalize(user.email) === normalize(values.email))) {
    showMessage(signupMessage, "This email is already registered.", true);
    signupEmail?.focus();
    return null;
  }

  if (requirePassword && values.password !== values.confirmPassword) {
    showMessage(signupMessage, "Both passwords must match.", true);
    signupConfirmPassword?.focus();
    return null;
  }

  if (requirePassword && values.password.length < 6) {
    showMessage(signupMessage, "Use a password with at least 6 characters.", true);
    signupPassword?.focus();
    return null;
  }

  return values;
}

function startSignupOtpCooldown(seconds = 45) {
  if (!signupSendOtp) return;
  window.clearInterval(signupOtpCooldownTimer);
  const readyAt = Date.now() + seconds * 1000;
  signupSendOtp.disabled = true;
  signupOtpCooldownTimer = window.setInterval(() => {
    const remaining = Math.ceil((readyAt - Date.now()) / 1000);
    if (remaining > 0) {
      signupSendOtp.textContent = `Resend in ${remaining}s`;
      return;
    }
    window.clearInterval(signupOtpCooldownTimer);
    signupSendOtp.disabled = false;
    signupSendOtp.textContent = "Resend OTP";
  }, 250);
}

async function sendSignupOtp() {
  const values = validateSignup({ requirePassword: true });
  syncSignupOtpPanel();
  if (!values) return false;
  if (signupOtpPanel) signupOtpPanel.hidden = false;

  if (signupSendOtp) signupSendOtp.disabled = true;
  setSignupOtpStatus("Sending OTP...");
  showMessage(signupMessage, "");

  try {
    const { response, data } = await postJson("/api/send-otp", {
      username: values.username,
      email: values.email
    });

    if (!response.ok || !data?.ok) {
      setSignupOtpStatus(data?.message || "Could not send OTP.", true);
      if (signupSendOtp) signupSendOtp.disabled = false;
      return false;
    }

    signupOtpToken = data.otpToken || "";
    signupOtpEmail = values.email;
    signupOtpExpiresAt = data.expiresAt || "";
    if (signupOtpLabel) signupOtpLabel.hidden = false;
    setSignupOtpStatus(data?.message || "OTP sent. Check your inbox and Spam/Junk.");
    showMessage(signupMessage, "Enter the OTP code, then finish sign up.");
    signupOtp?.focus();
    startSignupOtpCooldown();
    return true;
  } catch {
    setSignupOtpStatus("Could not reach the OTP service on this preview.", true);
    if (signupSendOtp) signupSendOtp.disabled = false;
    return false;
  }
}

async function verifySignupOtp(email) {
  const code = signupOtp?.value.trim() || "";
  if (!signupOtpToken || normalize(email) !== normalize(signupOtpEmail)) {
    await sendSignupOtp();
    return false;
  }
  if (!/^\d{6}$/.test(code)) {
    showMessage(signupMessage, "Enter the 6-digit OTP code.", true);
    signupOtp?.focus();
    return false;
  }

  showMessage(signupMessage, "Checking OTP...");
  try {
    const { response, data } = await postJson("/api/verify-otp", {
      email,
      code,
      otpToken: signupOtpToken
    });

    if (!response.ok || !data?.ok) {
      showMessage(signupMessage, data?.message || "The OTP could not be verified.", true);
      signupOtp?.focus();
      return false;
    }
    return true;
  } catch {
    showMessage(signupMessage, "Could not verify OTP on this preview.", true);
    return false;
  }
}

function openPaymentModal() {
  if (!paymentModal) return;
  paymentModal.hidden = false;
  document.body.classList.add("payment-modal-open");
  paymentModalClose?.focus();
}

function setContactStatus(message, tone = "neutral") {
  if (!contactUsStatus) return;
  contactUsStatus.textContent = message;
  contactUsStatus.classList.toggle("good", tone === "good");
  contactUsStatus.classList.toggle("error", tone === "error");
}

function contactDetails() {
  const currentUser = readJson(currentUserStorageKey, null);
  const remembered = readJson(rememberedSigninKey, null);
  const signInIdentity = signinIdentity?.value.trim() || remembered?.identity || "";
  const signUpUsername = signupUsername?.value.trim() || "";
  const signUpEmail = signupEmail?.value.trim() || "";
  const username = currentUser?.username || signUpUsername || (!isValidEmail(signInIdentity) ? signInIdentity : "");
  const email = currentUser?.email || signUpEmail || (isValidEmail(signInIdentity) ? signInIdentity : "");
  return { username, email };
}

function openContactUsModal() {
  if (!contactUsModal) return;
  const details = contactDetails();
  if (contactUserName) {
    contactUserName.value = details.username || contactUserName.value.trim();
    contactUserName.readOnly = true;
    contactUserName.setAttribute("aria-readonly", "true");
  }
  if (contactUserEmail) {
    contactUserEmail.value = details.email || contactUserEmail.value.trim();
    contactUserEmail.readOnly = true;
    contactUserEmail.setAttribute("aria-readonly", "true");
  }
  if (contactSubject && !contactSubject.value.trim()) contactSubject.value = "Rota & Salary Tracker support";
  contactUsModal.hidden = false;
  document.body.classList.add("contact-modal-open");
  setContactStatus("Your username and email are locked from your account details.");
  contactMessage?.focus();
}

function closeContactUsModal() {
  if (!contactUsModal) return;
  contactUsModal.hidden = true;
  document.body.classList.remove("contact-modal-open");
}

function sendContactMessage() {
  const username = contactUserName?.value.trim() || "";
  const email = contactUserEmail?.value.trim() || "";
  const subject = contactSubject?.value.trim() || "";
  const message = contactMessage?.value.trim() || "";

  if (!username || !email || !subject || !message) {
    setContactStatus("Fill in your name, email, subject, and message before sending.", "error");
    return;
  }

  if (!isValidEmail(email)) {
    setContactStatus("Enter a valid email address before sending.", "error");
    contactUserEmail?.focus();
    return;
  }

  const body = [
    `User name: ${username}`,
    `Email: ${email}`,
    `Page: ${window.location.href}`,
    "",
    "Message:",
    message
  ].join("\n");
  const mailto = `mailto:${supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  try {
    window.location.href = mailto;
    setContactStatus("Opening your email app so you can send the message.", "good");
  } catch {
    setContactStatus(`Could not open your email app. Please email ${supportEmail}.`, "error");
  }
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
    paymentModalStatus.textContent = `Opening Revolut for the ${plan} plan. After payment, email ${supportEmail} so your subscription can be activated.`;
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
    `Your plan has expired. Please pay for a plan, then email ${supportEmail} to renew your access.`,
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

function bindContactUs() {
  contactUsFab?.addEventListener("click", openContactUsModal);
  closeContactUsBtn?.addEventListener("click", closeContactUsModal);
  cancelContactUsBtn?.addEventListener("click", closeContactUsModal);
  sendContactMessageBtn?.addEventListener("click", sendContactMessage);
  contactUsModal?.addEventListener("click", (event) => {
    if (event.target === contactUsModal) closeContactUsModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && contactUsModal && !contactUsModal.hidden) closeContactUsModal();
  });
}

signupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = validateSignup({ requirePassword: true });
  if (!values) return;
  const otpVerified = await verifySignupOtp(values.email);
  if (!otpVerified) return;

  const now = new Date();
  const user = ensureUser({
    id: makeId(),
    username: values.username,
    email: values.email,
    passwordHash: await hashPassword(values.password),
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

  saveUsers([...values.users, user]);
  showMessage(signupMessage, "Account created. Opening sign in...");
  window.setTimeout(() => {
    window.location.href = "signin.html";
  }, 700);
});

signupSendOtp?.addEventListener("click", () => {
  void sendSignupOtp();
});

signupEmail?.addEventListener("input", () => {
  resetSignupOtpAndSyncPanel();
});

signupUsername?.addEventListener("input", () => {
  resetSignupOtpAndSyncPanel();
});

signupPassword?.addEventListener("input", () => {
  resetSignupOtpAndSyncPanel();
});

signupConfirmPassword?.addEventListener("input", () => {
  resetSignupOtpAndSyncPanel();
});

signinForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (signinOpenPayment) signinOpenPayment.hidden = true;
  const identity = signinIdentity.value.trim();
  const password = signinPassword.value;
  const user = findUser(identity);
  const passwordHash = await hashPassword(password);

  if (!user) {
    showMessage(signinMessage, "No account was found for that username or email. Check the details, sign up, or email rota.salary.tracker@gmail.com for help.", true);
    signinIdentity.focus();
    signinMessage?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    return;
  }

  if (user.passwordHash !== passwordHash) {
    showMessage(signinMessage, "The password is incorrect. Try again or email rota.salary.tracker@gmail.com for help.", true);
    signinPassword.focus();
    signinMessage?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    return;
  }

  if (user.isLocked) {
    localStorage.removeItem(currentUserStorageKey);
    showMessage(signinMessage, `This account is locked. Email ${supportEmail} for help.`, true);
    return;
  }

  if (daysLeftForUser(user) <= 0) {
    localStorage.removeItem(currentUserStorageKey);
    showMessage(signinMessage, `Your plan has expired. Please pay for a plan, then email ${supportEmail} to renew your access.`, true);
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
bindContactUs();
hydrateRememberedSignin();
showSigninAccessNotice();
syncSignupOtpPanel();
