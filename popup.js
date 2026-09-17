// popup.js — everything runs locally. No network requests are ever made.

const LOCAL_META_KEY = "vaultMeta";      // { saltB64 }
const LOCAL_DATA_KEY = "vaultData";      // { iv, data } (encrypted credential list)
const SESSION_KEY = "vaultSessionKey";   // { keyB64, expires } — chrome.storage.session
const STAY_UNLOCKED_MS = 15 * 60 * 1000;

let cryptoKey = null;       // CryptoKey, only ever held in memory
let credentials = [];       // decrypted in-memory list: {id, site, user, password, notes}
let editingId = null;

const $ = (id) => document.getElementById(id);

function showScreen(name) {
  ["setup", "unlock", "vault"].forEach((s) =>
    $(`screen-${s}`).classList.toggle("hidden", s !== name)
  );
  $("screen-form").classList.add("hidden");
  $("lockBtn").classList.toggle("hidden", name !== "vault");
}

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add("hidden"), 1600);
}

async function saveEncrypted() {
  const payload = await encryptJSON(cryptoKey, credentials);
  await chrome.storage.local.set({ [LOCAL_DATA_KEY]: payload });
}

// ---------- boot ----------
async function boot() {
  const local = await chrome.storage.local.get([LOCAL_META_KEY, LOCAL_DATA_KEY]);

  if (!local[LOCAL_META_KEY]) {
    showScreen("setup");
    return;
  }

  // Try a cached session key first, so re-opening the popup is instant.
  const session = await chrome.storage.session.get(SESSION_KEY);
  const cached = session[SESSION_KEY];
  if (cached && cached.expires > Date.now()) {
    try {
      cryptoKey = await importRawKey(cached.keyB64);
      credentials = await decryptJSON(cryptoKey, local[LOCAL_DATA_KEY]);
      renderVault();
      showScreen("vault");
      return;
    } catch (e) {
      // fall through to manual unlock if the cached key somehow fails
    }
  }

  showScreen("unlock");
}

// ---------- setup ----------
$("setupBtn").addEventListener("click", async () => {
  const p1 = $("setupPass").value;
  const p2 = $("setupPassConfirm").value;
  const err = $("setupError");
  err.classList.add("hidden");

  if (p1.length < 8) {
    err.textContent = "Use at least 8 characters.";
    err.classList.remove("hidden");
    return;
  }
  if (p1 !== p2) {
    err.textContent = "Passwords don't match.";
    err.classList.remove("hidden");
    return;
  }

  const salt = newSalt();
  cryptoKey = await deriveKey(p1, salt);
  credentials = [];
  await chrome.storage.local.set({
    [LOCAL_META_KEY]: { saltB64: toBase64(salt) },
  });
  await saveEncrypted();
  await cacheSessionKey();
  renderVault();
  showScreen("vault");
  showToast("Vault created");
});

// ---------- unlock ----------
$("unlockBtn").addEventListener("click", doUnlock);
$("unlockPass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doUnlock();
});

async function doUnlock() {
  const pass = $("unlockPass").value;
  const err = $("unlockError");
  err.classList.add("hidden");

  const local = await chrome.storage.local.get([LOCAL_META_KEY, LOCAL_DATA_KEY]);
  const salt = new Uint8Array(fromBase64(local[LOCAL_META_KEY].saltB64));

  try {
    const key = await deriveKey(pass, salt);
    const data = await decryptJSON(key, local[LOCAL_DATA_KEY]);
    cryptoKey = key;
    credentials = data;
    if ($("staySignedIn").checked) await cacheSessionKey();
    $("unlockPass").value = "";
    renderVault();
    showScreen("vault");
  } catch (e) {
    err.textContent = "Incorrect password.";
    err.classList.remove("hidden");
  }
}

async function cacheSessionKey() {
  const keyB64 = await exportRawKey(cryptoKey);
  await chrome.storage.session.set({
    [SESSION_KEY]: { keyB64, expires: Date.now() + STAY_UNLOCKED_MS },
  });
}

// ---------- lock ----------
$("lockBtn").addEventListener("click", async () => {
  await chrome.storage.session.remove(SESSION_KEY);
  cryptoKey = null;
  credentials = [];
  $("unlockPass").value = "";
  showScreen("unlock");
});

// ---------- vault list ----------
function renderVault() {
  const q = $("searchInput").value.trim().toLowerCase();
  const list = $("credList");
  list.innerHTML = "";

  const filtered = credentials
    .filter((c) => c.site.toLowerCase().includes(q) || c.user.toLowerCase().includes(q))
    .sort((a, b) => a.site.localeCompare(b.site));

  $("emptyState").classList.toggle("hidden", credentials.length !== 0);

  for (const c of filtered) {
    const li = document.createElement("li");
    li.className = "cred-item";

    const top = document.createElement("div");
    top.className = "cred-top";

    const left = document.createElement("div");
    left.innerHTML = `<div class="cred-site"></div><div class="cred-user"></div>`;
    left.querySelector(".cred-site").textContent = c.site;
    left.querySelector(".cred-user").textContent = c.user || "—";

    const actions = document.createElement("div");
    actions.className = "cred-actions";

    const copyUserBtn = document.createElement("button");
    copyUserBtn.textContent = "Copy user";
    copyUserBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(c.user || "");
      showToast("Username copied");
    });

    const copyPassBtn = document.createElement("button");
    copyPassBtn.textContent = "Copy pass";
    copyPassBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(c.password || "");
      showToast("Password copied");
    });

    actions.append(copyUserBtn, copyPassBtn);
    top.append(left, actions);
    li.appendChild(top);

    li.addEventListener("click", () => openForm(c));
    list.appendChild(li);
  }
}

$("searchInput").addEventListener("input", renderVault);

// ---------- add / edit form ----------
$("addBtn").addEventListener("click", () => openForm(null));
$("cancelFormBtn").addEventListener("click", () => {
  $("screen-form").classList.add("hidden");
  $("screen-vault").classList.remove("hidden");
});

function openForm(cred) {
  editingId = cred ? cred.id : null;
  $("formSite").value = cred ? cred.site : "";
  $("formUser").value = cred ? cred.user : "";
  $("formPassword").value = cred ? cred.password : "";
  $("formNotes").value = cred ? cred.notes || "" : "";
  $("formPassword").type = "password";
  $("togglePwVisibility").textContent = "show";
  $("deleteBtn").classList.toggle("hidden", !cred);
  $("generatorPanel").classList.add("hidden");

  $("screen-vault").classList.add("hidden");
  $("screen-form").classList.remove("hidden");
  $("formSite").focus();
}

$("togglePwVisibility").addEventListener("click", () => {
  const input = $("formPassword");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  $("togglePwVisibility").textContent = showing ? "show" : "hide";
});

// ---------- password generator ----------
// Ambiguous-looking characters (0/O, 1/l/I) are left out so a generated
// password is easy to compare or retype if you ever need to.
const GEN_CHARSETS = {
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  lower: "abcdefghijkmnpqrstuvwxyz",
  numbers: "23456789",
  symbols: "!@#$%^&*()-_=+[]{}",
};

function generatePassword({ length, upper, lower, numbers, symbols }) {
  const activeSets = [];
  if (upper) activeSets.push(GEN_CHARSETS.upper);
  if (lower) activeSets.push(GEN_CHARSETS.lower);
  if (numbers) activeSets.push(GEN_CHARSETS.numbers);
  if (symbols) activeSets.push(GEN_CHARSETS.symbols);

  if (activeSets.length === 0) return "";

  const pool = activeSets.join("");
  const randomVals = crypto.getRandomValues(new Uint32Array(length));

  // Build the password, then guarantee at least one char from every
  // selected set so short lengths / unlucky draws don't miss a category.
  let chars = Array.from(randomVals, (v) => pool[v % pool.length]);
  activeSets.forEach((set, i) => {
    if (i < chars.length) {
      const idx = crypto.getRandomValues(new Uint32Array(1))[0] % set.length;
      chars[i] = set[idx];
    }
  });
  // shuffle so the guaranteed chars aren't always in the first positions
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function currentGenOptions() {
  return {
    length: parseInt($("genLength").value, 10),
    upper: $("genUpper").checked,
    lower: $("genLower").checked,
    numbers: $("genNumbers").checked,
    symbols: $("genSymbols").checked,
  };
}

function refreshGenPreview() {
  const opts = currentGenOptions();
  const pw = generatePassword(opts);
  $("genPreview").textContent = pw || "Select at least one character type";
}

$("genLength").addEventListener("input", () => {
  $("genLengthValue").textContent = $("genLength").value;
  refreshGenPreview();
});
[$("genUpper"), $("genLower"), $("genNumbers"), $("genSymbols")].forEach((el) =>
  el.addEventListener("change", refreshGenPreview)
);
$("genRefreshBtn").addEventListener("click", refreshGenPreview);

$("toggleGenerator").addEventListener("click", () => {
  const panel = $("generatorPanel");
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  if (opening) refreshGenPreview();
});

$("genUseBtn").addEventListener("click", () => {
  const pw = $("genPreview").textContent;
  if (!pw || pw.startsWith("Select")) return;
  $("formPassword").value = pw;
  $("formPassword").type = "text";
  $("togglePwVisibility").textContent = "hide";
  $("generatorPanel").classList.add("hidden");
  showToast("Password generated");
});

$("saveBtn").addEventListener("click", async () => {
  const site = $("formSite").value.trim();
  if (!site) {
    $("formSite").focus();
    return;
  }
  const entry = {
    id: editingId || crypto.randomUUID(),
    site,
    user: $("formUser").value.trim(),
    password: $("formPassword").value,
    notes: $("formNotes").value.trim(),
  };

  if (editingId) {
    const idx = credentials.findIndex((c) => c.id === editingId);
    credentials[idx] = entry;
  } else {
    credentials.push(entry);
  }

  await saveEncrypted();
  renderVault();
  $("screen-form").classList.add("hidden");
  $("screen-vault").classList.remove("hidden");
  showToast("Saved");
});

$("deleteBtn").addEventListener("click", async () => {
  if (!editingId) return;
  credentials = credentials.filter((c) => c.id !== editingId);
  await saveEncrypted();
  renderVault();
  $("screen-form").classList.add("hidden");
  $("screen-vault").classList.remove("hidden");
  showToast("Deleted");
});

boot();
