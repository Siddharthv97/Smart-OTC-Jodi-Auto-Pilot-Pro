function switchTab(tabId) {
  ["tab1", "tab2", "tab3", "tab4"].forEach(id => {
    document.getElementById(id).classList.toggle("hidden", id !== tabId);
    document.getElementById("btn_" + id).classList.toggle("active", id === tabId);
  });
  if (tabId === "tab2") {
    runZoneRecoveryCalc();
    runNightShieldCalc();
    runSandboxBacktest();
  } else if (tabId === "tab3") {
    renderPassbookAndEquity();
    renderPanelChartTable();
  }
}

function onTargetMarketChange() {
  syncInputsFromActiveMarket();
  recalculateAll();
  renderPanelChartTable();
}

function renderPipelineUI() {
  document.getElementById("dispMainBazar").textContent = appState.feeders.mainBazar;
  document.getElementById("dispTimeBazar").textContent = appState.feeders.timeBazar;
  document.getElementById("dispKalyan").textContent = appState.feeders.kalyan;
  document.getElementById("dispRajdhani").textContent = appState.feeders.rajdhani;

  const dMap = appState.feederDates || {};
  document.getElementById("dateMainBazar").textContent = `📅 ${dMap.mainBazar || "06/11/2026 (Fri)"}`;
  document.getElementById("dateTimeBazar").textContent = `📅 ${dMap.timeBazar || "06/11/2026 (Fri)"}`;
  document.getElementById("dateKalyan").textContent = `📅 ${dMap.kalyan || "06/11/2026 (Fri)"}`;
  document.getElementById("dateRajdhani").textContent = `📅 ${dMap.rajdhani || "06/11/2026 (Fri)"}`;

  if (appState.updatedAt) document.getElementById("lastSyncStamp").textContent = appState.updatedAt;
}

function openEditPipelineModal() {
  document.getElementById("modMainBazar").value = appState.feeders.mainBazar;
  document.getElementById("modTimeBazar").value = appState.feeders.timeBazar;
  document.getElementById("modKalyan").value = appState.feeders.kalyan;
  document.getElementById("modRajdhani").value = appState.feeders.rajdhani;

  document.getElementById("modDateMainBazar").value = appState.feederDates?.mainBazar || "06/11/2026 (Fri)";
  document.getElementById("modDateTimeBazar").value = appState.feederDates?.timeBazar || "06/11/2026 (Fri)";
  document.getElementById("modDateKalyan").value = appState.feederDates?.kalyan || "06/11/2026 (Fri)";
  document.getElementById("modDateRajdhani").value = appState.feederDates?.rajdhani || "06/11/2026 (Fri)";

  document.getElementById("modWeekUpJodi").value = document.getElementById("inpWeekUpJodi").value || appState.weekUpJodi || "17";
  document.getElementById("editModal").classList.remove("hidden");
}

function closeEditPipelineModal() {
  document.getElementById("editModal").classList.add("hidden");
}

async function saveManualRealResults() {
  const todayLabel = formatIstDateWithDay(getIstNowDate());
  const mb = document.getElementById("modMainBazar").value.trim();
  const tb = document.getElementById("modTimeBazar").value.trim();
  const kl = document.getElementById("modKalyan").value.trim();
  const rj = document.getElementById("modRajdhani").value.trim();
  const wu = document.getElementById("modWeekUpJodi").value.trim();

  if (!appState.feederDates) appState.feederDates = {};
  if (mb) {
    appState.feederDates.mainBazar = (mb !== appState.feeders.mainBazar && document.getElementById("modDateMainBazar").value === appState.feederDates.mainBazar)
      ? todayLabel : (document.getElementById("modDateMainBazar").value.trim() || todayLabel);
    appState.feeders.mainBazar = mb;
  }
  if (tb) {
    appState.feederDates.timeBazar = (tb !== appState.feeders.timeBazar && document.getElementById("modDateTimeBazar").value === appState.feederDates.timeBazar)
      ? todayLabel : (document.getElementById("modDateTimeBazar").value.trim() || todayLabel);
    appState.feeders.timeBazar = tb;
  }
  if (kl) {
    appState.feederDates.kalyan = (kl !== appState.feeders.kalyan && document.getElementById("modDateKalyan").value === appState.feederDates.kalyan)
      ? todayLabel : (document.getElementById("modDateKalyan").value.trim() || todayLabel);
    appState.feeders.kalyan = kl;
  }
  if (rj) {
    appState.feederDates.rajdhani = (rj !== appState.feeders.rajdhani && document.getElementById("modDateRajdhani").value === appState.feederDates.rajdhani)
      ? todayLabel : (document.getElementById("modDateRajdhani").value.trim() || todayLabel);
    appState.feeders.rajdhani = rj;
  }
  if (wu) {
    appState.weekUpJodi = wu.padStart(2, "0");
    appState.manualWeekUpOverride = true;
  }

  appState.updatedAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  await saveStateLocalAndCloud();
  closeEditPipelineModal();
  renderPipelineUI();
  syncInputsFromActiveMarket();
  recalculateAll();
}

function renderPassbookAndEquity() {
  normalizeAppState();
  const list = appState.passbook;
  let running = 0;
  const points = [];
  const rows = list.map((item, idx) => {
    running += Number(item.amount) || 0;
    points.push({ val: running, label: item.date || `#${idx + 1}` });
    const isPos = Number(item.amount) >= 0;
    return `
      <div class="py-1.5 flex items-center justify-between gap-2">
        <div class="truncate">
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 mr-1">${item.date || 'Log'}</span>
          <span class="text-slate-200">${item.note}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="font-bold ${isPos ? 'text-emerald-400' : 'text-rose-400'}">${isPos ? '+' : ''}₹${item.amount} (₹${running})</span>
          ${idx > 0 ? `<button onclick="deletePassbookEntry(${idx})" class="text-slate-500 hover:text-rose-400 text-xs px-1" title="Delete Entry">&times;</button>` : ''}
        </div>
      </div>
    `;
  }).reverse().join("");

  document.getElementById("passbookTableContainer").innerHTML = rows;
  const startBal = Number(list[0]?.amount) || 500;
  const netGain = running - startBal;
  document.getElementById("passbookSummaryStats").innerHTML =
    `Balance: <span class="text-emerald-400">₹${running}</span> <span class="text-[11px] ${netGain >= 0 ? 'text-sky-300' : 'text-rose-400'}">(${netGain >= 0 ? '+' : ''}₹${netGain} Net)</span>`;
  calculateMoneyManagement();

  const svgBox = document.getElementById("svgEquityContainer");
  const vals = points.map(p => p.val);
  if (vals.length < 2) vals.unshift(startBal);
  const minV = Math.min(...vals, startBal - 100);
  const maxV = Math.max(...vals, startBal + 100);
  const range = Math.max(100, maxV - minV);
  const w = 560, h = 155, padX = 30, padY = 24;

  const xyCoords = vals.map((v, i) => {
    const x = Math.round(padX + (i / (vals.length - 1)) * (w - padX * 2));
    const y = Math.round(h - padY - ((v - minV) / range) * (h - padY * 2));
    return { x, y, v };
  });

  const polyPoints = xyCoords.map(pt => `${pt.x},${pt.y}`).join(" ");
  const areaPoints = `${xyCoords[0].x},${h - padY} ${polyPoints} ${xyCoords[xyCoords.length - 1].x},${h - padY}`;
  const baseLineY = Math.round(h - padY - ((startBal - minV) / range) * (h - padY * 2));
  const circlesHtml = xyCoords.map(pt => `
    <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#10b981" stroke="#0f172a" stroke-width="2" />
    <text x="${pt.x}" y="${Math.max(12, pt.y - 8)}" text-anchor="middle" fill="#cbd5e1" font-size="10" font-family="JetBrains Mono">₹${pt.v}</text>
  `).join("");

  svgBox.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" class="w-full h-full">
      <defs>
        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#10b981" stop-opacity="0.35" />
          <stop offset="100%" stop-color="#10b981" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      <line x1="${padX}" y1="${baseLineY}" x2="${w - padX}" y2="${baseLineY}" stroke="#475569" stroke-dasharray="4 4" stroke-width="1" />
      <polygon points="${areaPoints}" fill="url(#eqGrad)" />
      <polyline fill="none" stroke="#10b981" stroke-width="3" points="${polyPoints}" />
      ${circlesHtml}
    </svg>
  `;
}

function deletePassbookEntry(index) {
  normalizeAppState();
  if (index <= 0 || index >= appState.passbook.length) return;
  appState.passbook.splice(index, 1);
  saveStateLocalAndCloud();
  renderPassbookAndEquity();
}

function addPassbookEntry() {
  normalizeAppState();
  const note = document.getElementById("plNoteInput").value.trim() || "Session";
  const amt = parseFloat(document.getElementById("plAmountInput").value);
  if (isNaN(amt)) return;
  appState.passbook.push({ date: new Date().toLocaleDateString("en-IN"), note, amount: amt });
  document.getElementById("plNoteInput").value = "";
  document.getElementById("plAmountInput").value = "";
  saveStateLocalAndCloud();
  renderPassbookAndEquity();
}

function clearPassbookHistory() {
  appState.passbook = [{ date: "Initial", note: "Starting Wallet Balance", amount: 500 }];
  userManualPattiOverride = false;
  saveStateLocalAndCloud();
  renderPassbookAndEquity();
}

function renderPanelChartTable() {
  normalizeAppState();
  const target = document.getElementById("activeTargetSelect").value;
  const weeks = appState.charts[target] || [];
  const topDigits = new Set((latestCalculatedPrediction?.top4 || []).map(String));

  const pattiCounts = {};
  weeks.forEach(wk => wk.days.forEach(c => {
    if (c && c.open) pattiCounts[c.open] = (pattiCounts[c.open] || 0) + 1;
    if (c && c.close) pattiCounts[c.close] = (pattiCounts[c.close] || 0) + 1;
  }));

  document.getElementById("panelChartTableBody").innerHTML = weeks.map((wk, wIdx) => {
    const days = wk.days;
    const cellsHtml = [0, 1, 2, 3, 4, 5].map(dIdx => {
      const cell = days[dIdx];
      if (!cell || !cell.jodi) return `<td onclick="openCellModal(${wIdx}, ${dIdx})" class="p-2 cursor-pointer"><div class="chart-cell p-2 rounded-lg bg-slate-900/60 border border-slate-800 text-rose-400 font-bold text-[11px]">HOLIDAY</div></td>`;
      const o1 = Number(cell.jodi[0]), c1 = Number(cell.jodi[1]);
      const isRed = o1 === c1 || o1 === cutOf(c1);
      const isActiveFam = topDigits.has(String(o1)) || topDigits.has(String(c1));
      const isRepPatti = (pattiCounts[cell.open] > 1) || (pattiCounts[cell.close] > 1);

      let hlClass = "";
      if (currentHighlightMode === "red" && isRed) hlClass = "hl-red-jodi";
      else if (currentHighlightMode === "family" && isActiveFam) hlClass = "hl-active-fam";
      else if (currentHighlightMode === "patti" && isRepPatti) hlClass = "hl-repeat-patti";

      return `
        <td onclick="openCellModal(${wIdx}, ${dIdx})" class="p-1.5 cursor-pointer">
          <div class="chart-cell p-2 rounded-lg bg-slate-900 border border-slate-700 ${hlClass}">
            <div class="text-[10px] text-slate-400">${cell.open}</div>
            <div class="text-base font-extrabold ${isRed ? 'text-rose-400' : 'text-amber-300'}">${cell.jodi}</div>
            <div class="text-[10px] text-slate-400">${cell.close}</div>
          </div>
        </td>
      `;
    }).join("");
    return `<tr><td class="p-2.5 text-left font-bold text-sky-300">${wk.week}</td>${cellsHtml}<td class="p-2"><button onclick="deleteWeekRow(${wIdx})" class="text-slate-500 hover:text-rose-400">🗑️</button></td></tr>`;
  }).join("");
}

function toggleChartHighlight(mode) {
  currentHighlightMode = currentHighlightMode === mode ? null : mode;
  ["red", "family", "patti"].forEach(m => {
    document.getElementById("hlBtn_" + m).classList.toggle("ring-2", currentHighlightMode === m);
  });
  renderPanelChartTable();
}

function openCellModal(wIdx, dIdx) {
  normalizeAppState();
  const target = document.getElementById("activeTargetSelect").value;
  editingCellRef = { target, wIdx, dIdx };
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const wk = appState.charts[target][wIdx];
  const cell = wk.days[dIdx];
  document.getElementById("cellModalTitle").textContent = `Edit ${target.toUpperCase()} — ${wk.week} (${dayNames[dIdx]})`;
  document.getElementById("cellOpenInput").value = cell?.open || "";
  document.getElementById("cellJodiInput").value = cell?.jodi || "";
  document.getElementById("cellCloseInput").value = cell?.close || "";
  document.getElementById("cellEditModal").classList.remove("hidden");
}

function autoCalcCellModalJodi() {
  const op = document.getElementById("cellOpenInput").value.trim();
  const cl = document.getElementById("cellCloseInput").value.trim();
  if (/^[0-9]{3}$/.test(op) && /^[0-9]{3}$/.test(cl)) {
    const oAnk = (Number(op[0]) + Number(op[1]) + Number(op[2])) % 10;
    const cAnk = (Number(cl[0]) + Number(cl[1]) + Number(cl[2])) % 10;
    document.getElementById("cellJodiInput").value = `${oAnk}${cAnk}`;
  }
}

function closeCellModal() {
  document.getElementById("cellEditModal").classList.add("hidden");
}

function saveCellModalResult() {
  if (!editingCellRef) return;
  normalizeAppState();
  const op = document.getElementById("cellOpenInput").value.trim() || "***";
  let jd = document.getElementById("cellJodiInput").value.trim();
  const cl = document.getElementById("cellCloseInput").value.trim() || "***";

  if (!jd && /^[0-9]{3}$/.test(op) && /^[0-9]{3}$/.test(cl)) {
    const oAnk = (Number(op[0]) + Number(op[1]) + Number(op[2])) % 10;
    const cAnk = (Number(cl[0]) + Number(cl[1]) + Number(cl[2])) % 10;
    jd = `${oAnk}${cAnk}`;
  }
  if (!/^[0-9]{1,2}$/.test(jd)) {
    return alert("Please enter a valid 2-digit Jodi (or click Holiday).");
  }

  const { target, wIdx, dIdx } = editingCellRef;
  const wk = appState.charts[target][wIdx];
  const existing = wk.days[dIdx];
  const computedDate = existing?.date || computeCellDateFromWeek(wk.week, dIdx);

  wk.days[dIdx] = { open: op, jodi: jd.padStart(2, "0"), close: cl, date: computedDate };
  saveStateLocalAndCloud();
  closeCellModal();
  syncInputsFromActiveMarket();
  recalculateAll();
  renderPanelChartTable();
}

function markCellAsHoliday() {
  if (!editingCellRef) return;
  normalizeAppState();
  appState.charts[editingCellRef.target][editingCellRef.wIdx].days[editingCellRef.dIdx] = null;
  saveStateLocalAndCloud();
  closeCellModal();
  syncInputsFromActiveMarket();
  recalculateAll();
  renderPanelChartTable();
}

function addNewWeekRow() {
  normalizeAppState();
  const wkStr = prompt("Week Date (DD/MM/YYYY):", "16/11/2026");
  if (!wkStr) return;
  appState.charts[document.getElementById("activeTargetSelect").value].push({ week: wkStr.trim(), days: [null, null, null, null, null, null] });
  saveStateLocalAndCloud();
  renderPanelChartTable();
}

function deleteWeekRow(wIdx) {
  normalizeAppState();
  appState.charts[document.getElementById("activeTargetSelect").value].splice(wIdx, 1);
  saveStateLocalAndCloud();
  renderPanelChartTable();
}

function openBulkPasteModal() { document.getElementById("bulkPasteModal").classList.remove("hidden"); }
function closeBulkPasteModal() { document.getElementById("bulkPasteModal").classList.add("hidden"); }

// FIX #7: Extracts optional Monday dates (DD/MM/YYYY) & stamps per-cell dates on Bulk Paste
function importBulkChartText() {
  normalizeAppState();
  const raw = document.getElementById("bulkPasteTextarea").value.trim();
  if (!raw) return;

  const dateMatch = raw.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  let baseMondayStr = dateMatch ? `${dateMatch[1].padStart(2, "0")}/${dateMatch[2].padStart(2, "0")}/${dateMatch[3].length === 2 ? "20" + dateMatch[3] : dateMatch[3]}` : "02/11/2026";

  const cleanedRaw = raw.replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, " ");
  const tokens = [];
  const mRegex = /([0-9\*]{3})\s*-\s*([0-9\*]{1,2})\s*-\s*([0-9\*]{3})/g;
  let m;
  while ((m = mRegex.exec(cleanedRaw)) !== null) {
    if (m[1].includes("*") || m[2].includes("*")) tokens.push(null);
    else tokens.push({ open: m[1], jodi: m[2].padStart(2, "0"), close: m[3] });
  }
  if (!tokens.length) return alert("No valid tokens found.");

  const newWeeks = [];
  for (let i = 0; i < tokens.length; i += 6) {
    const wkIndex = newWeeks.length;
    const wkLabel = computeCellDateFromWeek(baseMondayStr, wkIndex * 7)?.split(" ")[0] || `Wk-${wkIndex + 1}`;
    const chunk = tokens.slice(i, i + 6).map((cell, dIdx) => {
      if (!cell) return null;
      return { ...cell, date: computeCellDateFromWeek(wkLabel, dIdx) };
    });
    while (chunk.length < 6) chunk.push(null);
    newWeeks.push({ week: wkLabel, days: chunk });
  }

  const target = document.getElementById("activeTargetSelect").value;
  appState.charts[target] = document.getElementById("bulkReplaceMode").checked ? newWeeks : [...appState.charts[target], ...newWeeks];
  saveStateLocalAndCloud();
  closeBulkPasteModal();
  syncInputsFromActiveMarket();
  recalculateAll();
  renderPanelChartTable();
}

function generateFormattedVipSlip() {
  const p = latestCalculatedPrediction || { market: "KALYAN", playDate: "PLAY FOR: WEDNESDAY, 11/11/2026", basedOn: "390-24-257 (06/11/2026)", top4: [2, 4, 7, 1], jodis: ["24", "42", "21", "41"], pattis: ["129", "345", "239", "149"] };
  const m = latestMoneySlip || { grandTotalUsed: 100, openTotal: 30, openVipEach: 10, jodiTotal: 20, jodiEach: 5, pattiTotal: 0, pattiEach: 0, playPatti: false, closeTotal: 50 };
  return [
    `⚡ *SMART OTC & JODI PRO VIP SLIP* ⚡`,
    `🎯 *Market:* ${p.market}`,
    `🗓️ *${p.playDate}*`,
    `📌 *Based On Last Result:* ${p.basedOn}`,
    `────────────────────`,
    `🔥 *Super VIP OTC:* ${p.top4[0]}, ${p.top4[1]}`,
    `⚡ *Support OTC:* ${p.top4[2]}, ${p.top4[3]}`,
    `💜 *Top 4 Sniper Jodis:* ${p.jodis.slice(0, 4).join(", ")}`,
    `💎 *2-Digit Relay Pattis:* ${p.pattis.slice(0, 4).join(", ")}`,
    `────────────────────`,
    `💰 *Money Plan (Budget ₹${m.grandTotalUsed}):*`,
    `• Open OTC Stake: ₹${m.openTotal} (VIP ₹${m.openVipEach} each)`,
    `• Strong Jodi Stake: ₹${m.jodiTotal} (₹${m.jodiEach} each)`,
    m.playPatti ? `• VIP Patti Stake: ₹${m.pattiTotal} (₹${m.pattiEach} each)` : `• VIP Patti: OFF (100% Focus on OTC/Jodi)`,
    `• Close Recovery Shield: ₹${m.closeTotal} (Use ONLY if Open misses)`
  ].join("\n");
}

function openShareSlipModal() {
  document.getElementById("shareSlipTextarea").value = generateFormattedVipSlip();
  document.getElementById("shareSlipModal").classList.remove("hidden");
}
function closeShareSlipModal() { document.getElementById("shareSlipModal").classList.add("hidden"); }
function copyShareSlip() { navigator.clipboard.writeText(document.getElementById("shareSlipTextarea").value); alert("Copied!"); }
function shareOnWhatsApp() { window.open(`https://wa.me/?text=${encodeURIComponent(generateFormattedVipSlip())}`, "_blank"); }

window.addEventListener("DOMContentLoaded", () => {
  checkLoginStatus();
  updateMarketCountdown();
  setInterval(updateMarketCountdown, 15000);
  setInterval(() => { pullFromFirebase(true); }, 60000);

  document.getElementById("tgBotToken").value = localStorage.getItem("otc_tg_token") || "";
  document.getElementById("tgChatId").value = localStorage.getItem("otc_tg_chat") || "";

  const saved = localStorage.getItem(LOCAL_KEY);
  if (saved) {
    try {
      const p = JSON.parse(saved);
      if (p && p.feeders) appState = { ...appState, ...p };
    } catch (e) {}
  }
  normalizeAppState();
  syncRateInputsUI();
  renderPipelineUI();
  syncInputsFromActiveMarket();
  recalculateAll();
  renderPassbookAndEquity();
  renderPanelChartTable();
  pullFromFirebase(false);
});
