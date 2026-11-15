import "./loans.css";
import { readLoanFacts, type LoanFacts } from "./mainnet";

const COINS = "https://images.unsplash.com/photo-1621504450272-8abba1bfefde"; // Art Rachen, Unsplash License
const coins = (w: number) => `${COINS}?auto=format&fit=crop&q=80&w=${w}`;

const num = (n: number, dp = 0) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (n: number, dp = 2) => `${num(n, dp)}%`;
const row = (label: string, value: string) => `<div class="loan-row"><dt>${label}</dt><dd>${value}</dd></div>`;

function cards(f: LoanFacts) {
  return `
    <article class="loan-card">
      <p class="loan-tag loan-tag-var">Variable rate</p>
      <h3>Morpho mUSDC</h3>
      <p class="loan-rate">${pct(f.morpho.borrowApy)}<span>a year today</span></p>
      <dl>
        ${row("Rate", "Moves with demand")}
        ${row("Liquidated above", `${pct(f.morpho.lltv, 0)} loan to value`)}
        ${row("Smallest loan", "No minimum")}
        ${row("Borrowed on Mezo now", `${num(f.morpho.borrowed)} mUSDC`)}
      </dl>
    </article>
    <figure class="loan-coins">
      <img src="${coins(800)}" srcset="${coins(480)} 480w, ${coins(800)} 800w, ${coins(1200)} 1200w" sizes="(max-width: 900px) 60vw, 260px"
        alt="Two gold Bitcoin coins standing on a stack of coins" loading="lazy" />
    </figure>
    <article class="loan-card">
      <p class="loan-tag loan-tag-fixed">Fixed rate</p>
      <h3>MUSD trove</h3>
      <p class="loan-rate">${pct(f.trove.fixedRate)}<span>a year, fixed</span></p>
      <dl>
        ${row("Rate", "Set when you open it")}
        ${row("Liquidated above", `${pct(f.trove.maxLtv, 0)} loan to value`)}
        ${row("Smallest loan", `${num(f.trove.minNetDebt)} MUSD`)}
        ${row("Borrowed on Mezo now", `${num(f.trove.borrowed)} MUSD`)}
      </dl>
    </article>`;
}

const loading = `
  <div class="loans-status" role="status"><span class="spin"></span>Reading today's rates from Mezo mainnet</div>`;
const failed = () => `
  <div class="loans-status loans-error" role="alert">
    <p>Couldn't reach Mezo mainnet just now. Try again in a moment.</p>
    <button class="btn btn-secondary" type="button" data-retry>Try again</button>
  </div>`;

export function renderLoans(root: HTMLElement) {
  const section = document.createElement("section");
  section.className = "loans";
  section.setAttribute("aria-labelledby", "loans-title");
  section.innerHTML = `
    <div class="loans-inner">
      <h2 id="loans-title">Two Bitcoin loans on Mezo, and no way between them</h2>
      <p class="loans-lead">Mezo lets you borrow against Bitcoin two ways. Both take the same Bitcoin, but they don't talk to each other.</p>
      <div class="loans-grid" aria-live="polite">${loading}</div>
      <p class="loans-source"></p>
      <p class="loans-close">Today, moving from one to the other means repaying the whole loan in cash first. <strong>Debt Switch removes that step.</strong></p>
    </div>`;
  root.appendChild(section);

  const grid = section.querySelector<HTMLDivElement>(".loans-grid")!;
  const source = section.querySelector<HTMLParagraphElement>(".loans-source")!;
  const load = async () => {
    grid.innerHTML = loading;
    source.textContent = "";
    try {
      const f = await readLoanFacts();
      grid.innerHTML = cards(f);
      const time = f.readAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
      source.innerHTML = `Live from Mezo mainnet at ${time} UTC, block <a href="https://explorer.mezo.org/block/${f.block}" target="_blank" rel="noopener">${num(Number(f.block))}</a>`;
    } catch (e) {
      grid.innerHTML = failed();
      grid.querySelector("[data-retry]")?.addEventListener("click", load);
    }
  };
  load();
}
