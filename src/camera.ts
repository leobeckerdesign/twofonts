import gsap from "gsap";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { WORLD, type View } from "./map/lod";

gsap.registerPlugin(Draggable, InertiaPlugin);

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

export class Camera {
  x = 0;
  y = 0;
  scale = 0.4;
  readonly minScale = 0.15;
  readonly maxScale = 3;
  onChange: (() => void) | null = null;

  private drag: Draggable;
  private pinchDist = 0;

  constructor(
    private world: HTMLElement,
    private viewport: HTMLElement,
  ) {
    this.x = (viewport.clientWidth - WORLD * this.scale) / 2;
    this.y = (viewport.clientHeight - WORLD * this.scale) / 2;
    this.apply();

    const camera = this;
    this.drag = Draggable.create(world, {
      inertia: !reducedMotion.matches,
      onPress() {
        gsap.killTweensOf(camera);
      },
      onDrag() {
        camera.x = this.x;
        camera.y = this.y;
        camera.onChange?.();
      },
      onThrowUpdate() {
        camera.x = this.x;
        camera.y = this.y;
        camera.onChange?.();
      },
    })[0];

    viewport.addEventListener("wheel", (event) => this.wheel(event), {
      passive: false,
    });
    viewport.addEventListener("touchstart", (event) => this.pinchStart(event), {
      passive: false,
    });
    viewport.addEventListener("touchmove", (event) => this.pinchMove(event), {
      passive: false,
    });
    viewport.addEventListener("touchend", () => {
      this.pinchDist = 0;
    });
    viewport.addEventListener("touchcancel", () => {
      this.pinchDist = 0;
    });
  }

  view(): View {
    return {
      x: this.x,
      y: this.y,
      scale: this.scale,
      w: this.viewport.clientWidth,
      h: this.viewport.clientHeight,
    };
  }

  flyTo(
    cx: number,
    cy: number,
    scale: number,
    duration = 1.2,
  ): gsap.core.Tween {
    const view = this.view();
    const targetScale = gsap.utils.clamp(this.minScale, this.maxScale, scale);

    return gsap.to(this, {
      x: view.w / 2 - cx * targetScale,
      y: view.h / 2 - cy * targetScale,
      scale: targetScale,
      duration: reducedMotion.matches ? 0 : duration,
      ease: "power3.inOut",
      overwrite: "auto",
      onUpdate: () => {
        this.apply();
        this.drag.update();
      },
    });
  }

  private apply(): void {
    gsap.set(this.world, { x: this.x, y: this.y, scale: this.scale });
    this.onChange?.();
  }

  private wheel(event: WheelEvent): void {
    event.preventDefault();
    gsap.killTweensOf(this);

    const next = gsap.utils.clamp(
      this.minScale,
      this.maxScale,
      this.scale * Math.exp(-event.deltaY * 0.0012),
    );
    const ratio = next / this.scale;

    this.x = event.clientX - (event.clientX - this.x) * ratio;
    this.y = event.clientY - (event.clientY - this.y) * ratio;
    this.scale = next;
    this.apply();
    this.drag.update();
  }

  private static distance(touches: TouchList): number {
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
  }

  private static center(touches: TouchList): { x: number; y: number } {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  private pinchStart(event: TouchEvent): void {
    if (event.touches.length !== 2) return;

    gsap.killTweensOf(this);
    this.pinchDist = Camera.distance(event.touches);
  }

  private pinchMove(event: TouchEvent): void {
    if (event.touches.length !== 2 || this.pinchDist === 0) return;

    event.preventDefault();
    const distance = Camera.distance(event.touches);
    const next = gsap.utils.clamp(
      this.minScale,
      this.maxScale,
      this.scale * (distance / this.pinchDist),
    );
    const ratio = next / this.scale;
    const center = Camera.center(event.touches);

    this.x = center.x - (center.x - this.x) * ratio;
    this.y = center.y - (center.y - this.y) * ratio;
    this.scale = next;
    this.pinchDist = distance;
    this.apply();
    this.drag.update();
  }
}
