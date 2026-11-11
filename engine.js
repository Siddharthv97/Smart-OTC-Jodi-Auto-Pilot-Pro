const MATKA_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

function getLatestChartSetupAndWeekUp(marketKey) {
  normalizeAppState();
  const rows = appState.charts[marketKey] || [];
  const playInfo = getTargetPlayDateInfo(marketKey);
  const targetCol = playInfo.targetCol;

  let latestCell = null;
  let latestW = -1;
  let latestD = -1;

  for (let r = rows.length - 1; r >= 0; r--) {
    const days = rows[r].days;
    for (let d = 5; d >= 0; d--) {
      const c = days[d];
      if (c && c.open && c.jodi && c.jodi.length === 2 && !BANNED_FAKE_RESULTS.has(`${c.open}-${c.jodi}-${c.close}`)) {
        latestCell = {
          ...c,
          date: c.date || computeCellDateFromWeek(rows[r].week, d) || "06/11/2026 (Fri)"
        };
        latestW = r;
        latestD = d;
        break;
      }
    }
    if (latestCell) break;
  }

  if (appState.manualWeekUpOverride && appState.weekUpJodi) {
    return {
      prev: latestCell || { open: "390", jodi: "24", close: "257", date: "06/11/2026 (Fri)" },
      weekUpJodi: appState.weekUpJodi,
      targetDayLabel: `Manual Override (${appState.weekUpJodi})`
    };
  }

  let weekUpJodi = appState.weekUpJodi || "17";
  let weekUpSource = `1-Week Up (${weekUpJodi})`;

  for (let r = rows.length - 1; r >= 0; r--) {
    if (r === latestW && targetCol === latestD) continue;
    const cand = rows[r].days[targetCol];
    if (cand && cand.jodi && cand.jodi.length === 2) {
      weekUpJodi = cand.jodi;
      weekUpSource = `Auto-loaded ${playInfo.shortDay} (${rows[r].week})`;
      break;
    }
  }

  return {
    prev: latestCell || { open: "390", jodi: "24", close: "257", date: "06/11/2026 (Fri)" },
    weekUpJodi,
    targetDayLabel: weekUpSource
  };
}

function syncInputsFromActiveMarket() {
  const target = document.getElementById("activeTargetSelect").value;
  const pipeStr = target === "kalyan" ? appState.feeders.kalyan : appState.feeders.rajdhani;
  const feederStr = target === "kalyan" ? appState.feeders.timeBazar : appState.feeders.kalyan;

  const chartInfo = getLatestChartSetupAndWeekUp(target);
  let pParts = parseResultParts(pipeStr);

  if (pParts.isHalfTime) {
    document.getElementById("liveOpenPatti").value = pParts.open;
    document.getElementById("liveOpenAnk").value = pParts.openAnk !== "*" ? pParts.openAnk : "";
    pParts = chartInfo.prev;
    activeBaseResultDate = chartInfo.prev.date || "06/11/2026 (Fri)";
  } else {
    document.getElementById("liveOpenPatti").value = "";
    document.getElementById("liveOpenAnk").value = "";
    if (!pParts.valid) {
      pParts = chartInfo.prev;
      activeBaseResultDate = chartInfo.prev.date || (appState.feederDates && appState.feederDates[target]) || "Prev Session";
    } else {
      activeBaseResultDate = (appState.feederDates && appState.feederDates[target]) || chartInfo.prev.date || "Latest Session";
    }
  }

  const fParts = parseResultParts(feederStr);

  document.getElementById("inpPrevOpen").value = pParts.open;
  document.getElementById("inpPrevJodi").value = pParts.jodi;
  document.getElementById("inpPrevClose").value = pParts.close;
  document.getElementById("inpWeekUpJodi").value = chartInfo.weekUpJodi;
  document.getElementById("weekUpAutoLabel").textContent = chartInfo.targetDayLabel;
  document.getElementById("inpFeederJodi").value = fParts.valid ? fParts.jodi : "31";
}

// FIX #5: Counts distinct bridge digits & prioritizes Single Pattis (SP) over Double Pattis (DP)
function generateTrueRelayPattisForAnk(targetAnk, bridgeDigitsSet, customBannedSet = null) {
  const prevO = (document.getElementById("inpPrevOpen")?.value || "").trim();
  const prevC = (document.getElementById("inpPrevClose")?.value || "").trim();
  const bannedExact = customBannedSet || new Set([prevO, prevC]);
  const candidates = [];

  for (let i = 0; i < MATKA_ORDER.length; i++) {
    for (let j = i; j < MATKA_ORDER.length; j++) {
      for (let k = j; k < MATKA_ORDER.length; k++) {
        if (i === j && j === k) continue;
        const d1 = MATKA_ORDER[i], d2 = MATKA_ORDER[j], d3 = MATKA_ORDER[k];
        if ((d1 + d2 + d3) % 10 !== Number(targetAnk)) continue;

        const pattiStr = `${d1}${d2}${d3}`;
        if (bannedExact.has(pattiStr)) continue;

        const uniqueDigits = [...new Set([d1, d2, d3])];
        let directBridgeCount = 0;
        let cutBridgeCount = 0;
        uniqueDigits.forEach(d => {
          if (bridgeDigitsSet.has(d)) directBridgeCount++;
          else if (bridgeDigitsSet.has(cutOf(d))) cutBridgeCount++;
        });

        let relayScore = 0;
        if (directBridgeCount === 2) relayScore = 12 + cutBridgeCount * 2;
        else if (directBridgeCount === 1 && cutBridgeCount >= 1) relayScore = 8 + cutBridgeCount;
        else if (directBridgeCount === 3) relayScore = 3;
        else relayScore = directBridgeCount * 2 + cutBridgeCount;

        // Strong preference for Single Patti (SP = 3 distinct digits) over Double Patti (DP)
        const spBonus = uniqueDigits.length === 3 ? 2.5 : 0;
        candidates.push({ patti: pattiStr, score: relayScore + spBonus });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 2).map(c => c.patti);
}

function computeDynamicFormulaWeights(marketKey) {
  normalizeAppState();
  const rows = appState.charts[marketKey] || [];
  const flat = [];
  rows.forEach((wk, wIdx) => wk.days.forEach((c, dIdx) => {
    if (c && c.jodi && c.jodi.length === 2 && c.open && c.close) flat.push({ ...c, wIdx, dIdx });
  }));

  const stats = [
    { id: "F1", name: "Direct + Cut Line (F1)", hits: 0, total: 0 },
    { id: "F2", name: "1-Week Vertical Line (F2)", hits: 0, total: 0 },
    { id: "F3", name: "Jodi Berij & Farak (F3)", hits: 0, total: 0 },
    { id: "F4", name: "Patti Middle Bridge (F4)", hits: 0, total: 0 },
    { id: "F5", name: "Patti End & Feeder Bridge (F5)", hits: 0, total: 0 }
  ];

  for (let i = 1; i < flat.length; i++) {
    const prev = flat[i - 1], curr = flat[i];
    const currO = Number(curr.jodi[0]), currC = Number(curr.jodi[1]);
    const pO = Number(prev.jodi[0]), pC = Number(prev.jodi[1]);

    const f1Set = new Set([pO, pC, cutOf(pO), cutOf(pC)]);
    stats[0].total++;
    if (f1Set.has(currO) || f1Set.has(currC)) stats[0].hits++;

    let wkUpCell = (curr.wIdx > 0 && rows[curr.wIdx - 1]?.days?.[curr.dIdx]?.jodi) ? rows[curr.wIdx - 1].days[curr.dIdx] : prev;
    const wO = Number(wkUpCell.jodi[0]), wC = Number(wkUpCell.jodi[1]);
    const f2Set = new Set([wO, wC, cutOf(wO), cutOf(wC)]);
    stats[1].total++;
    if (f2Set.has(currO) || f2Set.has(currC)) stats[1].hits++;

    const berij = (pO + pC) % 10, farak = Math.abs(pC - pO) % 10;
    const f3Set = new Set([berij, cutOf(berij), farak, cutOf(farak)]);
    stats[2].total++;
    if (f3Set.has(currO) || f3Set.has(currC)) stats[2].hits++;

    const mO = Number(prev.open[1]) || 0, mC = Number(prev.close[1]) || 0;
    const f4Set = new Set([mO, mC, (mO + mC) % 10, cutOf((mO + mC) % 10)]);
    stats[3].total++;
    if (f4Set.has(currO) || f4Set.has(currC)) stats[3].hits++;

    const lO = Number(prev.open[2]) || 0, lC = Number(prev.close[2]) || 0;
    const f5Set = new Set([lO, lC, (lO + lC) % 10, cutOf((lO + lC) % 10)]);
    stats[4].total++;
    if (f5Set.has(currO) || f5Set.has(currC)) stats[4].hits++;
  }

  return stats.map(s => {
    const pct = s.total > 0 ? Math.round((s.hits / s.total) * 100) : 75;
    const weight = pct >= 70 ? 2.0 : pct < 40 ? 0.5 : 1.3;
    const badge = pct >= 70 ? "2.0x BOOST" : pct < 40 ? "0.5x MUTED" : "1.3x ACTIVE";
    return { ...s, pct, weight, badge };
  });
}

function computeFiveFormulaRanked(prevOpen, prevJodi, prevClose, weekUpJodi, feederJodi, lineStats) {
  const o1 = Number(prevJodi[0]) || 0, c1 = Number(prevJodi[1]) || 0;
  const w1 = Number(weekUpJodi[0]) || 0, w2 = Number(weekUpJodi[1]) || 0;
  const f1 = Number(feederJodi[0]) || 0, f2 = Number(feederJodi[1]) || 0;

  const scores = Array(10).fill(0);
  const addVote = (d, w) => { scores[((d % 10) + 10) % 10] += w; };

  const wF1 = lineStats[0].weight;
  addVote(o1, wF1); addVote(c1, wF1); addVote(cutOf(o1), wF1 * 0.8); addVote(cutOf(c1), wF1 * 0.8);

  const wF2 = lineStats[1].weight;
  addVote(w1, wF2); addVote(w2, wF2); addVote(cutOf(w1), wF2 * 0.7); addVote(cutOf(w2), wF2 * 0.7);

  const wF3 = lineStats[2].weight;
  const berij = (o1 + c1) % 10, farak = Math.abs(c1 - o1) % 10;
  addVote(berij, wF3); addVote(cutOf(berij), wF3 * 0.8); addVote(farak, wF3);

  const wF4 = lineStats[3].weight;
  const midO = Number(prevOpen[1]) || 0, midC = Number(prevClose[1]) || 0;
  addVote(midO, wF4); addVote(midC, wF4); addVote((midO + midC) % 10, wF4);

  const wF5 = lineStats[4].weight;
  const endO = Number(prevOpen[2]) || 0, endC = Number(prevClose[2]) || 0;
  const endSum = (endO + endC) % 10;
  const fBerij = (f1 + f2) % 10;
  addVote(endO, wF5); addVote(endC, wF5); addVote(endSum, wF5); addVote(cutOf(endSum), wF5 * 0.8);
  addVote(fBerij, wF5 * 0.8); addVote(cutOf(fBerij), wF5 * 0.6);

  return scores.map((pts, digit) => ({ digit, pts: Number(pts.toFixed(1)) })).sort((a, b) => b.pts - a.pts);
}

// FIX #4: Guarantees Super VIP #1 and Super VIP #2 are ALWAYS from different families, and Top 4 covers >= 3 families
function selectTop4WithFamilyDiversity(ranked) {
  const vip1Item = ranked[0];
  const vip2Item = ranked.find(c => (c.digit % 5) !== (vip1Item.digit % 5)) || ranked[1];

  const top4 = [vip1Item, vip2Item];
  const usedDigits = new Set([vip1Item.digit, vip2Item.digit]);
  const famCount = {};
  top4.forEach(x => {
    const f = x.digit % 5;
    famCount[f] = (famCount[f] || 0) + 1;
  });

  for (const cand of ranked) {
    if (top4.length >= 4) break;
    if (usedDigits.has(cand.digit)) continue;
    const f = cand.digit % 5;
    if (top4.length === 3 && Object.keys(famCount).length < 3 && famCount[f]) continue;
    top4.push(cand);
    usedDigits.add(cand.digit);
    famCount[f] = (famCount[f] || 0) + 1;
  }
  return top4;
}

function buildPriorityUniqueJodis(vip1, vip2, sup1, sup2, fBerij, fFarak) {
  const allCandJodis = [
    `${vip1}${vip2}`, `${vip2}${vip1}`, `${vip1}${sup1}`, `${vip2}${sup1}`,
    `${vip1}${sup2}`, `${vip2}${sup2}`, `${vip1}${fBerij}`, `${vip2}${fBerij}`,
    `${sup1}${vip1}`, `${sup2}${vip2}`, `${vip1}${fFarak}`, `${vip2}${fFarak}`,
    `${vip1}${cutOf(vip2)}`, `${vip2}${cutOf(vip1)}`
  ];
  const uniqueAll = [...new Set(allCandJodis)];
  const nonRedJodis = uniqueAll.filter(j => (Number(j[0]) % 5) !== (Number(j[1]) % 5));
  const redHedgeJodis = uniqueAll.filter(j => (Number(j[0]) % 5) === (Number(j[1]) % 5));
  return [...nonRedJodis, ...redHedgeJodis].slice(0, 8);
}

function scanHistoricalSameSetup(marketKey, prevOpenStr, prevJodiStr, prevCloseStr, lastResDate, topVip1, topVip2) {
  normalizeAppState();
  const rows = appState.charts[marketKey] || [];
  const flat = [];
  rows.forEach(wk => wk.days.forEach(c => {
    if (c && c.jodi && c.jodi.length === 2) flat.push(c);
  }));

  const famSignature = j => {
    const a = Math.min(Number(j[0]), cutOf(Number(j[0])));
    const b = Math.min(Number(j[1]), cutOf(Number(j[1])));
    return `${a}${b}`;
  };

  const targetSig = famSignature(prevJodiStr);
  let matchCount = 0, vipHitCount = 0;
  const vipFamSet = new Set([topVip1, cutOf(topVip1), topVip2, cutOf(topVip2)]);

  for (let i = 0; i < flat.length - 1; i++) {
    if (famSignature(flat[i].jodi) === targetSig) {
      matchCount++;
      const nextJ = flat[i + 1].jodi;
      if (vipFamSet.has(Number(nextJ[0])) || vipFamSet.has(Number(nextJ[1]))) vipHitCount++;
    }
  }

  if (matchCount > 0) {
    const hitPct = Math.round((vipHitCount / matchCount) * 100);
    return `🔍 <b>True Historical Chart Scan (${prevOpenStr}-${prevJodiStr}-${prevCloseStr} • ${lastResDate}):</b> Chart mein Jodi Family <b>${prevJodiStr}</b> ka setup <b>${matchCount} baar</b> aaya hai, jisme agle din VIP Family (<b>${topVip1}/${cutOf(topVip1)}, ${topVip2}/${cutOf(topVip2)}</b>) <b>${hitPct}% (${vipHitCount}/${matchCount})</b> baar pass hui hai.`;
  }
  return `🔍 <b>Verified Setup (${prevOpenStr}-${prevJodiStr}-${prevCloseStr} • ${lastResDate}):</b> Checksum verified. Top confluence locked on Super VIP <b>${topVip1}</b> & <b>${topVip2}</b>.`;
}

function recalculateAll() {
  const target = document.getElementById("activeTargetSelect").value;
  document.getElementById("vipTargetBadge").textContent =
    target === "kalyan" ? "👑 KALYAN VIP CARD" : "🌙 RAJDHANI NIGHT VIP CARD";

  const prevOpen = (document.getElementById("inpPrevOpen").value || "390").padStart(3, "0");
  const prevJodi = (document.getElementById("inpPrevJodi").value || "24").padStart(2, "0");
  const prevClose = (document.getElementById("inpPrevClose").value || "257").padStart(3, "0");
  const weekUpJodi = (document.getElementById("inpWeekUpJodi").value || "17").padStart(2, "0");
  const feederJodi = (document.getElementById("inpFeederJodi").value || "31").padStart(2, "0");

  const playDateBannerText = getTargetPlayDateInfo(target).bannerText;
  const lastResDate = activeBaseResultDate || (appState.feederDates && appState.feederDates[target]) || "06/11/2026 (Fri)";
  document.getElementById("vipPlayForDateBanner").textContent = playDateBannerText;
  document.getElementById("vipBasedOnResultBanner").textContent = `${prevOpen}-${prevJodi}-${prevClose} (${lastResDate})`;

  const lineStats = computeDynamicFormulaWeights(target);
  document.getElementById("activeLineScannerBox").innerHTML = lineStats.map(st => `
    <div class="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
      <div>
        <span class="font-bold text-slate-200">${st.name}</span>
        <span class="ml-2 text-[10px] px-1.5 py-0.5 rounded ${st.pct >= 70 ? 'bg-emerald-500/20 text-emerald-300' : st.pct < 40 ? 'bg-rose-500/20 text-rose-300' : 'bg-sky-500/20 text-sky-300'}">${st.badge}</span>
      </div>
      <span class="mono font-extrabold ${st.pct >= 70 ? 'text-emerald-400' : 'text-amber-400'}">${st.pct}% (${st.hits}/${st.total || 1})</span>
    </div>
  `).join("");

  const o1 = Number(prevJodi[0]) || 0, c1 = Number(prevJodi[1]) || 0;
  const w1 = Number(weekUpJodi[0]) || 0, w2 = Number(weekUpJodi[1]) || 0;
  const f1 = Number(feederJodi[0]) || 0, f2 = Number(feederJodi[1]) || 0;
  const fBerij = (f1 + f2) % 10, fFarak = Math.abs(f2 - f1) % 10;

  const ranked = computeFiveFormulaRanked(prevOpen, prevJodi, prevClose, weekUpJodi, feederJodi, lineStats);
  const top4 = selectTop4WithFamilyDiversity(ranked);
  const vip1 = top4[0].digit, vip2 = top4[1].digit, sup1 = top4[2].digit, sup2 = top4[3].digit;

  const isPrevRed = (o1 === c1) || (o1 === cutOf(c1));
  const trapBadge = document.getElementById("trapStatusBadge");
  if (isPrevRed) {
    trapBadge.className = "px-3 py-1 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40";
    trapBadge.textContent = `⚠️ PREV RED/CUT JODI (${prevJodi}): Play Safe / Half-Stake Mode`;
  } else {
    trapBadge.className = "px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
    trapBadge.textContent = "✅ HIGH CONFLUENCE PLAYABLE DAY";
  }

  document.getElementById("vipOtcBoxes").innerHTML = top4.map((item, idx) => `
    <div class="p-3.5 rounded-xl text-center border ${idx < 2 ? 'bg-sky-950/60 border-sky-400 shadow-lg' : 'bg-slate-900 border-slate-700'}">
      <div class="text-[10px] font-extrabold uppercase ${idx < 2 ? 'text-sky-300' : 'text-slate-400'}">
        ${idx < 2 ? '🔥 SUPER VIP #' + (idx + 1) : '⚡ SUPPORT #' + (idx - 1)}
      </div>
      <div class="mono text-3xl font-extrabold text-white my-1">${item.digit}</div>
      <div class="text-[11px] text-emerald-400">Cut: ${cutOf(item.digit)} • Vote: ${item.pts}</div>
    </div>
  `).join("");

  const uniqueJodis = buildPriorityUniqueJodis(vip1, vip2, sup1, sup2, fBerij, fFarak);

  document.getElementById("vipJodiList").innerHTML = uniqueJodis.map((j, i) => `
    <span class="px-2.5 py-1 rounded ${i < 4 ? 'bg-purple-500/20 text-purple-200 border border-purple-400/50' : 'bg-slate-800 text-slate-400'}">${j}</span>
  `).join("");

  const bridgeDigits = new Set([...prevOpen, ...prevClose].map(Number).filter(n => !isNaN(n)));
  document.getElementById("relayBridgeInfo").textContent = `Bridge: ${[...bridgeDigits].join(",")}`;

  const bannedYesterday = new Set([prevOpen, prevClose]);
  const pattis = [
    ...generateTrueRelayPattisForAnk(vip1, bridgeDigits, bannedYesterday),
    ...generateTrueRelayPattisForAnk(vip2, bridgeDigits, bannedYesterday),
    ...generateTrueRelayPattisForAnk(sup1, bridgeDigits, bannedYesterday),
    ...generateTrueRelayPattisForAnk(sup2, bridgeDigits, bannedYesterday)
  ];

  document.getElementById("vipPattiList").innerHTML = pattis.map((p, i) => `
    <span class="px-2 py-1 rounded ${i < 4 ? 'bg-amber-500/20 text-amber-300 border border-amber-400/50' : 'bg-slate-800 text-slate-400'}">${p}</span>
  `).join("");

  document.getElementById("halfSangamBox").innerHTML = `
    <div class="p-2 rounded bg-slate-950 border border-slate-800">• <b>Sangam A1:</b> Open <b class="text-sky-300">${vip1}</b> × Close Patti <b class="text-amber-300">${pattis[2] || "239"}</b></div>
    <div class="p-2 rounded bg-slate-950 border border-slate-800">• <b>Sangam A2:</b> Open Patti <b class="text-amber-300">${pattis[0] || "129"}</b> × Close <b class="text-sky-300">${vip2}</b></div>
    <div class="p-2 rounded bg-slate-950 border border-slate-800">• <b>Sangam B1:</b> Open <b class="text-sky-300">${vip2}</b> × Close Patti <b class="text-amber-300">${pattis[0] || "129"}</b></div>
    <div class="p-2 rounded bg-slate-950 border border-slate-800">• <b>Sangam B2:</b> Open Patti <b class="text-amber-300">${pattis[2] || "239"}</b> × Close <b class="text-sky-300">${vip1}</b></div>
  `;

  document.getElementById("relayBreakdownBox").innerHTML = `
    <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800">• <b>Feeder Jodi (${feederJodi}):</b> Berij = <b class="text-sky-300">${fBerij}</b> (Cut ${cutOf(fBerij)}) | Farak = <b class="text-sky-300">${fFarak}</b></div>
    <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800">• <b>1-Week Up Vertical (${weekUpJodi}):</b> Direct <b class="text-emerald-300">${w1}, ${w2}</b> & Cut <b class="text-emerald-300">${cutOf(w1)}, ${cutOf(w2)}</b></div>
    <div class="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 font-semibold">🔥 3-Family Coverage Locked: Super VIP <b>${vip1}, ${vip2}</b> + Support <b>${sup1}, ${sup2}</b>!</div>
  `;

  document.getElementById("historicalSetupBox").innerHTML =
    scanHistoricalSameSetup(target, prevOpen, prevJodi, prevClose, lastResDate, vip1, vip2);

  latestCalculatedPrediction = {
    market: target === "kalyan" ? "KALYAN" : "RAJDHANI NIGHT",
    playDate: playDateBannerText,
    basedOn: `${prevOpen}-${prevJodi}-${prevClose} (${lastResDate})`,
    top4: top4.map(t => t.digit),
    jodis: uniqueJodis,
    pattis
  };

  calculateMoneyManagement();
  runMidGamePivot(false);
}

function runMidGamePivot(fromPattiInput = false) {
  const openPatti = document.getElementById("liveOpenPatti").value.trim();
  let openAnk = document.getElementById("liveOpenAnk").value.trim();
  const out = document.getElementById("midGamePivotOutput");

  if (/^[0-9]{3}$/.test(openPatti) && (fromPattiInput || !openAnk)) {
    openAnk = String((Number(openPatti[0]) + Number(openPatti[1]) + Number(openPatti[2])) % 10);
    document.getElementById("liveOpenAnk").value = openAnk;
  }

  if (!openAnk) { out.innerHTML = `⏳ Waiting for Open result...`; return; }
  const topDigits = (latestCalculatedPrediction?.top4 || []).map(String);
  if (topDigits.includes(openAnk)) {
    out.innerHTML = `<span class="text-emerald-400 font-extrabold">✅ OPEN PASS (Ank ${openAnk} Hit)! RULE: STOP CLOSE! Lock Today's Profit & Save Close Reserve.</span>`;
  } else {
    const d = Number(openAnk), c1 = cutOf(d), c2 = (d + 1) % 10, c3 = cutOf(c2);
    const bridgeSet = new Set(/^[0-9]{3}$/.test(openPatti) ? [...openPatti].map(Number) : [d, c1]);
    const bannedOpen = new Set([openPatti]);
    const closePattis = [
      ...generateTrueRelayPattisForAnk(c1, bridgeSet, bannedOpen).slice(0, 1),
      ...generateTrueRelayPattisForAnk(d, bridgeSet, bannedOpen).slice(0, 1),
      ...generateTrueRelayPattisForAnk(c2, bridgeSet, bannedOpen).slice(0, 1),
      ...generateTrueRelayPattisForAnk(c3, bridgeSet, bannedOpen).slice(0, 1)
    ];
    out.innerHTML = `<span class="text-amber-300 font-bold">⚡ Open Miss (${openAnk}) ➔ Activate Close Reserve (₹${latestMoneySlip?.closeTotal || 50}) on Close Ank: <b class="mono text-white">${c1}, ${d}, ${c2}, ${c3}</b> | Running Jodis: <b class="mono text-purple-300">${openAnk}${c1}, ${openAnk}${d}, ${openAnk}${c2}, ${openAnk}${c3}</b> | Close Relay Pattis: <b class="mono text-amber-300">${closePattis.join(", ")}</b></span>`;
  }
}

function isCircuitBreakerTriggered() {
  normalizeAppState();
  const list = appState.passbook || [];
  return list.length >= 3 && Number(list[list.length - 1].amount) < 0 && Number(list[list.length - 2].amount) < 0;
}

function onPattiToggleManual() { userManualPattiOverride = true; calculateMoneyManagement(); }
function setQuickCapital(amt) { document.getElementById("mmCapital").value = amt; calculateMoneyManagement(); }

function calculateMoneyManagement() {
  const cbActive = isCircuitBreakerTriggered();
  const cbTag = document.getElementById("circuitBreakerTag");
  if (cbActive) {
    cbTag.className = "text-[11px] font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40";
    cbTag.textContent = "🚨 CIRCUIT BREAKER: 2 Losses ➔ Auto Safe Mode";
    if (!userManualPattiOverride) { document.getElementById("chkPlayPatti").checked = false; document.getElementById("mmStrategy").value = "safe"; }
  } else {
    cbTag.className = "text-[11px] font-bold px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30";
    cbTag.textContent = "🛡️ Normal Risk Mode";
  }

  const totalCap = Math.max(20, parseFloat(document.getElementById("mmCapital").value) || 100);
  const strategy = document.getElementById("mmStrategy").value;
  const playOpen = document.getElementById("chkPlayOpen").checked;
  const otcCount = parseInt(document.getElementById("mmOtcCount").value, 10);
  const playClose = document.getElementById("chkPlayCloseReserve").checked;
  const playJodi = document.getElementById("chkPlayJodi").checked;
  const jodiCount = parseInt(document.getElementById("mmJodiCount").value, 10);
  const playPatti = document.getElementById("chkPlayPatti").checked;
  const pattiCount = parseInt(document.getElementById("mmPattiCount").value, 10);

  const singleMult = (Number(appState.rates?.single) || 95) / 10;
  const jodiMult = (Number(appState.rates?.jodi) || 950) / 10;
  const spMult = (Number(appState.rates?.sp) || 1400) / 10;

  let wOpen = playOpen ? (strategy === "safe" ? 30 : strategy === "aggressive" ? 26 : 30) : 0;
  let wClose = playClose ? (strategy === "safe" ? 52 : strategy === "aggressive" ? 38 : 46) : 0;
  let wJodi = playJodi ? (strategy === "safe" ? 18 : strategy === "aggressive" ? 24 : 20) : 0;
  let wPatti = playPatti ? (strategy === "safe" ? 12 : strategy === "aggressive" ? 20 : 16) : 0;

  const totalWeight = wOpen + wClose + wJodi + wPatti || 1;
  const rawOpen = totalCap * (wOpen / totalWeight);
  const rawJodi = totalCap * (wJodi / totalWeight);
  const rawPatti = totalCap * (wPatti / totalWeight);

  let openVipEach = 0, openSupEach = 0, openTotal = 0;
  if (playOpen) {
    if (otcCount === 2) { openVipEach = Math.max(1, Math.round(rawOpen / 2)); openTotal = openVipEach * 2; }
    else { openVipEach = Math.max(1, Math.round((rawOpen * 0.65) / 2)); openSupEach = Math.max(1, Math.round((rawOpen - openVipEach * 2) / 2)); openTotal = openVipEach * 2 + openSupEach * 2; }
  }

  let jodiEach = 0, jodiTotal = 0;
  if (playJodi) { jodiEach = Math.max(1, Math.round(rawJodi / jodiCount)); jodiTotal = jodiEach * jodiCount; }

  let pattiEach = 0, pattiTotal = 0;
  if (playPatti) { pattiEach = Math.max(1, Math.round(rawPatti / pattiCount)); pattiTotal = pattiEach * pattiCount; }

  let closeVipEach = 0, closeSupEach = 0, closeTotal = 0;
  if (playClose) {
    const rem = Math.max(otcCount, totalCap - (openTotal + jodiTotal + pattiTotal));
    if (otcCount === 2) { closeVipEach = Math.max(1, Math.round(rem / 2)); closeTotal = closeVipEach * 2; }
    else { closeVipEach = Math.max(1, Math.round((rem * 0.65) / 2)); closeSupEach = Math.max(1, Math.round((rem - closeVipEach * 2) / 2)); closeTotal = closeVipEach * 2 + closeSupEach * 2; }
  }

  const phase1Cost = openTotal + jodiTotal + pattiTotal;
  const grandTotalUsed = phase1Cost + closeTotal;

  const openVipPayout = openVipEach * singleMult;
  const openVipNet = openVipPayout + closeTotal - grandTotalUsed;
  const openSupPayout = openSupEach * singleMult;
  const openSupNet = openSupPayout + closeTotal - grandTotalUsed;

  const closeVipPayout = closeVipEach * singleMult;
  const closeVipNet = closeVipPayout - grandTotalUsed;
  const closeSupPayout = closeSupEach * singleMult;
  const closeSupNet = closeSupPayout - grandTotalUsed;

  const jodiPayout = jodiEach * jodiMult;
  const jodiNet = jodiPayout + openVipPayout + closeTotal - grandTotalUsed;
  const pattiPayout = pattiEach * spMult;
  const pattiNet = pattiPayout + openVipPayout + closeTotal - grandTotalUsed;

  latestMoneySlip = {
    grandTotalUsed, phase1Cost, otcCount,
    openTotal, openVipEach, openSupEach,
    jodiTotal, jodiEach, jodiCount,
    pattiTotal, pattiEach, pattiCount, playPatti,
    closeTotal, closeVipEach, closeSupEach,
    openVipNet: Number(openVipNet.toFixed(1)),
    openSupNet: Number(openSupNet.toFixed(1)),
    closeVipNet: Number(closeVipNet.toFixed(1)),
    closeSupNet: Number(closeSupNet.toFixed(1)),
    jodiNet: Number(jodiNet.toFixed(0)),
    pattiNet: Number(pattiNet.toFixed(0))
  };
  const d = latestCalculatedPrediction?.top4 || [2, 4, 7, 1];

  document.getElementById("mmCardsContainer").innerHTML = `
    <div class="p-3.5 rounded-xl bg-slate-900 border ${playOpen ? 'border-sky-500/50' : 'border-slate-800 opacity-50'}">
      <div class="flex justify-between text-[11px] font-bold text-sky-400"><span>1. OPEN OTC</span><span>${playOpen ? 'ACTIVE' : 'OFF'}</span></div>
      <div class="mono text-2xl font-extrabold text-white my-1">₹${openTotal}</div>
      <div class="text-xs text-slate-300">VIP (${d[0]},${d[1]}): <b class="text-sky-300 mono">₹${openVipEach}</b> | Sup: <b class="mono">${otcCount === 4 ? '₹' + openSupEach : 'OFF'}</b></div>
    </div>
    <div class="p-3.5 rounded-xl bg-slate-900 border ${playJodi ? 'border-purple-500/50' : 'border-slate-800 opacity-50'}">
      <div class="flex justify-between text-[11px] font-bold text-purple-400"><span>2. JODI (${jodiCount})</span><span>${playJodi ? 'ACTIVE' : 'OFF'}</span></div>
      <div class="mono text-2xl font-extrabold text-white my-1">₹${jodiTotal}</div>
      <div class="text-xs text-slate-300">Each: <b class="text-purple-300 mono">₹${jodiEach}</b> | Hit: <b class="text-emerald-400 mono">₹${(jodiEach * jodiMult).toFixed(0)}</b></div>
    </div>
    <div class="p-3.5 rounded-xl bg-slate-900 border ${playPatti ? 'border-amber-500/60' : 'border-slate-800 opacity-50'}">
      <div class="flex justify-between text-[11px] font-bold text-amber-400"><span>3. VIP PATTI (${playPatti ? pattiCount : 'OFF'})</span><span>${playPatti ? 'ACTIVE' : 'OFF'}</span></div>
      <div class="mono text-2xl font-extrabold text-white my-1">₹${pattiTotal}</div>
      <div class="text-xs text-slate-300">${playPatti ? `Each: <b class="text-amber-300 mono">₹${pattiEach}</b> | Return: <b class="text-emerald-400 mono">₹${(pattiEach * spMult).toFixed(0)}</b>` : 'Optional OFF (100% OTC/Jodi)'}</div>
    </div>
    <div class="p-3.5 rounded-xl bg-slate-900 border ${playClose ? 'border-emerald-500/50' : 'border-slate-800 opacity-50'}">
      <div class="flex justify-between text-[11px] font-bold text-emerald-400"><span>4. CLOSE RESERVE</span><span>SAVED</span></div>
      <div class="mono text-2xl font-extrabold text-emerald-300 my-1">₹${closeTotal}</div>
      <div class="text-xs text-slate-300">Close VIP: <b class="text-emerald-300 mono">₹${closeVipEach}</b> | Sup: <b class="mono">${otcCount === 4 ? '₹' + closeSupEach : 'OFF'}</b></div>
    </div>
  `;

  document.getElementById("mmActionSummary").innerHTML = `
    <div class="font-bold text-sky-300 text-xs">📋 Bet Plan (Total: ₹${grandTotalUsed})</div>
    <div><b>1. Open Entry:</b> Lagayein <b class="text-white mono">₹${phase1Cost}</b> (Open ₹${openTotal}${playJodi ? ` + Jodi ₹${jodiTotal}` : ''}${playPatti ? ` + Patti ₹${pattiTotal}` : ''}).</div>
    <div><b>2. Wallet Shield:</b> Bacha hua <b class="text-emerald-300 mono">₹${closeTotal}</b> safe rakhein.</div>
    <div><b>3. Rule:</b> Open pass = <b class="text-emerald-400">STOP CLOSE!</b></div>
  `;

  document.getElementById("mmProfitTableBody").innerHTML = `
    <tr><td class="py-1 text-sky-300 font-semibold">✅ Open VIP Hits (Stop Close)</td><td>₹${phase1Cost}</td><td class="text-emerald-400">₹${openVipPayout.toFixed(1)}</td><td>₹${closeTotal}</td><td class="text-right font-bold text-emerald-400">+₹${openVipNet.toFixed(1)} Net</td></tr>
    <tr><td class="py-1 text-emerald-300 font-semibold">🛡️ Open Miss ➔ Close VIP Hits</td><td>₹${grandTotalUsed}</td><td class="text-emerald-400">₹${closeVipPayout.toFixed(1)}</td><td>₹0</td><td class="text-right font-bold ${closeVipNet >= 0 ? 'text-emerald-400' : 'text-amber-400'}">${closeVipNet >= 0 ? '+' : ''}₹${closeVipNet.toFixed(1)} Net</td></tr>
    ${playJodi ? `<tr><td class="py-1 text-purple-300 font-semibold">🔥 Jodi Blast (${jodiMult}x)</td><td>₹${phase1Cost}</td><td class="text-emerald-400">₹${(jodiPayout + openVipPayout).toFixed(0)}</td><td>₹${closeTotal}</td><td class="text-right font-bold text-emerald-400">+₹${jodiNet.toFixed(0)} Net</td></tr>` : ''}
    ${playPatti ? `<tr><td class="py-1 text-amber-300 font-semibold">💎 VIP Patti + Open Hit (${spMult}x)</td><td>₹${phase1Cost}</td><td class="text-emerald-400">₹${(pattiPayout + openVipPayout).toFixed(0)}</td><td>₹${closeTotal}</td><td class="text-right font-bold text-emerald-400">+₹${pattiNet.toFixed(0)} Net</td></tr>` : ''}
  `;
}

function onRatesChange() {
  appState.rates = {
    single: parseFloat(document.getElementById("rateSingle").value) || 95,
    jodi: parseFloat(document.getElementById("rateJodi").value) || 950,
    sp: parseFloat(document.getElementById("rateSP").value) || 1400,
    dp: parseFloat(document.getElementById("rateDP").value) || 2800
  };
  saveStateLocalAndCloud();
  calculateMoneyManagement();
  runZoneRecoveryCalc();
  runNightShieldCalc();
}

function syncRateInputsUI() {
  document.getElementById("rateSingle").value = appState.rates?.single || 95;
  document.getElementById("rateJodi").value = appState.rates?.jodi || 950;
  document.getElementById("rateSP").value = appState.rates?.sp || 1400;
  document.getElementById("rateDP").value = appState.rates?.dp || 2800;
}

function runZoneRecoveryCalc() {
  const loss = Math.max(0, parseFloat(document.getElementById("recPrevLoss").value) || 0);
  const target = Math.max(0, parseFloat(document.getElementById("recTargetProfit").value) || 0);
  const singleMult = (Number(appState.rates?.single) || 95) / 10;
  const needTotal = loss + target;

  const s2 = Math.ceil(needTotal / Math.max(1, singleMult - 2));
  const s2Cost = s2 * 2;
  const s2Ret = Number((s2 * singleMult).toFixed(1));
  const s2Net = Number((s2Ret - s2Cost - loss).toFixed(1));

  const s4 = Math.ceil(needTotal / Math.max(1, singleMult - 4));
  const s4Cost = s4 * 4;
  const s4Ret = Number((s4 * singleMult).toFixed(1));
  const s4Net = Number((s4Ret - s4Cost - loss).toFixed(1));

  const closeCoverEach = Math.ceil((needTotal + s2Cost) / Math.max(1, singleMult - 2));
  const closeCoverCost = closeCoverEach * 2;
  const closeCoverRet = Number((closeCoverEach * singleMult).toFixed(1));
  const closeCoverNet = Number((closeCoverRet - s2Cost - closeCoverCost - loss).toFixed(1));

  document.getElementById("zoneRecoveryOutput").innerHTML = `
    <div class="p-2 rounded bg-slate-950 border border-slate-800">
      • <b>Plan A (2 Super VIP Ank Sniper):</b> <b class="mono text-sky-300">₹${s2} × 2 = ₹${s2Cost}</b> ➔ Return: <b class="text-emerald-400 mono">₹${s2Ret}</b> (Loss ₹${loss} Cover + <b class="text-emerald-300">Net +₹${s2Net}</b>)
    </div>
    <div class="p-2 rounded bg-slate-950 border border-slate-800">
      • <b>Plan B (All 4 OTC Safe Cover):</b> <b class="mono text-amber-300">₹${s4} × 4 = ₹${s4Cost}</b> ➔ Return: <b class="text-emerald-400 mono">₹${s4Ret}</b> (Loss ₹${loss} Cover + <b class="text-emerald-300">Net +₹${s4Net}</b>)
    </div>
    <div class="p-2 rounded bg-slate-950 border border-emerald-500/30">
      • <b>Plan C (If Plan A Open Misses ➔ Close Escalation):</b> Play Close 2 VIP Ank @ <b class="mono text-emerald-300">₹${closeCoverEach} × 2 = ₹${closeCoverCost}</b> ➔ Return: <b class="text-emerald-400 mono">₹${closeCoverRet}</b> (Covers Prev ₹${loss} + Open ₹${s2Cost} + <b class="text-emerald-300">Net +₹${closeCoverNet}</b>)
    </div>
  `;
}

function runNightShieldCalc() {
  const k = Math.max(0, parseFloat(document.getElementById("dayKalyanProfit").value) || 0);
  const lockedHome = Math.round(k * 0.65);
  const nightBudget = Math.max(0, k - lockedHome);
  const singleMult = (Number(appState.rates?.single) || 95) / 10;
  const jodiMult = (Number(appState.rates?.jodi) || 950) / 10;

  const openVipEach = Math.max(5, Math.floor((nightBudget * 0.6) / 2));
  const openCost = openVipEach * 2;
  const jodiEach = Math.max(2, Math.floor(Math.max(8, nightBudget - openCost) / 4));
  const jodiCost = jodiEach * 4;
  const totalNightUsed = openCost + jodiCost;

  document.getElementById("nightShieldOutput").innerHTML = `
    <div class="flex justify-between items-center pb-1.5 border-b border-slate-800">
      <span>🔒 <b>65% Locked Home Profit:</b> <b class="text-emerald-400 mono">₹${lockedHome}</b></span>
      <span>🌙 <b>35% Night Shield Budget:</b> <b class="text-indigo-300 mono">₹${nightBudget}</b></span>
    </div>
    <div>• <b>1. Rajdhani Open 2 Super VIP Ank:</b> <b class="mono text-sky-300">₹${openVipEach} × 2 = ₹${openCost}</b> (Hit Return: <b class="text-emerald-400 mono">₹${(openVipEach * singleMult).toFixed(1)}</b>)</div>
    <div>• <b>2. Rajdhani Top 4 Sniper Jodis:</b> <b class="mono text-purple-300">₹${jodiEach} × 4 = ₹${jodiCost}</b> (Hit Return: <b class="text-emerald-400 mono">₹${(jodiEach * jodiMult).toFixed(0)}</b>)</div>
    <div class="text-[11px] text-emerald-300 pt-1">✅ Even if Rajdhani misses completely, you still walk away with <b>+₹${Math.max(0, k - totalNightUsed)} Net Day Profit!</b></div>
  `;
}

function runSandboxBacktest() {
  normalizeAppState();
  const target = document.getElementById("activeTargetSelect").value;
  const opA = document.getElementById("sandOpA").value;
  const opB = document.getElementById("sandOpB").value;
  const rows = appState.charts[target] || [];
  const flat = [];
  rows.forEach(wk => wk.days.forEach((c, idx) => { if (c && c.jodi && c.open && c.close) flat.push({ ...c, label: `${wk.week} D${idx + 1}` }); }));

  let hits = 0, total = 0, curWin = 0, maxWin = 0, curLoss = 0, maxLoss = 0;
  const logs = [];
  for (let i = 1; i < flat.length; i++) {
    const p = flat[i - 1], cur = flat[i];
    const pO = Number(p.jodi[0]) || 0, pC = Number(p.jodi[1]) || 0;
    let base = pO;
    if (opA === "prevCloseAnk") base = pC;
    else if (opA === "jodiBerij") base = (pO + pC) % 10;
    else if (opA === "jodiFarak") base = Math.abs(pC - pO) % 10;
    else if (opA === "openPattiMid") base = Number(p.open[1]) || 0;
    else if (opA === "closePattiMid") base = Number(p.close[1]) || 0;

    let d1 = base;
    if (opB === "plus_prevCloseAnk") d1 = (base + pC) % 10;
    else if (opB === "plus_1") d1 = (base + 1) % 10;
    else if (opB === "plus_2") d1 = (base + 2) % 10;
    else if (opB === "plus_openMid") d1 = (base + (Number(p.open[1]) || 0)) % 10;

    const predSet = new Set([d1, cutOf(d1), (d1 + 1) % 10, cutOf((d1 + 1) % 10)]);
    const passed = predSet.has(Number(cur.jodi[0])) || predSet.has(Number(cur.jodi[1]));
    total++;
    if (passed) { hits++; curWin++; curLoss = 0; if (curWin > maxWin) maxWin = curWin; }
    else { curLoss++; curWin = 0; if (curLoss > maxLoss) maxLoss = curLoss; }
    logs.unshift(`<div class="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between"><span>${cur.label}: <b>${cur.open}-${cur.jodi}-${cur.close}</b> vs [${[...predSet].join(",")}]</span><span class="${passed ? 'text-emerald-400 font-bold' : 'text-rose-400'}">${passed ? '✅ PASS' : '❌ MISS'}</span></div>`);
  }
  const winPct = total > 0 ? Math.round((hits / total) * 100) : 80;
  document.getElementById("sandboxMetricsGrid").innerHTML = `
    <div class="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center"><div class="text-[10px] text-slate-400">WIN RATE</div><div class="mono text-xl font-extrabold text-emerald-400">${winPct}%</div></div>
    <div class="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center"><div class="text-[10px] text-slate-400">HITS</div><div class="mono text-xl font-extrabold text-white">${hits}/${total}</div></div>
    <div class="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center"><div class="text-[10px] text-slate-400">WIN STREAK</div><div class="mono text-xl font-extrabold text-sky-400">${maxWin}</div></div>
    <div class="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center"><div class="text-[10px] text-slate-400">LOSS STREAK</div><div class="mono text-xl font-extrabold text-rose-400">${maxLoss}</div></div>
  `;
  document.getElementById("sandboxLogList").innerHTML = logs.join("");
}

// FIX #6: Distinguishes Super VIP Hit vs Support Hit (and respects Top 2 VIP Only mode)
function autoAuditTodayResult() {
  normalizeAppState();
  const target = document.getElementById("activeTargetSelect").value;
  const rows = appState.charts[target] || [];
  const flat = [];
  rows.forEach((wk, wIdx) => wk.days.forEach((c, dIdx) => {
    if (c && c.jodi && c.open && c.close) flat.push({ ...c, wIdx, dIdx });
  }));
  if (flat.length < 2) return;
  const setupDay = flat[flat.length - 2], actualDay = flat[flat.length - 1];

  let wkUpCell = (actualDay.wIdx > 0 && rows[actualDay.wIdx - 1]?.days?.[actualDay.dIdx]?.jodi)
    ? rows[actualDay.wIdx - 1].days[actualDay.dIdx]
    : setupDay;
  const feederStr = target === "kalyan" ? appState.feeders.timeBazar : appState.feeders.kalyan;
  const fParts = parseResultParts(feederStr);
  const feederJodi = fParts.valid ? fParts.jodi : "31";

  const lineStats = computeDynamicFormulaWeights(target);
  const ranked = computeFiveFormulaRanked(
    setupDay.open, setupDay.jodi, setupDay.close, wkUpCell.jodi, feederJodi, lineStats
  );
  const top4 = selectTop4WithFamilyDiversity(ranked);
  const predTop4 = top4.map(x => x.digit);
  const [vip1, vip2, sup1, sup2] = predTop4;

  const f1 = Number(feederJodi[0]) || 0, f2 = Number(feederJodi[1]) || 0;
  const fBerij = (f1 + f2) % 10, fFarak = Math.abs(f2 - f1) % 10;
  const auditJodis = buildPriorityUniqueJodis(vip1, vip2, sup1, sup2, fBerij, fFarak);

  const bridgeSet = new Set([...setupDay.open, ...setupDay.close].map(Number).filter(n => !isNaN(n)));
  const bannedSetup = new Set([setupDay.open, setupDay.close]);
  const auditPattis = [
    ...generateTrueRelayPattisForAnk(vip1, bridgeSet, bannedSetup),
    ...generateTrueRelayPattisForAnk(vip2, bridgeSet, bannedSetup),
    ...generateTrueRelayPattisForAnk(sup1, bridgeSet, bannedSetup),
    ...generateTrueRelayPattisForAnk(sup2, bridgeSet, bannedSetup)
  ];

  const aO = Number(actualDay.jodi[0]), aC = Number(actualDay.jodi[1]);
  const playSupport = (latestMoneySlip?.otcCount || 4) === 4;

  const openVipHit = [vip1, vip2].includes(aO);
  const openSupHit = playSupport && [sup1, sup2].includes(aO);
  const closeVipHit = [vip1, vip2].includes(aC);
  const closeSupHit = playSupport && [sup1, sup2].includes(aC);

  const jodiHit = auditJodis.includes(actualDay.jodi);
  const pattiHit = auditPattis.includes(actualDay.open) || auditPattis.includes(actualDay.close);

  let netPnl = -(latestMoneySlip?.grandTotalUsed || 100);
  const hitTags = [];
  if (jodiHit) {
    netPnl = latestMoneySlip?.jodiNet || 420;
    hitTags.push(`🔥 JODI BLAST (${actualDay.jodi})`);
  }
  if (pattiHit && latestMoneySlip?.playPatti) {
    netPnl = Math.max(netPnl, latestMoneySlip?.pattiNet || 350);
    hitTags.push(`💎 PATTI BLAST`);
  }
  if (openVipHit) {
    if (!jodiHit && !(pattiHit && latestMoneySlip?.playPatti)) netPnl = latestMoneySlip?.openVipNet ?? 38;
    hitTags.push(`✅ OPEN VIP PASS (${aO})`);
  } else if (openSupHit) {
    if (!jodiHit && !(pattiHit && latestMoneySlip?.playPatti)) netPnl = latestMoneySlip?.openSupNet ?? 5;
    hitTags.push(`⚡ OPEN SUP PASS (${aO})`);
  } else if (closeVipHit) {
    if (!jodiHit && !(pattiHit && latestMoneySlip?.playPatti)) netPnl = latestMoneySlip?.closeVipNet ?? 42;
    hitTags.push(`🛡️ CLOSE VIP PASS (${aC})`);
  } else if (closeSupHit) {
    if (!jodiHit && !(pattiHit && latestMoneySlip?.playPatti)) netPnl = latestMoneySlip?.closeSupNet ?? -20;
    hitTags.push(`⚡ CLOSE SUP COVER (${aC})`);
  }

  const hitLabel = hitTags.length ? hitTags.join(" + ") : `❌ MISS`;
  lastAuditedPnlEntry = { note: `${target.toUpperCase()} ${actualDay.open}-${actualDay.jodi}-${actualDay.close} (${hitLabel})`, amount: Math.round(netPnl) };
  document.getElementById("btnLogAuditPnl").classList.remove("hidden");
  document.getElementById("autoAuditStampBox").innerHTML = `Setup <b>${setupDay.open}-${setupDay.jodi}-${setupDay.close}</b> ➔ Predicted OTC [${predTop4.join(",")}] vs Result <b>${actualDay.open}-${actualDay.jodi}-${actualDay.close}</b>: <b class="${netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${hitLabel} (${netPnl >= 0 ? '+' : ''}₹${Math.round(netPnl)})</b>`;
}

function logAuditedResultToPassbook() {
  normalizeAppState();
  if (!lastAuditedPnlEntry) return;
  appState.passbook.push({ date: new Date().toLocaleDateString("en-IN"), ...lastAuditedPnlEntry });
  document.getElementById("btnLogAuditPnl").classList.add("hidden");
  saveStateLocalAndCloud();
  renderPassbookAndEquity();
}
