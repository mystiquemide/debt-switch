import "./cta.css";
import { PAPER } from "./how";

export function renderCta(root: HTMLElement) {
  const section = document.createElement("section");
  section.className = "cta";
  section.setAttribute("aria-labelledby", "cta-title");
  section.innerHTML = `
    <div class="cta-wrap">
      <div class="cta-band" style="--paper: url('${PAPER}')">
        <h2 id="cta-title">Try it on Mezo Testnet</h2>
        <p>You'll need a browser wallet and some testnet BTC. Both are free.</p>
        <div class="cta-buttons">
          <a class="btn btn-primary" href="/app/">Open the app</a>
          <a class="btn btn-secondary" href="https://faucet.test.mezo.org/" target="_blank" rel="noopener">Get testnet BTC</a>
        </div>
      </div>
    </div>`;
  root.appendChild(section);
}
