import "./mezo.css";
import deployments from "../../deployments/31611.json";

const EXPLORER = "https://explorer.test.mezo.org/address/";
const m = deployments.mezo;

const icon = (path: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const parts = [
  {
    name: "MUSD",
    role: "Your new loan. Mezo mints it inside the switch, at a fixed rate.",
    address: m.musd,
    icon: icon('<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5h4a2 2 0 0 1 0 4h-3a2 2 0 0 0 0 4h4M12 7.5v1.5m0 9v-1.5"/>'),
  },
  {
    name: "Trove signatures",
    role: "Mezo's own way to open a loan in your name from your signed message.",
    address: m.borrowerOperationsSignatures,
    icon: icon('<path d="M4 18c3-1 4-6 6-6s1 5 3 5 2-3 4-3 2 2 3 2"/><path d="M4 21h16"/>'),
  },
  {
    name: "PriceFeed",
    role: "One Bitcoin price for both loans, so your collateral is valued the same way.",
    address: m.priceFeed,
    icon: icon('<path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/>'),
  },
  {
    name: "Mezo Pools",
    role: "Swaps the new MUSD back to mUSDC so the borrowed amount can be returned.",
    address: m.musdMusdcPool,
    icon: icon('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  },
];

const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

export function renderMezo(root: HTMLElement) {
  const section = document.createElement("section");
  section.className = "mezo";
  section.setAttribute("aria-labelledby", "mezo-title");
  section.innerHTML = `
    <div class="mezo-inner">
      <h2 id="mezo-title">Built from Mezo's own parts</h2>
      <p class="mezo-lead">Debt Switch doesn't add a new lending protocol. Every step uses contracts Mezo already runs.</p>
      <ul class="mezo-grid">
        ${parts
          .map(
            (p) => `
          <li class="mezo-card">
            <span class="mezo-icon">${p.icon}</span>
            <h3>${p.name}</h3>
            <p>${p.role}</p>
            <a href="${EXPLORER}${p.address}" target="_blank" rel="noopener">${short(p.address)} on the explorer</a>
          </li>`,
          )
          .join("")}
      </ul>
    </div>`;
  root.appendChild(section);
}
