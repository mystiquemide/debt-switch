import "./panels.css";

export const PAPER =
  "https://images.unsplash.com/photo-1711107759674-9161698e570d?auto=format&fit=crop&q=70&w=1600"; // Plufow Le Studio, Unsplash License

const steps = [
  {
    n: "1",
    title: "Approve",
    body: "Let Debt Switch manage your Morpho loan. You can turn this off any time from the app.",
  },
  {
    n: "2",
    title: "Sign",
    body: "Sign Mezo's own message for your new loan. It locks the amount, the Bitcoin and a deadline, so nothing else can be done with it.",
  },
  {
    n: "3",
    title: "Switch",
    body: "One transaction moves everything. If any part of it fails, nothing changes and your Morpho loan stays as it was.",
  },
];

export function renderHow(root: HTMLElement) {
  const section = document.createElement("section");
  section.className = "panel-section";
  section.id = "how";
  section.setAttribute("aria-labelledby", "how-title");
  section.innerHTML = `
    <div class="panel panel-periwinkle" style="--paper: url('${PAPER}')">
      <div class="panel-copy">
        <p class="panel-kicker">How it works</p>
        <h2 id="how-title">Three steps, one transaction</h2>
        <p class="panel-lead">You don't need any stablecoins and you don't repay anything yourself. Debt Switch borrows what's needed for a moment and settles it inside the same transaction.</p>
        <a class="btn btn-primary" href="/app/">Open the app</a>
      </div>
      <ol class="steps">
        ${steps
          .map(
            (s) => `
          <li class="step">
            <span class="step-n" aria-hidden="true">${s.n}</span>
            <div>
              <h3>${s.title}</h3>
              <p>${s.body}</p>
            </div>
          </li>`,
          )
          .join("")}
      </ol>
    </div>`;
  root.appendChild(section);
}
