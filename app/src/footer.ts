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
    title: "Mezo",
    links: [
      { label: "Mezo", href: "https://mezo.org", external: true },
      { label: "Testnet explorer", href: "https://explorer.test.mezo.org", external: true },
      { label: "Testnet faucet", href: "https://faucet.test.mezo.org", external: true },
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
        <p>Change your Bitcoin loan on Mezo without paying it back first</p>
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
    </div>`;
  root.appendChild(footer);
}
