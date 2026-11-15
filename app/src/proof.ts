import { PAPER } from "./how";

const TX = "https://explorer.test.mezo.org/tx/";
const GITHUB = "https://github.com/mystiquemide/debt-switch";
const SWITCH = "0x99953623d499e44eb606a686bac43b9bbf7d87cd089c7232609cd5b4fbb68bd5";

const proofs = [
  { title: "The switch", body: "A Morpho loan became a fixed-rate MUSD loan in one transaction", href: `${TX}${SWITCH}?tab=token_transfers`, cta: "View transaction" },
  { title: "Too small, refused", body: "A loan under Mezo's 1,800 MUSD minimum was turned away", href: `${TX}0xaf9e00b1c6f240869b02960e8a8bb5314a41b35a3aeab391331c7091a7f1e027`, cta: "View refusal" },
  { title: "Not your loan, refused", body: "Someone tried to switch another person's loan and was stopped", href: `${TX}0xc3d1628ca463dd13b0e4d293d32fc449d519897ac50ac14b7a0e2a68a88b45c8`, cta: "View refusal" },
  { title: "Failed halfway, nothing changed", body: "A real switch ran out of gas. The whole thing undid itself and the loan was untouched.", href: `${TX}0xe27a019f44ee2d1836a2b458579368d13bfcd557317191f3ebb5c2eeda09aebe`, cta: "View transaction" },
  { title: "Tested on Mezo's real contracts", body: "15 tests, both directions, run against Mezo's live MUSD, trove and pool contracts", href: `${GITHUB}/blob/main/test/MorphoToTrove.fork.t.sol`, cta: "Read the tests" },
  { title: "Open source, verified", body: "The code on chain matches the code on GitHub", href: "https://explorer.test.mezo.org/address/0x7bb308048C4C511A4102640eDCD8027c22123af7?tab=contract", cta: "View contract" },
];

export function renderProof(root: HTMLElement) {
  const section = document.createElement("section");
  section.className = "panel-section";
  section.id = "proof";
  section.setAttribute("aria-labelledby", "proof-title");
  section.innerHTML = `
    <div class="panel panel-marigold panel-proof" style="--paper: url('${PAPER}')">
      <figure class="proof-shot">
        <img src="/img/switch-transfers.jpg" width="1391" height="1400" loading="lazy"
          alt="Mezo Testnet explorer showing the switch's token transfers: the flash loan, the Morpho repayment, 0.04 BTC moved, MUSD minted, the swap, and 1,139.25 mUSDC returned to the borrower." />
        <figcaption>Every transfer in the switch, on the Mezo Testnet explorer</figcaption>
      </figure>
      <div class="panel-copy">
        <p class="panel-kicker">Proof</p>
        <h2 id="proof-title">Don't take our word for it</h2>
        <ul class="proof-list">
          ${proofs
            .map(
              (p) => `
            <li>
              <div>
                <h3>${p.title}</h3>
                <p>${p.body}</p>
              </div>
              <a class="btn btn-secondary proof-link" href="${p.href}" target="_blank" rel="noopener">${p.cta}</a>
            </li>`,
            )
            .join("")}
        </ul>
      </div>
    </div>`;
  root.appendChild(section);
}
