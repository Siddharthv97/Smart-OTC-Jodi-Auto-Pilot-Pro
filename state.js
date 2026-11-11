const FIREBASE_BASE = "https://smart-otc-cloud-default-rtdb.firebaseio.com";
const MASTER_DB_PATH = "/otc_pro_v62_master.json";
const REAL_V61_PATH = "/otc_pro_v61_real.json";
const LOCAL_KEY = "otc_pro_modular_master_state";

const BANNED_FAKE_RESULTS = new Set([
  "246-22-570", "137-19-450", "358-64-266", "147-29-450", "278-24-257", "158-46-367", "346-38-459"
]);

const VERIFIED_KALYAN_NOV02_DAYS = [
  { open: "590", jodi: "40", close: "127", date: "02/11/2026 (Mon)" },
  { open: "789", jodi: "46", close: "150", date: "03/11/2026 (Tue)" },
  { open: "678", jodi: "17", close: "124", date: "04/11/2026 (Wed)" },
  { open: "278", jodi: "74", close: "789", date: "05/11/2026 (Thu)" },
  { open: "390", jodi: "24", close: "257", date: "06/11/2026 (Fri)" },
  null
];

let appState = {
  feeders: {
    mainBazar: "557-73-788",
    timeBazar: "139-31-579",
    kalyan: "390-24-257",
    rajdhani: "780-58-134"
  },
  feederDates: {
    mainBazar: "06/11/2026 (Fri)",
    timeBazar: "06/11/2026 (Fri)",
    kalyan: "06/11/2026 (Fri)",
    rajdhani: "06/11/2026 (Fri)"
  },
  liveStatus: {
    mainBazar: "HOLIDAY",
    timeBazar: "HOLIDAY",
    kalyan: "HOLIDAY",
    rajdhani: "HOLIDAY"
  },
  weekUpJodi: "17",
  manualWeekUpOverride: false,
  rates: { single: 95, jodi: 950, sp: 1400, dp: 2800 },
  charts: {
    kalyan: [
      { week: "02/11/2026", days: [...VERIFIED_KALYAN_NOV02_DAYS] },
      { week: "09/11/2026", days: [null, null, null, null, null, null] }
    ],
    rajdhani: [
      {
        week: "02/11/2026",
        days: [
          { open: "347", jodi: "40", close: "668", date: "02/11/2026 (Mon)" },
          { open: "124", jodi: "72", close: "156", date: "03/11/2026 (Tue)" },
          { open: "348", jodi: "54", close: "158", date: "04/11/2026 (Wed)" },
          { open: "248", jodi: "48", close: "260", date: "05/11/2026 (Thu)" },
          { open: "780", jodi: "58", close: "134", date: "06/11/2026 (Fri)" },
          null
        ]
      },
      { week: "09/11/2026", days: [null, null, null, null, null, null] }
    ]
  },
  passbook: [{ date: "Initial", note: "Starting Wallet Balance", amount: 500 }],
  updatedAt: "Verified Sync Ready"
};

let currentHighlightMode = null;
let editingCellRef = null;
let latestCalculatedPrediction = null;
let latestMoneySlip = null;
let lastAuditedPnlEntry = null;
let userManualPattiOverride = false;
let activeBaseResultDate = null;

const cutOf = d => (Number(d) + 5) % 10;

function normalizeDaysArray(rawDays) {
  const out = [null, null, null, null, null, null];
  if (!rawDays) return out;
  if (Array.isArray(rawDays)) {
    for (let i = 0; i < Math.min(6, rawDays.length); i++) {
      const c = rawDays[i];
      if (c && typeof c === "object" && c.jodi && String(c.jodi).length === 2 && !String(c.jodi).includes("*")) {
        out[i] = { open: String(c.open || "***"), jodi: String(c.jodi).padStart(2, "0"), close: String(c.close || "***"), date: c.date || null };
      }
    }
  } else if (typeof rawDays === "object") {
    Object.keys(rawDays).forEach(k => {
      const idx = parseInt(k, 10);
      const c = rawDays[k];
      if (!isNaN(idx) && idx >= 0 && idx < 6 && c && typeof c === "object" && c.jodi && !String(c.jodi).includes("*")) {
        out[idx] = { open: String(c.open || "***"), jodi: String(c.jodi).padStart(2, "0"), close: String(c.close || "***"), date: c.date || null };
      }
    });
  }
  return out;
}

function normalizeWeeksArray(rawWeeks) {
  if (!rawWeeks) return [];
  const list = Array.isArray(rawWeeks) ? rawWeeks : Object.values(rawWeeks);
  return list
    .filter(w => w && typeof w === "object" && w.week)
    .map(w => ({
      week: String(w.week),
      days: normalizeDaysArray(w.days)
    }));
}

// FIX #2: Auto-repairs the old 4-day Kalyan 02/11/2026 week and Thursday date if loaded from localStorage or Firebase
function normalizeAppState() {
  if (!appState.charts || typeof appState.charts !== "object") {
    appState.charts = { kalyan: [], rajdhani: [] };
  }
  appState.charts.kalyan = normalizeWeeksArray(appState.charts.kalyan);
  appState.charts.rajdhani = normalizeWeeksArray(appState.charts.rajdhani);

  let repairedStaleKalyan = false;
  appState.charts.kalyan.forEach(wk => {
    if (wk.week === "02/11/2026" && wk.days[0]?.open === "789" && wk.days[4] === null) {
      wk.days = [...VERIFIED_KALYAN_NOV02_DAYS];
      repairedStaleKalyan = true;
    }
  });

  if (appState.feeders?.kalyan === "390-24-257" && appState.feederDates?.kalyan === "05/11/2026 (Thu)") {
    appState.feederDates.kalyan = "06/11/2026 (Fri)";
    repairedStaleKalyan = true;
  }

  if (!appState.passbook) {
    appState.passbook = [{ date: "Initial", note: "Starting Wallet Balance", amount: 500 }];
  } else if (!Array.isArray(appState.passbook)) {
    appState.passbook = Object.values(appState.passbook);
  }
  if (appState.passbook.length === 0) {
    appState.passbook = [{ date: "Initial", note: "Starting Wallet Balance", amount: 500 }];
  }
  return repairedStaleKalyan;
}

function getIstNowDate() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 5.5 * 3600000);
}

function formatIstDateWithDay(dt) {
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${dd}/${mm}/${yyyy} (${days[dt.getDay()]})`;
}

function computeCellDateFromWeek(weekStr, dIdx) {
  if (!weekStr) return null;
  const m = String(weekStr).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  let d = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1, y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  const dt = new Date(y, mo, d + dIdx);
  return formatIstDateWithDay(dt);
}

function getTargetPlayDateInfo(targetKey) {
  const istNow = getIstNowDate();
  const fullDayNames = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const todayShort = formatIstDateWithDay(istNow).split(" ")[0];
  const lastResDateStr = (appState.feederDates && appState.feederDates[targetKey]) || "";
  const lastResVal = (appState.feeders && appState.feeders[targetKey]) || "";
  const statusFlag = (appState.liveStatus && appState.liveStatus[targetKey]) || "";

  let playDt = new Date(istNow.getTime());
  let sessionTag = statusFlag === "HOLIDAY" ? "CHECK LIVE HOLIDAY STATUS" : "TODAY'S LIVE SESSION";

  const isHalfOpen = lastResVal.includes("*") && !lastResVal.startsWith("***");
  const isTodayAlreadyComplete = lastResDateStr.includes(todayShort) && !lastResVal.includes("*");

  if (isHalfOpen && lastResDateStr.includes(todayShort)) {
    sessionTag = "TODAY'S CLOSE SESSION";
  } else if (playDt.getDay() === 0 || isTodayAlreadyComplete) {
    playDt.setDate(playDt.getDate() + 1);
    if (playDt.getDay() === 0) playDt.setDate(playDt.getDate() + 1);
    sessionTag = "NEXT TRADING SESSION";
  }

  const dd = String(playDt.getDate()).padStart(2, "0");
  const mm = String(playDt.getMonth() + 1).padStart(2, "0");
  const yyyy = playDt.getFullYear();
  const dayName = fullDayNames[playDt.getDay()];
  const targetCol = playDt.getDay() === 0 ? 0 : Math.min(5, playDt.getDay() - 1);

  return {
    bannerText: `PLAY FOR: ${dayName}, ${dd}/${mm}/${yyyy} (${sessionTag})`,
    targetCol,
    shortDay: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][targetCol]
  };
}

function sanitizeResultStr(val, fb) {
  if (!val || typeof val !== "string") return fb;
  const clean = val.trim();
  if (BANNED_FAKE_RESULTS.has(clean) || clean === "SET-REAL" || clean === "WAITING-LIVE") return fb;
  return clean;
}

function parseResultParts(resStr) {
  if (!resStr) return { open: "390", jodi: "24", close: "257", valid: false, isHalfTime: false };
  const m = resStr.match(/([0-9\*]{3})\s*-\s*([0-9\*]{1,2})(?:\s*-\s*([0-9\*]{3}))?/);
  if (!m) return { open: "390", jodi: "24", close: "257", valid: false, isHalfTime: false };
  const op = m[1] || "***";
  const jd = m[2] || "**";
  const cl = m[3] || "***";
  const isFullValid = !op.includes("*") && !jd.includes("*") && jd.length === 2;
  const isHalfTime = !op.includes("*") && op.length === 3 && (jd.includes("*") || jd.length === 1 || cl.includes("*"));
  return { open: op, jodi: jd, close: cl, valid: isFullValid, isHalfTime, openAnk: jd[0] };
}

function checkLoginStatus() {
  const unlocked = localStorage.getItem("otc_v62_unlocked") === "true" || sessionStorage.getItem("otc_v62_unlocked") === "true";
  document.getElementById("loginGateOverlay").classList.toggle("hidden", unlocked);
  if (!unlocked) {
    document.getElementById("loginUser").value = "";
    document.getElementById("loginPass").value = "";
  }
}

function handleOwnerLogin(e) {
  e.preventDefault();
  const u = document.getElementById("loginUser").value.trim().toLowerCase();
  const p = document.getElementById("loginPass").value.trim();
  if (u === "siddharth" && p === "1234") {
    sessionStorage.setItem("otc_v62_unlocked", "true");
    if (document.getElementById("loginRemember").checked) localStorage.setItem("otc_v62_unlocked", "true");
    document.getElementById("loginErrorMsg").classList.add("hidden");
    document.getElementById("loginGateOverlay").classList.add("hidden");
  } else {
    document.getElementById("loginErrorMsg").classList.remove("hidden");
  }
}

function lockTerminal() {
  localStorage.removeItem("otc_v62_unlocked");
  sessionStorage.removeItem("otc_v62_unlocked");
  document.getElementById("loginUser").value = "";
  document.getElementById("loginPass").value = "";
  document.getElementById("loginGateOverlay").classList.remove("hidden");
}

function updateMarketCountdown() {
  const badge = document.getElementById("liveMarketTimerBadge");
  if (!badge) return;
  const istNow = getIstNowDate();
  const day = istNow.getDay();
  const minsNow = istNow.getHours() * 60 + istNow.getMinutes();

  if (day === 0) { badge.textContent = "🏖️ SUNDAY MARKET HOLIDAY"; return; }
  const schedule = [
    { name: "Time Bazar Open", mins: 13 * 60 },
    { name: "Time Bazar Close", mins: 14 * 60 },
    { name: "Kalyan Open", mins: 16 * 60 + 15 },
    { name: "Kalyan Close", mins: 18 * 60 + 15 },
    { name: "Rajdhani Open", mins: 21 * 60 + 35 },
    { name: "Rajdhani Close", mins: 23 * 60 + 45 }
  ];
  const nextEv = schedule.find(s => s.mins > minsNow);
  if (!nextEv) { badge.textContent = "🌙 Night Complete • Next: Time Bazar 1:00 PM"; return; }
  const diff = nextEv.mins - minsNow;
  badge.textContent = `⏱️ ${nextEv.name} in ${Math.floor(diff / 60)}h ${diff % 60}m (IST)`;
}

async function saveStateLocalAndCloud(showAlert = false) {
  normalizeAppState();
  localStorage.setItem(LOCAL_KEY, JSON.stringify(appState));
  try {
    await Promise.all([
      fetch(`${FIREBASE_BASE}${MASTER_DB_PATH}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(appState) }),
      fetch(`${FIREBASE_BASE}${REAL_V61_PATH}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(appState) })
    ]);
    if (showAlert) alert("Synced to Firebase Cloud!");
  } catch (e) {}
}

// FIX #3: Full State Signature (feeders + feederDates + liveStatus + charts) & Auto-Repair Push
async function pullFromFirebase(silent = false) {
  try {
    const prevSignature = JSON.stringify({
      f: appState.feeders,
      d: appState.feederDates,
      s: appState.liveStatus,
      c: appState.charts
    });

    const [resLocal, resFb] = await Promise.allSettled([
      fetch(`./live_feed.json?t=${Date.now()}`),
      fetch(`${FIREBASE_BASE}${MASTER_DB_PATH}?t=${Date.now()}`)
    ]);
    let data = null;
    if (resLocal.status === "fulfilled" && resLocal.value.ok) data = await resLocal.value.json();
    if (resFb.status === "fulfilled" && resFb.value.ok) {
      const fb = await resFb.value.json();
      if (fb && fb.feeders) {
        data = {
          ...data,
          ...fb,
          feederDates: { ...(data?.feederDates || {}), ...(fb?.feederDates || {}) },
          liveStatus: { ...(data?.liveStatus || {}), ...(fb?.liveStatus || {}) }
        };
      }
    }

    let needsCloudRepair = false;
    if (data && data.feeders) {
      appState.feeders.mainBazar = sanitizeResultStr(data.feeders.mainBazar, appState.feeders.mainBazar || "557-73-788");
      appState.feeders.timeBazar = sanitizeResultStr(data.feeders.timeBazar, appState.feeders.timeBazar || "139-31-579");
      appState.feeders.kalyan = sanitizeResultStr(data.feeders.kalyan, appState.feeders.kalyan || "390-24-257");
      appState.feeders.rajdhani = sanitizeResultStr(data.feeders.rajdhani, appState.feeders.rajdhani || "780-58-134");
      if (data.feederDates) appState.feederDates = { ...appState.feederDates, ...data.feederDates };
      if (data.liveStatus) appState.liveStatus = { ...appState.liveStatus, ...data.liveStatus };
      if (data.updatedAt) appState.updatedAt = data.updatedAt;
      if (data.charts) {
        const normK = normalizeWeeksArray(data.charts.kalyan);
        const normR = normalizeWeeksArray(data.charts.rajdhani);
        if (normK.length) appState.charts.kalyan = normK;
        if (normR.length) appState.charts.rajdhani = normR;
      }
      if (data.passbook) appState.passbook = data.passbook;
      if (data.rates) appState.rates = { ...appState.rates, ...data.rates };

      needsCloudRepair = normalizeAppState();
      localStorage.setItem(LOCAL_KEY, JSON.stringify(appState));
      if (needsCloudRepair) {
        saveStateLocalAndCloud(false);
      }
    }

    const newSignature = JSON.stringify({
      f: appState.feeders,
      d: appState.feederDates,
      s: appState.liveStatus,
      c: appState.charts
    });

    renderPipelineUI();

    if (!silent || prevSignature !== newSignature) {
      syncRateInputsUI();
      syncInputsFromActiveMarket();
      recalculateAll();
      renderPanelChartTable();
      renderPassbookAndEquity();
    }
    if (!silent) {
      document.getElementById("syncStatusText").textContent = `Verified Sync Complete (${appState.updatedAt})`;
    }
  } catch (e) {}
}

function saveTelegramConfig() {
  localStorage.setItem("otc_tg_token", document.getElementById("tgBotToken").value.trim());
  localStorage.setItem("otc_tg_chat", document.getElementById("tgChatId").value.trim());
  document.getElementById("tgStatusMsg").textContent = "✅ Telegram settings saved!";
}

async function sendTelegramVipAlert() {
  const t = document.getElementById("tgBotToken").value.trim() || localStorage.getItem("otc_tg_token");
  const c = document.getElementById("tgChatId").value.trim() || localStorage.getItem("otc_tg_chat");
  if (!t || !c) { switchTab("tab4"); return alert("Enter Telegram Bot Token & Chat ID in Tab 4."); }
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: c, text: generateFormattedVipSlip(), parse_mode: "Markdown" })
  });
  alert("Sent to Telegram!");
}

function exportBackupJson() {
  normalizeAppState();
  const blob = new Blob([JSON.stringify(appState, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `smart_otc_modular_backup.json`;
  a.click();
}

function importBackupJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || !parsed.feeders) throw new Error("Invalid backup structure");
      appState = { ...appState, ...parsed };
      normalizeAppState();
      await saveStateLocalAndCloud();
      syncRateInputsUI();
      renderPipelineUI();
      syncInputsFromActiveMarket();
      recalculateAll();
      renderPassbookAndEquity();
      renderPanelChartTable();
      document.getElementById("backupStatusMsg").textContent = `✅ Backup restored successfully (${file.name})!`;
    } catch (err) {
      alert("Invalid JSON Backup file!");
    }
  };
  reader.readAsText(file);
}
