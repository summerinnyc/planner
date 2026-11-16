// PLANNER_WIDGET v1 — Summer's planner, today's to-dos as an iPhone widget (runs inside the Scriptable app).
// Loaded by a small loader script; do not paste this file directly.
// Read-only: it signs in with the planner account kept in the phone's Keychain and reads today's tasks.

const CFG = {
  url: "https://jhomzoejatboggqjapqv.supabase.co",
  key: "sb_publishable_q0QnBw1ds9MVucgNSMandg_A2ap_fGB",
  app: "https://summerinnyc.github.io/planner/",
};
const K_MAIL = "planner.widget.email", K_PW = "planner.widget.pw", CACHE = "planner-widget-cache.json";
const WD = "일월화수목금토";
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

// ---------- choosing what to show (same rules as the app's "오늘" list) ----------
function pick(rows, settings, t) {
  const sort = (settings && settings.sort) || "datetime";
  const ord = (i) => (i.order == null ? i.createdAt || 0 : i.order);
  const cmp = (a, b) => {
    if (sort === "created") return (a.createdAt || 0) - (b.createdAt || 0);
    if (sort === "manual") return ord(a) - ord(b);
    if (sort === "due") { const x = a.due || "9999-12-31", y = b.due || "9999-12-31"; if (x !== y) return x < y ? -1 : 1; }
    const ka = (a.date || "9999-12-31") + " " + (a.time || "99:99"), kb = (b.date || "9999-12-31") + " " + (b.time || "99:99");
    if (ka !== kb) return ka < kb ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  };
  const seen = new Set();
  const live = rows.map((r) => Object.assign({id: r.id}, r.data || {}))
    .filter((i) => { if (seen.has(i.id)) return false; seen.add(i.id); return (!i.kind || i.kind === "task") && !i.deleted && !i.purged; });
  const cats = {};
  for (const c of (settings && settings.categories) || []) cats[c.id] = c.color;
  const color = (i) => cats[i.categoryId] || null;
  const shape = (i, extra) => Object.assign({title: i.title || "", time: i.time || "", date: i.date || "", color: color(i)}, extra);
  return {
    late: live.filter((i) => !i.done && i.date && i.date < t).sort(cmp).map((i) => shape(i, {late: true})),
    today: live.filter((i) => !i.done && i.date === t).sort(cmp).map((i) => shape(i, {})),
    done: live.filter((i) => i.done && i.doneAt && ymd(new Date(i.doneAt)) === t).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).map((i) => shape(i, {done: true})),
  };
}

if (typeof ListWidget === "undefined") {
  // not inside Scriptable (tests)
  module.exports = {pick, ymd};
} else {
  // ---------- account ----------
  async function askLogin(msg) {
    const a = new Alert();
    a.title = "플래너 로그인";
    a.message = msg || "플래너에서 쓰는 이메일과 비밀번호를 한 번만 넣어 주세요. 이 폰 안에만 저장돼요.";
    a.addTextField("이메일", Keychain.contains(K_MAIL) ? Keychain.get(K_MAIL) : "");
    a.addSecureTextField("비밀번호", "");
    a.addAction("저장");
    a.addCancelAction("취소");
    if ((await a.presentAlert()) === -1) return false;
    Keychain.set(K_MAIL, a.textFieldValue(0).trim());
    Keychain.set(K_PW, a.textFieldValue(1));
    return true;
  }
  async function signIn() {
    const r = new Request(CFG.url + "/auth/v1/token?grant_type=password");
    r.method = "POST";
    r.headers = {apikey: CFG.key, "Content-Type": "application/json"};
    r.body = JSON.stringify({email: Keychain.get(K_MAIL), password: Keychain.get(K_PW)});
    r.timeoutInterval = 15;
    const j = await r.loadJSON();
    if (!j || !j.access_token) { const e = new Error("login"); e.login = r.response && r.response.statusCode === 400; throw e; }
    return j.access_token;
  }
  async function get(path, token) {
    const r = new Request(CFG.url + "/rest/v1/" + path);
    r.headers = {apikey: CFG.key, Authorization: "Bearer " + token};
    r.timeoutInterval = 15;
    const j = await r.loadJSON();
    if (!Array.isArray(j)) throw new Error("query");
    return j;
  }
  async function load(t) {
    const token = await signIn();
    const enc = encodeURIComponent;
    let rows;
    try {
      // unfinished tasks dated today or earlier, plus the most recently finished ones
      const open = await get("items?select=id,data&" + enc("data->>date") + "=lte." + t + "&and=" + enc("(or(data->>kind.is.null,data->>kind.eq.task),or(data->>done.is.null,data->>done.eq.false))") + "&limit=500", token);
      const done = await get("items?select=id,data&" + enc("data->>done") + "=eq.true&order=server_ts.desc&limit=40", token);
      rows = open.concat(done);
    } catch (e) {
      rows = await get("items?select=id,data&order=server_ts.desc&limit=1000", token);
    }
    let settings = null;
    try { const s = await get("settings?select=data", token); settings = s[0] && s[0].data; } catch (e) {}
    return pick(rows, settings, t);
  }

  // ---------- drawing ----------
  const INK = Color.dynamic(new Color("#111111"), new Color("#f0f0f0"));
  const PAPER = Color.dynamic(new Color("#ffffff"), new Color("#0f0f0f"));
  const MUTED = Color.dynamic(new Color("#6c6c6c"), new Color("#9b9b9b"));
  const ALERT = Color.dynamic(new Color("#d0352b"), new Color("#ff6d61"));

  function row(w, it, big) {
    const s = w.addStack();
    s.layoutHorizontally(); s.centerAlignContent(); s.spacing = 7;
    const ic = s.addImage(SFSymbol.named(it.done ? "checkmark.circle.fill" : "circle").image);
    ic.imageSize = new Size(big ? 17 : 15, big ? 17 : 15);
    ic.tintColor = it.done ? MUTED : INK;
    if (it.time && !it.done) {
      const p = s.addStack();
      p.setPadding(1, 6, 1, 6); p.cornerRadius = 8; p.backgroundColor = INK;
      const tx = p.addText(it.time);
      tx.font = Font.boldMonospacedSystemFont(big ? 11 : 10); tx.textColor = PAPER; tx.lineLimit = 1;
    }
    const tt = s.addText(it.title || "(제목 없음)");
    tt.font = Font.systemFont(big ? 14.5 : 13); tt.lineLimit = 1;
    tt.textColor = it.done ? MUTED : INK;
    s.addSpacer();
    if (it.late) {
      const d = s.addText(Number(it.date.slice(5, 7)) + "/" + Number(it.date.slice(8, 10)));
      d.font = Font.systemFont(10.5); d.textColor = ALERT; d.lineLimit = 1;
    }
    if (it.color && !it.done) {
      const dot = s.addStack();
      dot.size = new Size(8, 8); dot.cornerRadius = 4;
      try { dot.backgroundColor = new Color(it.color); } catch (e) {}
    }
  }
  function build(data, note) {
    const fam = config.widgetFamily || "large";
    const big = fam === "large" || fam === "extraLarge";
    const max = fam === "small" ? 3 : fam === "medium" ? 3 : 10;
    const now = new Date();
    const w = new ListWidget();
    w.backgroundColor = PAPER;
    w.url = CFG.app;
    w.setPadding(14, 16, 12, 16);
    w.refreshAfterDate = new Date(Date.now() + 15 * 60000);

    const head = w.addStack();
    head.layoutHorizontally(); head.bottomAlignContent();
    const dt = head.addText((now.getMonth() + 1) + "." + pad(now.getDate()));
    dt.font = Font.heavySystemFont(big ? 24 : 19); dt.textColor = INK;
    head.addSpacer(6);
    const wd = head.addText(WD[now.getDay()] + "요일");
    wd.font = Font.mediumSystemFont(big ? 12 : 11); wd.textColor = MUTED;
    head.addSpacer();
    if (data) {
      const left = data.late.length + data.today.length;
      const n = head.addText(left ? "남은 일 " + left : data.done.length ? "모두 완료" : "");
      n.font = Font.semiboldSystemFont(big ? 12 : 11); n.textColor = left ? INK : MUTED;
    }
    w.addSpacer(big ? 8 : 6);
    const rule = w.addStack(); rule.size = new Size(0, 1); rule.backgroundColor = INK; rule.addSpacer();
    w.addSpacer(big ? 9 : 6);

    if (!data) {
      const m = w.addText(note || "불러오지 못했어요");
      m.font = Font.systemFont(13); m.textColor = MUTED;
      w.addSpacer();
      return w;
    }
    const open = data.late.concat(data.today);
    let list = open.slice(0, max);
    if (list.length < max) list = list.concat(data.done.slice(0, max - list.length));
    const hidden = open.length - Math.min(open.length, max);
    if (!list.length) {
      const m = w.addText("오늘 할 일 없음");
      m.font = Font.systemFont(13.5); m.textColor = MUTED;
    }
    list.forEach((it, i) => { if (i) w.addSpacer(big ? 8 : 6); row(w, it, big); });
    w.addSpacer();
    const foot = w.addStack(); foot.layoutHorizontally();
    if (hidden > 0) { const more = foot.addText("+" + hidden + "개 더"); more.font = Font.systemFont(10.5); more.textColor = MUTED; }
    foot.addSpacer();
    const up = foot.addText((note ? note + " · " : "") + pad(now.getHours()) + ":" + pad(now.getMinutes()));
    up.font = Font.systemFont(9.5); up.textColor = MUTED;
    return w;
  }

  // ---------- run ----------
  const fm = FileManager.local();
  const cachePath = fm.joinPath(fm.documentsDirectory(), CACHE);
  const t = ymd(new Date());
  let widget;
  const hasLogin = Keychain.contains(K_MAIL) && Keychain.contains(K_PW);
  if (!hasLogin && config.runsInWidget) {
    widget = build(null, "Scriptable 앱에서 이 스크립트를 한 번 실행해 로그인해 주세요");
  } else {
    let ok = hasLogin || (await askLogin());
    let data = null, note = "";
    if (ok) {
      try { data = await load(t); }
      catch (e) {
        if (e.login && !config.runsInWidget) {
          ok = await askLogin("이메일이나 비밀번호가 맞지 않아요. 다시 넣어 주세요.");
          if (ok) { try { data = await load(t); } catch (e2) {} }
        }
      }
    }
    if (data) { try { fm.writeString(cachePath, JSON.stringify({t, data})); } catch (e) {} }
    else if (fm.fileExists(cachePath)) {
      // offline: show the last list we saw today
      try { const c = JSON.parse(fm.readString(cachePath)); if (c.t === t) { data = c.data; note = "오프라인"; } } catch (e) {}
    }
    widget = build(data, data ? note : ok ? "불러오지 못했어요. 인터넷 연결을 확인해 주세요" : "로그인이 필요해요");
  }
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentLarge();
  Script.complete();
}
