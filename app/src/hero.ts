import "./hero.css";

const UNSPLASH = "https://images.unsplash.com";
const SKY = `${UNSPLASH}/photo-1775026880385-08b21b96b3b9`; // EchoedLightStudio, Unsplash License
const CLOUDS = `${UNSPLASH}/photo-1752864365582-cb1072c38622`; // Linus Belanger, Unsplash License
const img = (base: string, w: number) => `${base}?auto=format&fit=crop&q=80&w=${w}`;
const srcset = (base: string, widths: number[]) => widths.map((w) => `${img(base, w)} ${w}w`).join(", ");

export const DEMO_BORROWER = "0x5c64aCAa8AB6AE0b9386afF5339C23CE54E067B4";

export function renderHero(root: HTMLElement) {
  const hero = document.createElement("section");
  hero.className = "hero";
  hero.setAttribute("aria-labelledby", "hero-title");
  hero.innerHTML = `
    <img class="hero-sky" src="${img(SKY, 1920)}" srcset="${srcset(SKY, [960, 1440, 1920, 2560])}" sizes="100vw"
      alt="" fetchpriority="high" />
    <div class="hero-inner">
      <div class="hero-copy">
        <p class="hero-kicker">Live on Mezo Testnet</p>
        <h1 id="hero-title">Change your Bitcoin loan without paying it back first</h1>
        <p class="hero-sub">Move a loan from Morpho's variable rate to Mezo's fixed-rate MUSD in one transaction. No stablecoins needed.</p>
        <div class="hero-ctas">
          <a class="btn btn-primary" href="/app/">Open the app</a>
          <a class="btn btn-secondary" href="/app/?address=${DEMO_BORROWER}">See a real switched loan</a>
        </div>
      </div>
      <div class="hero-collage">
        <img class="hero-cloud hero-cloud-a" src="${img(CLOUDS, 900)}" alt="" loading="eager" />
        <img class="hero-cloud hero-cloud-b" src="${img(CLOUDS, 700)}" alt="" loading="eager" />
        <figure class="hero-shot">
          <img src="/img/after-switch.jpg" width="1520" height="1048"
            alt="The Debt Switch app after a real testnet switch: Your loan is now fixed at 1.00%. The Morpho loan is gone and a 2,000 MUSD loan backed by 0.04 BTC is open at 1.00% fixed." />
        </figure>
        <p class="hero-note">One approval. One signature. One transaction.</p>
      </div>
    </div>
    <svg class="hero-tear" viewBox="0 0 1440 64" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 64V30 L36 18 L74 34 L101 16 L153 31 L182 25 L226 15 L281 30 L313 15 L341 27 L380 16 L413 16 L456 27 L483 32 L512 21 L558 34 L602 15 L646 32 L684 15 L717 15 L760 18 L795 27 L825 31 L854 32 L889 31 L941 35 L972 17 L1016 32 L1062 20 L1099 17 L1142 36 L1170 32 L1197 33 L1229 29 L1276 31 L1315 38 L1351 28 L1395 28 L1432 23 L1440 19 V64z" fill="var(--canvas)"/>
    </svg>`;
  root.appendChild(hero);
}
