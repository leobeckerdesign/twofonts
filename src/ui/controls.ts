import type { PairState } from "../types";

export interface ControlHandlers {
  onGenerate: () => void;
  onContrast: (value: number) => void;
  onToggleLock: (slot: "a" | "b") => void;
}

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='checkbox']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='slider']",
  "[role='textbox']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento obrigatório #${id} não encontrado.`);
  return element as T;
}

function hasAccessibleName(element: HTMLElement): boolean {
  return element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby");
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(INTERACTIVE_SELECTOR) !== null;
}

function isSpace(event: KeyboardEvent): boolean {
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}

export class Controls {
  private readonly generate = requiredElement<HTMLButtonElement>("generate");
  private readonly contrast = requiredElement<HTMLInputElement>("contrast");
  private readonly lockA = requiredElement<HTMLButtonElement>("lock-a");
  private readonly lockB = requiredElement<HTMLButtonElement>("lock-b");
  private removeBinding: (() => void) | null = null;

  constructor() {
    // Evita submits acidentais caso o HUD passe a viver dentro de um form.
    this.generate.type = "button";
    this.lockA.type = "button";
    this.lockB.type = "button";

    if (!hasAccessibleName(this.contrast)) {
      this.contrast.setAttribute("aria-label", "Contraste tipográfico");
    }
    if (!hasAccessibleName(this.lockA)) {
      this.lockA.setAttribute("aria-label", "Travar fonte da manchete");
    }
    if (!hasAccessibleName(this.lockB)) {
      this.lockB.setAttribute("aria-label", "Travar fonte do corpo");
    }
    if (!this.generate.hasAttribute("aria-keyshortcuts")) {
      this.generate.setAttribute("aria-keyshortcuts", "Space");
    }
  }

  /** Substitui bindings anteriores para que reinicializações não dupliquem ações. */
  bind(handlers: ControlHandlers): void {
    this.removeBinding?.();

    const onGenerate = () => handlers.onGenerate();
    const onContrast = () => {
      const value = this.contrast.valueAsNumber;
      if (Number.isFinite(value)) handlers.onContrast(value);
    };
    const onLockA = () => handlers.onToggleLock("a");
    const onLockB = () => handlers.onToggleLock("b");
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !isSpace(event)
        || event.defaultPrevented
        || event.repeat
        || event.isComposing
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || isInteractiveTarget(event.target)
      ) return;

      event.preventDefault();
      handlers.onGenerate();
    };

    this.generate.addEventListener("click", onGenerate);
    this.contrast.addEventListener("input", onContrast);
    this.lockA.addEventListener("click", onLockA);
    this.lockB.addEventListener("click", onLockB);
    window.addEventListener("keydown", onKeyDown);

    this.removeBinding = () => {
      this.generate.removeEventListener("click", onGenerate);
      this.contrast.removeEventListener("input", onContrast);
      this.lockA.removeEventListener("click", onLockA);
      this.lockB.removeEventListener("click", onLockB);
      window.removeEventListener("keydown", onKeyDown);
    };
  }

  sync(state: PairState): void {
    const contrast = Number.isFinite(state.contrast) ? state.contrast : 0.5;
    const min = Number(this.contrast.min || 0);
    const max = Number(this.contrast.max || 1);
    const normalized = Math.min(max, Math.max(min, contrast));

    this.contrast.value = String(normalized);
    this.contrast.setAttribute(
      "aria-valuetext",
      `${Math.round(normalized * 100)}% de contraste`,
    );
    this.syncLock(this.lockA, state.lockA, "headline");
    this.syncLock(this.lockB, state.lockB, "corpo");
  }

  /** Remove listeners; útil em HMR, testes e desmontagem futura do HUD. */
  destroy(): void {
    this.removeBinding?.();
    this.removeBinding = null;
  }

  private syncLock(button: HTMLButtonElement, locked: boolean, slot: string): void {
    button.setAttribute("aria-pressed", String(locked));
    button.classList.toggle("is-locked", locked);
    button.title = `${locked ? "Destravar" : "Travar"} ${slot}`;
  }
}
