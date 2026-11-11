import cloudscraper
from bs4 import BeautifulSoup
import re
import json
import datetime
import time
import urllib.request
import ssl
import os

TARGET_URL = "https://sattamatka.email/"
FIREBASE_URL = "https://smart-otc-cloud-default-rtdb.firebaseio.com".rstrip('/')

ist_now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=5, minutes=30)
# Midnight Rollover Lock: Runs between 12:00 AM and 03:59 AM IST belong to the previous night's trading session
session_dt = ist_now - datetime.timedelta(hours=4)
today_date_label = session_dt.strftime("%d/%m/%Y (%a)")
weekday_now = session_dt.weekday()  # 0=Mon .. 5=Sat
monday_now_dt = (session_dt - datetime.timedelta(days=weekday_now)).date()
current_week_label = monday_now_dt.strftime("%d/%m/%Y")

scraper = cloudscraper.create_scraper(
    browser={'browser': 'chrome', 'platform': 'windows', 'mobile': False}
)

html_text = ""
for attempt in range(3):
    try:
        resp = scraper.get(TARGET_URL, timeout=20)
        if resp.status_code == 200 and len(resp.text) > 500:
            html_text = resp.text
            break
    except Exception as e:
        print(f"[Retry {attempt+1}/3] Fetch warning: {e}")
        time.sleep(2)

soup = BeautifulSoup(html_text, "lxml") if html_text else BeautifulSoup("", "lxml")

chart_links = {}
for a in soup.find_all("a", href=True):
    href = a["href"]
    txt = " ".join(a.get_text(" ", strip=True).split()).upper()
    parent_txt = " ".join(a.parent.get_text(" ", strip=True).split()).upper() if a.parent else ""
    if txt == "PANEL" or "PANEL-CHART" in href.upper() or "PANEL_CHART" in href.upper():
        full_url = href if href.startswith("http") else TARGET_URL.rstrip("/") + "/" + href.lstrip("/")
        for m in ["MAIN BAZAR", "TIME BAZAR", "KALYAN", "RAJDHANI NIGHT"]:
            if re.search(rf"(?<![A-Z]){m}(?!\s*(?:MORNING|NIGHT|DAY|STARLINE))", parent_txt + " " + full_url.upper().replace("-", " ")):
                if m not in chart_links:
                    chart_links[m] = full_url

for tag in soup(["script", "style", "noscript"]):
    tag.decompose()

full_page_text = " ".join(soup.get_text(" ", strip=True).split())


def parse_first_live_slot(page_text, market_name):
    if not page_text:
        return None
    escaped = re.escape(market_name).replace(r"\ ", r"\s+")
    pattern = rf"(?<![A-Z0-9]){escaped}(?!\s*(?:MORNING|NIGHT|DAY|STARLINE|GOLD|BAZAR|JACKPOT))\s+Jodi\s+(.*?)\s+Panel"
    matches = list(re.finditer(pattern, page_text, re.IGNORECASE))
    if matches:
        first_slot = matches[0].group(1).strip()
        if len(first_slot) <= 45:
            return first_slot
    return None


DIGIT_SLOT_RE = re.compile(r'([0-9]{3})\s*-\s*([0-9\*]{1,2})(?:\s*-\s*([0-9\*]{3}))?')
DAY_OR_HOLIDAY_RE = re.compile(
    r'(?:(?<![0-9])([0-9])\s*([0-9])\s*([0-9])\s*[\-\s]+\s*([0-9]{2})\s*[\-\s]+\s*([0-9])\s*([0-9])\s*([0-9])(?![0-9]))|(?:\*\s*\*\s*\*\s*[\-\s]*\*{1,2}\s*[\-\s]*\*\s*\*\s*\*)'
)
DATE_TOKEN_RE = re.compile(r'\b(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})\b')


def is_valid_matka_record(o1, o2, o3, jodi, c1, c2, c3):
    m_val = lambda d: 10 if d == '0' else int(d)
    if not (m_val(o1) <= m_val(o2) <= m_val(o3)):
        return False
    if not (m_val(c1) <= m_val(c2) <= m_val(c3)):
        return False
    return ((int(o1) + int(o2) + int(o3)) % 10 == int(jodi[0])) and ((int(c1) + int(c2) + int(c3)) % 10 == int(jodi[1]))


def parse_date_tuple(dd_s, mm_s, yy_s):
    try:
        d, m, y = int(dd_s), int(mm_s), int(yy_s)
        if y < 100:
            y += 2000
        if 2020 <= y <= 2035 and 1 <= m <= 12 and 1 <= d <= 31:
            return datetime.date(y, m, d)
    except Exception:
        pass
    return None


def parse_label_date(label_str):
    if not label_str or not isinstance(label_str, str):
        return None
    m = DATE_TOKEN_RE.search(label_str)
    if m:
        return parse_date_tuple(m.group(1), m.group(2), m.group(3))
    return None


def normalize_days_list(raw_days):
    res = [None] * 6
    if isinstance(raw_days, list):
        for i in range(min(6, len(raw_days))):
            item = raw_days[i]
            if isinstance(item, dict) and item.get("jodi"):
                res[i] = item
    elif isinstance(raw_days, dict):
        for k, v in raw_days.items():
            try:
                idx = int(k)
                if 0 <= idx < 6 and isinstance(v, dict) and v.get("jodi"):
                    res[idx] = v
            except Exception:
                pass
    return res


def normalize_weeks_list(raw_weeks):
    if isinstance(raw_weeks, dict):
        raw_weeks = list(raw_weeks.values())
    if not isinstance(raw_weeks, list):
        return []
    cleaned = []
    for w in raw_weeks:
        if isinstance(w, dict) and w.get("week"):
            cleaned.append({
                "week": str(w.get("week")),
                "days": normalize_days_list(w.get("days"))
            })
    return cleaned


def fetch_latest_and_weeks_from_panel_chart(url):
    if not url:
        return None, None, []
    try:
        c_resp = scraper.get(url, timeout=15)
        c_soup = BeautifulSoup(c_resp.text, "lxml")
        valid_records = []
        structured_weeks = []

        for tbl in c_soup.find_all("table"):
            for tr in tbl.find_all("tr"):
                tr_text = " ".join(tr.get_text(" ", strip=True).split())
                d_matches = DATE_TOKEN_RE.findall(tr_text)
                monday_dt = None
                week_label = None
                for dm in d_matches:
                    cand_dt = parse_date_tuple(dm[0], dm[1], dm[2])
                    if cand_dt:
                        monday_dt = cand_dt
                        week_label = cand_dt.strftime("%d/%m/%Y")
                        break

                clean_tr = DATE_TOKEN_RE.sub(" DATE ", tr_text)
                day_slots = []
                for m in DAY_OR_HOLIDAY_RE.finditer(clean_tr):
                    if m.group(1) is not None:
                        o1, o2, o3, jd, c1, c2, c3 = m.groups()
                        if is_valid_matka_record(o1, o2, o3, jd, c1, c2, c3):
                            day_slots.append({"open": f"{o1}{o2}{o3}", "jodi": jd, "close": f"{c1}{c2}{c3}"})
                        else:
                            # FIX #1: Preserve column index even if a cell has a website typo
                            day_slots.append(None)
                    else:
                        day_slots.append(None)

                if any(x is not None for x in day_slots):
                    padded_days = (day_slots + [None] * 6)[:6]
                    for idx, r_item in enumerate(padded_days):
                        if r_item is not None:
                            if monday_dt:
                                cell_dt = monday_dt + datetime.timedelta(days=idx)
                                r_item["date"] = cell_dt.strftime("%d/%m/%Y (%a)")
                            valid_records.append(r_item)
                    structured_weeks.append({
                        "week": week_label or f"Wk-{len(structured_weeks)+1}",
                        "days": [
                            {"open": x["open"], "jodi": x["jodi"], "close": x["close"], "date": x.get("date")} if x else None
                            for x in padded_days
                        ]
                    })

        if valid_records:
            last = valid_records[-1]
            latest_str = f"{last['open']}-{last['jodi']}-{last['close']}"
            return latest_str, last.get("date"), structured_weeks[-5:]
    except Exception as e:
        print(f"[Warn] Chart parse ({url}): {e}")
    return None, None, []


def merge_chart_weeks(existing_wks, scraped_wks):
    existing_clean = normalize_weeks_list(existing_wks)
    scraped_clean = normalize_weeks_list(scraped_wks)
    if not scraped_clean:
        return existing_clean[-5:]
    if not existing_clean:
        return scraped_clean[-5:]

    merged_map = {}
    order_keys = []
    for w in scraped_clean:
        wk_key = w["week"]
        merged_map[wk_key] = {"week": wk_key, "days": list(w["days"])}
        if wk_key not in order_keys:
            order_keys.append(wk_key)

    for ew in existing_clean:
        wk_key = ew["week"]
        ew_days = ew["days"]
        if wk_key not in merged_map:
            if any(x is not None for x in ew_days):
                merged_map[wk_key] = {"week": wk_key, "days": list(ew_days)}
                order_keys.append(wk_key)
        else:
            for d_i in range(6):
                if merged_map[wk_key]["days"][d_i] is None and ew_days[d_i] is not None:
                    merged_map[wk_key]["days"][d_i] = ew_days[d_i]

    def sort_key(idx_and_k):
        idx, k = idx_and_k
        dt = parse_label_date(k)
        return (1, dt) if dt else (0, datetime.date(2000, 1, 1) + datetime.timedelta(days=idx))

    sorted_keys = [k for _, k in sorted(enumerate(order_keys), key=sort_key)]
    return [merged_map[k] for k in sorted_keys][-5:]


ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

try:
    req = urllib.request.urlopen(f"{FIREBASE_URL}/otc_pro_v62_master.json", context=ctx, timeout=15)
    state = json.loads(req.read().decode('utf-8')) or {}
except Exception:
    state = {}

if not isinstance(state, dict):
    state = {}

existing_feeders = state.get("feeders") if isinstance(state.get("feeders"), dict) else {}
existing_dates = state.get("feederDates") if isinstance(state.get("feederDates"), dict) else {}
raw_charts = state.get("charts") if isinstance(state.get("charts"), dict) else {}

MARKETS = ["MAIN BAZAR", "TIME BAZAR", "KALYAN", "RAJDHANI NIGHT"]
key_map = {"MAIN BAZAR": "mainBazar", "TIME BAZAR": "timeBazar", "KALYAN": "kalyan", "RAJDHANI NIGHT": "rajdhani"}
fallback_dates = {
    "mainBazar": existing_dates.get("mainBazar", "06/11/2026 (Fri)"),
    "timeBazar": existing_dates.get("timeBazar", "06/11/2026 (Fri)"),
    "kalyan": "06/11/2026 (Fri)" if existing_dates.get("kalyan") == "05/11/2026 (Thu)" else existing_dates.get("kalyan", "06/11/2026 (Fri)"),
    "rajdhani": existing_dates.get("rajdhani", "06/11/2026 (Fri)")
}

final_results = {}
final_dates = {}
live_status = {}
updated_charts = {
    "kalyan": normalize_weeks_list(raw_charts.get("kalyan", [])),
    "rajdhani": normalize_weeks_list(raw_charts.get("rajdhani", []))
}

for m_name in MARKETS:
    k_name = key_map[m_name]
    live_slot = parse_first_live_slot(full_page_text, m_name)
    p_url = chart_links.get(m_name)
    locked_val = None
    locked_date = fallback_dates[k_name]
    live_status[k_name] = "HOLIDAY" if (live_slot and "HOLIDAY" in live_slot.upper()) else "ACTIVE"

    chart_val, chart_date, chart_weeks = fetch_latest_and_weeks_from_panel_chart(p_url)
    if m_name in ["KALYAN", "RAJDHANI NIGHT"] and chart_weeks:
        c_key = "kalyan" if m_name == "KALYAN" else "rajdhani"
        updated_charts[c_key] = merge_chart_weeks(updated_charts.get(c_key, []), chart_weeks)

    if live_slot:
        dm = DIGIT_SLOT_RE.search(live_slot)
        if dm:
            op, jd, cl = dm.group(1), dm.group(2), dm.group(3) or "***"
            if len(jd) == 1:
                jd = f"{jd}*"
            locked_val = f"{op}-{jd}-{cl}"
            locked_date = today_date_label if ("*" not in locked_val) else f"{today_date_label} • LIVE"
            live_status[k_name] = "COMPLETE" if ("*" not in locked_val) else "LIVE"

            if "*" not in locked_val and len(jd) == 2 and weekday_now < 6 and m_name in ["KALYAN", "RAJDHANI NIGHT"]:
                c_key = "kalyan" if m_name == "KALYAN" else "rajdhani"
                if is_valid_matka_record(op[0], op[1], op[2], jd, cl[0], cl[1], cl[2]):
                    w_list = normalize_weeks_list(updated_charts.get(c_key, []))
                    target_wk = next((w for w in w_list if w.get("week") == current_week_label), None)
                    if not target_wk:
                        target_wk = {"week": current_week_label, "days": [None] * 6}
                        w_list.append(target_wk)
                    target_wk["days"][weekday_now] = {
                        "open": op, "jodi": jd, "close": cl, "date": today_date_label
                    }
                    updated_charts[c_key] = w_list[-5:]

    if not locked_val and chart_val:
        prev_saved_val = existing_feeders.get(k_name)
        prev_saved_dt = parse_label_date(existing_dates.get(k_name))
        new_chart_dt = parse_label_date(chart_date)

        if prev_saved_val and not prev_saved_val.startswith("***") and prev_saved_dt and new_chart_dt and new_chart_dt < prev_saved_dt:
            locked_val = prev_saved_val
            locked_date = fallback_dates[k_name]
        else:
            locked_val = chart_val
            if chart_date:
                locked_date = chart_date
            elif locked_val != prev_saved_val:
                locked_date = today_date_label

    final_results[k_name] = locked_val or existing_feeders.get(k_name, "WAITING-LIVE")
    final_dates[k_name] = locked_date

state["feeders"] = final_results
state["feederDates"] = final_dates
state["liveStatus"] = live_status
state["charts"] = updated_charts
state["updatedAt"] = ist_now.strftime("%Y-%m-%d %H:%M:%S IST")

with open("live_feed.json", "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2)

payload = json.dumps(state).encode('utf-8')
for node in ["otc_pro_v62_master.json", "otc_pro_v61_real.json", "otc_pro_v51.json"]:
    try:
        put_req = urllib.request.Request(
            f"{FIREBASE_URL}/{node}",
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='PUT'
        )
        urllib.request.urlopen(put_req, context=ctx, timeout=15)
    except Exception as e:
        print(f"[Warn] Firebase PUT ({node}): {e}")

bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
chat_id = os.environ.get("TELEGRAM_CHAT_ID")
if bot_token and chat_id:
    msg = (
        f"⚡ *Smart OTC Pro Auto-Sync*\n"
        f"🕒 Time: {state['updatedAt']}\n"
        f"👑 Kalyan: `{final_results.get('kalyan')}` ({final_dates.get('kalyan')})\n"
        f"🌙 Rajdhani: `{final_results.get('rajdhani')}` ({final_dates.get('rajdhani')})\n"
        f"⏱️ Time Bazar: `{final_results.get('timeBazar')}` ({final_dates.get('timeBazar')})\n"
        f"🏛️ Main Bazar: `{final_results.get('mainBazar')}` ({final_dates.get('mainBazar')})"
    )
    tg_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    tg_data = json.dumps({"chat_id": chat_id, "text": msg, "parse_mode": "Markdown"}).encode('utf-8')
    try:
        urllib.request.urlopen(urllib.request.Request(tg_url, data=tg_data, headers={'Content-Type': 'application/json'}), timeout=10)
    except Exception:
        pass

print("Synced Results:", json.dumps(final_results))
print("Synced Dates:", json.dumps(final_dates))
