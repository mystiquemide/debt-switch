import "./cta.css";
import { PAPER } from "./how";

export function renderCta(root: HTMLElement) {
  const section = document.createElement("section");
  section.className = "cta";
  section.setAttribute("aria-labelledby", "cta-title");
  section.innerHTML = `
    <div class="cta-wrap">
      <div class="cta-band" style="--paper: url('${PAPER}')">
        <h2 id="cta-title">Try it on testnet, or check a mainnet loan</h2>
        <p>Switch a free test loan on Mezo Testnet, or see what switching a real Mezo mainnet loan would look like.</p>
        <div class="cta-buttons">
          <a class="btn btn-primary" href="/app/">Open the app</a>
          <a class="btn btn-secondary" href="/app/?network=mainnet">Check a mainnet loan</a>
        </div>
      </div>
    </div>`;
  root.appendChild(section);
}
