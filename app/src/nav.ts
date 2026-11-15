import "./nav.css";

const GITHUB = "https://github.com/mystiquemide/debt-switch";

/** Landing nav: page sections, GitHub and the one "Open the app" action. */
export function renderNav(target: HTMLElement) {
  const links = [
    { href: "#how", label: "How it works" },
    { href: "#proof", label: "Proof" },
    { href: "#limits", label: "Limits" },
    { href: GITHUB, label: "GitHub", external: true },
  ];
  const linkHtml = (l: (typeof links)[number]) =>
    `<a href="${l.href}"${l.external ? ' target="_blank" rel="noopener"' : ""}>${l.label}</a>`;
  const cta = `<a class="btn btn-primary nav-cta" href="/app/">Open the app</a>`;

  target.innerHTML = `
    <div class="nav-wrap">
      <nav class="nav" aria-label="Main">
        <a class="nav-mark" href="/"><img src="/logo.svg" alt="" width="34" height="34" />Debt Switch</a>
        <ul class="nav-links">${links.map((l) => `<li>${linkHtml(l)}</li>`).join("")}</ul>
        ${cta}
        <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav-sheet"><span></span></button>
      </nav>
      <div class="nav-sheet" id="nav-sheet" data-open="false">${links.map(linkHtml).join("")}</div>
    </div>`;

  const toggle = target.querySelector<HTMLButtonElement>(".nav-toggle")!;
  const sheet = target.querySelector<HTMLDivElement>("#nav-sheet")!;
  const setOpen = (open: boolean) => {
    sheet.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  toggle.addEventListener("click", () => setOpen(sheet.dataset.open !== "true"));
  sheet.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).tagName === "A") setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
}

/**
 * App nav: product links only (no landing-page sections, no "Open the app"),
 * with a wallet slot on the right that the app updates as the connection changes.
 */
export function renderAppNav(target: HTMLElement, opts: { demoHref: string; explorerHref: string }) {
  target.innerHTML = `
    <div class="nav-wrap">
      <nav class="nav" aria-label="App">
        <a class="nav-mark" href="/"><img src="/logo.svg" alt="" width="34" height="34" />Debt Switch</a>
        <ul class="nav-links">
          <li><a href="/app/" data-nav="switch">Switch</a></li>
          <li><a href="${opts.demoHref}" data-nav="demo">Demo loan</a></li>
          <li><a href="${opts.explorerHref}" target="_blank" rel="noopener">Explorer</a></li>
        </ul>
        <div class="nav-wallet" data-wallet></div>
        <button class="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav-sheet"><span></span></button>
      </nav>
      <div class="nav-sheet" id="nav-sheet" data-open="false">
        <a href="/app/" data-nav="switch">Switch</a>
        <a href="${opts.demoHref}" data-nav="demo">Demo loan</a>
        <a href="${opts.explorerHref}" target="_blank" rel="noopener">Explorer</a>
      </div>
    </div>`;

  const toggle = target.querySelector<HTMLButtonElement>(".nav-toggle")!;
  const sheet = target.querySelector<HTMLDivElement>("#nav-sheet")!;
  const setOpen = (open: boolean) => {
    sheet.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  toggle.addEventListener("click", () => setOpen(sheet.dataset.open !== "true"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  const slot = target.querySelector<HTMLDivElement>("[data-wallet]")!;
  return {
    /** Mark the current page in the nav. */
    setCurrent(which: "switch" | "demo" | null) {
      target.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => {
        if (a.dataset.nav === which) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      });
    },
    /** Replace the wallet button. Returns the slot so the caller can attach handlers. */
    setWallet(html: string) {
      slot.innerHTML = html;
      return slot;
    },
  };
}
