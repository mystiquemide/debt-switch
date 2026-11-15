import { PAPER } from "./how";

const SWITCH_TX = "0x99953623d499e44eb606a686bac43b9bbf7d87cd089c7232609cd5b4fbb68bd5";
const TRANSFERS = `https://explorer.test.mezo.org/tx/${SWITCH_TX}?tab=token_transfers`;

// Each amount is the real token transfer from the testnet switch above.
const rows = [
  { title: "Borrow exactly what you owe", body: "Morpho lends the full amount for a moment", amount: "300.00 mUSDC" },
  { title: "Pay off your Morpho loan", body: "Cleared to the last cent, interest included", amount: "300.00 mUSDC" },
  { title: "Move your Bitcoin", body: "Your collateral leaves Morpho", amount: "0.04 BTC" },
  { title: "Open your fixed-rate loan", body: "Mezo opens it in your name, using the message you signed", amount: "1,798.20 MUSD" },
  { title: "Swap to repay", body: "The new MUSD becomes mUSDC on Mezo Pools, and the borrowed amount goes back.", amount: "1,439.25 mUSDC" },
  { title: "Return what's left to you", body: "Debt Switch keeps nothing", amount: "1,139.25 mUSDC" },
];

export function renderInside(root: HTMLElement) {
  const section = document.createElement("section");
  section.className = "panel-section";
  section.setAttribute("aria-labelledby", "inside-title");
  section.innerHTML = `
    <div class="panel panel-mint" style="--paper: url('${PAPER}')">
      <div class="panel-copy">
        <p class="panel-kicker">Inside the one transaction</p>
        <h2 id="inside-title">What happens when you press Switch</h2>
        <p class="panel-lead">Six steps run back to back in a single transaction. The amounts here are from a real switch on Mezo Testnet: a 300 mUSDC Morpho loan becoming an MUSD loan at 1.00% fixed.</p>
        <a class="btn btn-primary" href="${TRANSFERS}" target="_blank" rel="noopener">See it on the explorer</a>
      </div>
      <ol class="flow">
        ${rows
          .map(
            (r, i) => `
          <li class="flow-row">
            <span class="flow-n" aria-hidden="true">${i + 1}</span>
            <div class="flow-text">
              <h3>${r.title}</h3>
              <p>${r.body}</p>
            </div>
            <span class="flow-amount">${r.amount}</span>
          </li>`,
          )
          .join("")}
      </ol>
    </div>`;
  root.appendChild(section);
}
