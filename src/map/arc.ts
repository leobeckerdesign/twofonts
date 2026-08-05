import gsap from "gsap";
import type { FontEntry } from "../types";
import { WORLD } from "./lod";

const NS = "http://www.w3.org/2000/svg";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export class Arc {
  private readonly path = document.createElementNS(NS, "path");
  private animation: gsap.core.Tween | null = null;

  constructor(layer: SVGSVGElement) {
    this.path.setAttribute("fill", "none");
    this.path.setAttribute("stroke", "var(--accent)");
    this.path.setAttribute("stroke-width", "2");
    this.path.setAttribute("vector-effect", "non-scaling-stroke");
    this.path.setAttribute("aria-hidden", "true");
    this.path.style.opacity = "0";
    layer.appendChild(this.path);
  }

  show(from: FontEntry, to: FontEntry): void {
    this.cancelAnimation();

    const x1 = from.x * WORLD;
    const y1 = from.y * WORLD;
    const x2 = to.x * WORLD;
    const y2 = to.y * WORLD;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    // Controle perpendicular: a barriga cresce junto com a distância do par.
    const cx = mx - dy * 0.18;
    const cy = my + dx * 0.18;
    this.path.setAttribute("d", `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);

    if (prefersReducedMotion()) {
      gsap.set(this.path, {
        opacity: 1,
        strokeDasharray: "none",
        strokeDashoffset: 0,
      });
      return;
    }

    const fallbackLength = Math.max(1, Math.hypot(dx, dy) * 1.1);
    const measuredLength = typeof this.path.getTotalLength === "function"
      ? this.path.getTotalLength()
      : fallbackLength;
    const total = Number.isFinite(measuredLength) && measuredLength > 0
      ? measuredLength
      : fallbackLength;

    this.animation = gsap.fromTo(
      this.path,
      {
        strokeDasharray: `${total} ${total}`,
        strokeDashoffset: total,
        opacity: 1,
      },
      {
        strokeDashoffset: 0,
        duration: 0.9,
        ease: "power2.inOut",
        overwrite: true,
      },
    );
  }

  hide(): void {
    this.cancelAnimation();

    if (prefersReducedMotion()) {
      gsap.set(this.path, { opacity: 0 });
      return;
    }

    this.animation = gsap.to(this.path, {
      opacity: 0,
      duration: 0.3,
      overwrite: true,
    });
  }

  private cancelAnimation(): void {
    this.animation?.kill();
    this.animation = null;
    gsap.killTweensOf(this.path);
  }
}
