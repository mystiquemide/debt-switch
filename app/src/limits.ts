import "./limits.css";

const items = [
  {
    q: "Loans under 1,800 MUSD get sized up",
    a: "Mezo's fixed-rate loans start at 1,800 MUSD. If your Morpho loan is smaller, your new loan is opened at that minimum and the extra comes back to your wallet as mUSDC. You'll see the exact amounts before you sign anything.",
  },
  {
    q: "Pool size limits big switches today",
    a: "The switch swaps MUSD to mUSDC on Mezo Pools. That pool is small right now, so very large loans would lose too much in the swap. The app shows the live swap rate in the preview, and a switch that can't cover your loan is refused before it starts.",
  },
  {
    q: "Mainnet switching waits for an audit",
    a: "Both switches pass against Mezo mainnet's real Morpho market, troves and pool on a mainnet fork, and the app reads real mainnet loans and prices their switch live. Sending a switch on mainnet opens after a security audit. Until then you can switch a test loan on Mezo Testnet.",
  },
  {
    q: "Moving back to Morpho isn't live yet",
    a: "The app moves a Morpho loan into a fixed-rate MUSD loan. The reverse, an MUSD loan back to Morpho, is built and tested against Mezo's real contracts, and goes live in the app once the testnet market has enough liquidity for it.",
  },
  {
    q: "You can turn off access any time",
    a: "The approval you give Morpho lets Debt Switch act on your loan only during a switch, and only when you send it. After a switch, the app offers a one-click button to turn that access off.",
  },
];

export function renderLimits(root: HTMLElement) {
  const section = document.createElement("section");
  section.className = "limits";
  section.id = "limits";
  section.setAttribute("aria-labelledby", "limits-title");
  section.innerHTML = `
    <div class="limits-inner">
      <h2 id="limits-title">Good to know before you switch</h2>
      <div class="limits-list">
        ${items
          .map(
            (it, i) => `
          <details class="limit"${i === 0 ? " open" : ""}>
            <summary><span>${it.q}</span><span class="limit-icon" aria-hidden="true"></span></summary>
            <p>${it.a}</p>
          </details>`,
          )
          .join("")}
      </div>
    </div>`;
  root.appendChild(section);
}
