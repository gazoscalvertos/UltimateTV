// Pairs this phone with the TV, on every Hub page a phone opens (the remote, settings, stats,
// music login). The TV's QR codes carry a one-time code (?pair=…), so scanning one pairs the phone
// at once; otherwise the page asks for the code shown on the TV, or (in the Android app) offers to
// scan it. The Hub then keeps the phone's key in a cookie that every page sends by itself.
(() => {
  const app = window.UltimateTVApp;
  const canScan = Boolean(app && typeof app.scan === "function");
  const guessName = () => {
    const ua = navigator.userAgent;
    if (/iPad/.test(ua)) return "iPad";
    if (/iPhone/.test(ua)) return "iPhone";
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
    return "Browser";
  };

  const css = `
    .utv-pair { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 24px; background: #070b14; color: #f3f6fb; font: 16px/1.4 Inter, "Noto Sans", Roboto, system-ui, sans-serif; user-select: text; -webkit-user-select: text; }
    .utv-pair > div { width: 100%; max-width: 380px; }
    .utv-pair h2 { margin: 0 0 8px; font-size: 24px; }
    .utv-pair p { margin: 0 0 18px; color: #9aa6bd; }
    .utv-pair input { box-sizing: border-box; width: 100%; padding: 14px; border-radius: 12px; border: 1px solid #24324d; background: #0d1526; color: #f3f6fb; font: 700 24px/1 ui-monospace, Menlo, monospace; letter-spacing: 4px; text-align: center; text-transform: uppercase; }
    .utv-pair input.name { font-family: inherit; font-weight: 400; font-size: 17px; letter-spacing: 0; text-transform: none; text-align: left; }
    .utv-pair button { width: 100%; margin-top: 12px; padding: 14px; border: 0; border-radius: 12px; background: #3d8bff; color: #fff; font-family: inherit; font-weight: 600; font-size: 17px; }
    .utv-pair button.secondary { background: transparent; border: 1px solid #24324d; }
    .utv-pair .err { min-height: 22px; margin: 12px 0 0; color: #ff7887; }
    .utv-pair label { display: block; margin-top: 14px; font-size: 14px; color: #9aa6bd; }`;

  let box = null;
  async function pair(raw, name) {
    const r = await fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: raw, name: name || guessName() }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "That didn't work. Try again.");
    // Everything on the page was loaded unpaired: start again with the cookie.
    location.reload();
  }

  function show(message) {
    if (box) {
      if (message) box.querySelector(".err").textContent = message;
      return;
    }
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    box = document.createElement("div");
    box.className = "utv-pair";
    box.innerHTML = `<div>
      <h2>Pair with your TV</h2>
      <p>So only your family's phones can work the TV. On the TV, open <b>Settings › Phones and remotes</b>, then ${canScan ? "scan the code, or type the letters under it" : "scan the code with your camera, or type the letters under it here"}.</p>
      ${canScan ? '<button type="button" class="scan">Scan the TV’s code</button>' : ""}
      <form>
        <label>Code on the TV</label>
        <input class="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="ABCD-EFGH">
        <label>Name this phone</label>
        <input class="name" maxlength="40" autocomplete="off">
        <button type="submit" class="${canScan ? "secondary" : ""}">Pair</button>
      </form>
      <p class="err"></p>
    </div>`;
    const err = box.querySelector(".err");
    const name = box.querySelector(".name");
    name.value = guessName();
    if (message) err.textContent = message;
    box.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      const code = box.querySelector(".code").value;
      if (!code.trim()) return void (err.textContent = "Type the code shown on the TV.");
      err.textContent = "Pairing…";
      pair(code, name.value.trim()).catch((x) => (err.textContent = x.message));
    };
    const scan = box.querySelector(".scan");
    if (scan) scan.onclick = () => app.scan();
    document.body.append(box);
  }

  // The Android app's scanner answers here.
  window.utvScanError = (message) => show(message);
  window.utvScanResult = (text) => {
    if (!/pair=|^[A-Za-z0-9 -]{8,12}$/.test(String(text))) return show("That isn't the TV's pairing code. Scan the code in Settings › Phones and remotes.");
    show("Pairing…");
    pair(text, box && box.querySelector(".name").value.trim()).catch((x) => show(x.message));
  };

  // Anything the Hub turns away for want of pairing brings the pairing screen up.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await realFetch(...args);
    if (res.status === 401) {
      res.clone().json().then((d) => d && d.code === "pair" && show(), () => undefined);
    }
    return res;
  };

  const params = new URLSearchParams(location.search);
  const code = params.get("pair");
  if (code) {
    // Out of the address bar, so it isn't bookmarked or shared.
    params.delete("pair");
    history.replaceState(null, "", location.pathname + (params.toString() ? `?${params}` : "") + location.hash);
  }
  const ready = () => new Promise((r) => (document.body ? r() : addEventListener("DOMContentLoaded", () => r())));
  realFetch("/api/pair")
    .then((r) => r.json())
    .then(async (d) => {
      // Already paired: a code scanned again is left for someone else.
      if (d.paired) return;
      await ready();
      if (code) pair(code).catch((x) => show(x.message));
      else show();
    })
    .catch(() => undefined);
})();
