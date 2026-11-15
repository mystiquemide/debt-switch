import "./footer.css";

const GITHUB = "https://github.com/mystiquemide/debt-switch";
const ext = 'target="_blank" rel="noopener"';

const cols = [
  {
    title: "Product",
    links: [
      { label: "Open the app", href: "/app/" },
      { label: "How it works", href: "/#how" },
      { label: "Proof", href: "/#proof" },
      { label: "Limits", href: "/#limits" },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "GitHub", href: GITHUB, external: true },
      { label: "Judge guide", href: `${GITHUB}/blob/main/JUDGE.md`, external: true },
      { label: "Deck", href: `${GITHUB}/blob/main/docs/Debt-Switch-deck.pdf`, external: true },
    ],
  },
  {
    title: "Mezo",
    links: [
      { label: "Mezo", href: "https://mezo.org", external: true },
      { label: "Testnet explorer", href: "https://explorer.test.mezo.org", external: true },
      { label: "Testnet faucet", href: "https://faucet.test.mezo.org", external: true },
    ],
  },
  {
    title: "Photos on Unsplash",
    links: [
      { label: "Sky by EchoedLightStudio", href: "https://unsplash.com/photos/wispy-clouds-drift-across-a-pale-blue-sky-lIMknT790lk", external: true },
      { label: "Clouds by Linus Belanger", href: "https://unsplash.com/photos/fluffy-white-clouds-drift-against-a-deep-blue-sky-CK3hWcz83ls", external: true },
      { label: "Paper by Plufow Le Studio", href: "https://unsplash.com/photos/an-old-piece-of-paper-with-torn-edges-ICLgWINOp_A", external: true },
      { label: "Coins by Art Rachen", href: "https://unsplash.com/photos/9qk_7C6UlPo", external: true },
    ],
  },
];

export function renderFooter(root: HTMLElement) {
  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-brand">
        <a class="footer-mark" href="/"><img src="/logo-light.svg" alt="" width="36" height="36" />Debt Switch</a>
        <p>Change your Bitcoin loan on Mezo without paying it back first.</p>
      </div>
      <nav class="footer-cols" aria-label="Footer">
        ${cols
          .map(
            (c) => `
          <div>
            <h2>${c.title}</h2>
            <ul>${c.links.map((l) => `<li><a href="${l.href}" ${"external" in l ? ext : ""}>${l.label}</a></li>`).join("")}</ul>
          </div>`,
          )
          .join("")}
      </nav>
    </div>
    <div class="footer-base">
      <span>© ${new Date().getFullYear()} Debt Switch</span>
      <span>Built by MystiqueMide</span>
      <a href="${GITHUB}/blob/main/LICENSE" ${ext}>GPL-2.0-or-later</a>
    </div>`;
  root.appendChild(footer);
}
