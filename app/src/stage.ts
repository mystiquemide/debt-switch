import "./stage.css";

/*
 * Animated hero shot: the real testnet switch of borrower 0x5c64...67B4, replayed as a loop.
 * Numbers are the ones from that switch (300.00 mUSDC on 0.0400 BTC became 2,000.00 MUSD at 1.00% fixed).
 * Reduced motion, or a stage out of view, shows the payoff as a still.
 */

const W = 560;
const H = 420;
const tick = `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>`;
const STEPS = ["Approve", "Sign", "Check", "Confirm", "Waiting"];

export function stageMarkup() {
  return `
  <div class="ds-stage" role="img" aria-label="Animation of a real Debt Switch testnet switch: a 300 mUSDC Morpho loan on 0.04 BTC becomes a 2,000 MUSD loan at 1.00% fixed in one transaction.">
    <div class="ds-inner" style="width:${W}px;height:${H}px">
      <div class="ds-bar"><i></i><i></i><i></i><span>debtswitch.midelabs.xyz/app</span></div>
      <div class="ds-body">
        <div class="ds-top">
          <p class="ds-title">Switch your loan</p>
          <div class="ds-banner" data-banner><span class="ds-check">${tick}</span>Your loan is now fixed at 1.00%</div>
        </div>
        <div class="ds-cards">
          <section class="ds-card">
            <p class="ds-tag ds-tag-var">Variable rate</p>
            <h4>Morpho mUSDC</h4>
            <div class="ds-row"><span>You owe</span><b><span data-n="mdebt">300.00</span> mUSDC</b></div>
            <div class="ds-row"><span>Your Bitcoin</span><b><span data-n="mbtc">0.0400</span> BTC</b></div>
            <p class="ds-gone" data-mgone>Paid off</p>
          </section>
          <section class="ds-card">
            <p class="ds-tag ds-tag-fixed">Fixed rate</p>
            <h4>MUSD loan</h4>
            <div class="ds-row"><span>You owe</span><b><span data-n="tdebt">0.00</span> MUSD</b></div>
            <div class="ds-row"><span>Your Bitcoin</span><b><span data-n="tbtc">0.0000</span> BTC</b></div>
            <div class="ds-row ds-rate" data-rate><span>Rate</span><b>1.00% fixed</b></div>
          </section>
        </div>
        <div class="ds-action">
          <div class="ds-btn" data-btn>Approve, sign and switch</div>
          <ol class="ds-steps" data-steps>${STEPS.map((s, i) => `<li data-step="${i}"><span class="ds-dot">${i + 1}</span>${s}</li>`).join("")}</ol>
        </div>
      </div>
      <svg class="ds-cursor" data-cursor viewBox="0 0 20 24" width="20" height="24" aria-hidden="true"><path d="M2 1.5v18.2l4.6-4.3 3 6.6 3-1.4-3-6.4h6.3L2 1.5z" fill="#030302" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>
    </div>
  </div>`;
}

const fmt = (v: number, dp: number) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mountStage(root: HTMLElement) {
  const stage = root.querySelector<HTMLDivElement>(".ds-stage")!;
  const inner = stage.querySelector<HTMLDivElement>(".ds-inner")!;
  const q = <T extends Element = HTMLElement>(sel: string) => inner.querySelector<T>(sel)!;
  const num = (k: string) => q<HTMLSpanElement>(`[data-n="${k}"]`);
  const cursor = q<SVGElement>("[data-cursor]");
  const btn = q<HTMLDivElement>("[data-btn]");

  // Scale the fixed-size stage to its column, like a real screen shown smaller.
  const fit = () => {
    const k = Math.min(1, stage.clientWidth / W);
    inner.style.transform = `scale(${k})`;
    stage.style.height = `${H * k}px`;
  };
  new ResizeObserver(fit).observe(stage);
  fit();

  const roll = (k: string, from: number, to: number, dp: number, ms: number) =>
    new Promise<void>((done) => {
      const el = num(k);
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / ms);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(from + (to - from) * e, dp);
        if (p < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });

  const setState = (s: "start" | "end") => {
    inner.dataset.state = s;
    inner.querySelectorAll("[data-step]").forEach((li) => li.classList.toggle("done", s === "end"));
    num("mdebt").textContent = s === "end" ? "0.00" : "300.00";
    num("mbtc").textContent = s === "end" ? "0.0000" : "0.0400";
    num("tdebt").textContent = s === "end" ? "2,000.00" : "0.00";
    num("tbtc").textContent = s === "end" ? "0.0400" : "0.0000";
    cursor.style.opacity = "0";
    cursor.style.transform = `translate(${W - 40}px, ${H - 30}px)`;
  };

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The payoff is the poster: what reduced motion, screenshots and first paint show.
  setState("end");
  inner.dataset.phase = "done";
  if (reduced) return;

  let visible = false;
  let running = false;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !running) loop();
  }).observe(stage);

  const target = () => {
    const b = btn.getBoundingClientRect();
    const r = inner.getBoundingClientRect();
    const k = r.width / W;
    return { x: (b.left - r.left) / k + b.width / k / 2 - 4, y: (b.top - r.top) / k + b.height / k / 2 - 6 };
  };

  async function loop() {
    running = true;
    while (visible && !document.hidden) {
      // Beat 0: the loan as it was.
      inner.dataset.phase = "fade";
      await wait(350);
      setState("start");
      inner.dataset.phase = "start";
      await wait(900);
      // Beat 1: the cursor goes to the button and presses it.
      const t = target();
      cursor.style.opacity = "1";
      cursor.style.transform = `translate(${t.x}px, ${t.y}px)`;
      await wait(900);
      btn.classList.add("pressed");
      cursor.classList.add("pressed");
      await wait(180);
      btn.classList.remove("pressed");
      cursor.classList.remove("pressed");
      await wait(150);
      // Beat 2: the steps tick off.
      inner.dataset.phase = "steps";
      cursor.style.opacity = "0";
      for (let i = 0; i < STEPS.length; i++) {
        await wait(i === STEPS.length - 1 ? 900 : 560);
        q(`[data-step="${i}"]`).classList.add("done");
      }
      await wait(250);
      // Beat 3: the money moves. Morpho drains, the MUSD loan fills, then the banner confirms.
      inner.dataset.phase = "moving";
      await Promise.all([roll("mdebt", 300, 0, 2, 1100), roll("mbtc", 0.04, 0, 4, 1100)]);
      await Promise.all([roll("tdebt", 0, 2000, 2, 1200), roll("tbtc", 0, 0.04, 4, 1200)]);
      inner.dataset.phase = "done";
      // Beat 4: hold the payoff.
      await wait(4200);
    }
    running = false;
    setState("end");
    inner.dataset.phase = "done";
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && visible && !running) loop();
  });
}
