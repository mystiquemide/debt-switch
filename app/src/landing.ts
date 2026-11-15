// Old links pointed read-only views at the landing page (/?address=0x...). Send them to the app.
if (new URLSearchParams(location.search).has("address")) {
  location.replace(`/app/${location.search}`);
}

import "./tokens.css";
import { renderNav } from "./nav";
import { renderHero } from "./hero";
import { renderLoans } from "./loans";
import { renderHow } from "./how";
import { renderInside } from "./inside";
import { renderMezo } from "./mezo";
import { renderProof } from "./proof";
import { renderLimits } from "./limits";
import { renderCta } from "./cta";
import { renderFooter } from "./footer";

renderNav(document.querySelector<HTMLDivElement>("#nav")!);

const landing = document.querySelector<HTMLElement>("#landing")!;
renderHero(landing);
renderLoans(landing);
renderHow(landing);
renderInside(landing);
renderMezo(landing);
renderProof(landing);
renderLimits(landing);
renderCta(landing);
renderFooter(document.body.insertBefore(document.createElement("div"), landing.nextSibling));
