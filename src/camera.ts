import gsap from "gsap";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { WORLD, type View } from "./map/lod";

gsap.registerPlugin(Draggable, InertiaPlugin);

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Margem de overscroll, em pixels de tela. */
export const CAMERA_EDGE_MARGIN = 96;

export interface CameraPoint {
  x: number;
  y: number;
}

export interface CameraTransform {
  x: number;
  y: number;
  scale: number;
}

export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function axisBounds(
  worldSize: number,
  viewportSize: number,
  edgeMargin: number,
): { min: number; max: number } {
  if (worldSize <= viewportSize) {
    // O mundo permanece 100% visível, mas ainda pode se deslocar dentro da
    // sobra do viewport. Isso preserva o foco do wheel/pinch e permite que um
    // flyTo centralize pontos mesmo no zoom mínimo.
    return { min: 0, max: viewportSize - worldSize };
  }

  const margin = Math.min(Math.max(edgeMargin, 0), viewportSize / 2);
  return {
    min: viewportSize - worldSize - margin,
    max: margin,
  };
}

/** Bounds em coordenadas de tela para a escala e o viewport atuais. */
export function cameraBounds(
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
  edgeMargin = CAMERA_EDGE_MARGIN,
): CameraBounds {
  const worldSize = WORLD * scale;
  const horizontal = axisBounds(worldSize, viewportWidth, edgeMargin);
  const vertical = axisBounds(worldSize, viewportHeight, edgeMargin);

  return {
    minX: horizontal.min,
    maxX: horizontal.max,
    minY: vertical.min,
    maxY: vertical.max,
  };
}

/**
 * Mantém o mesmo ponto do mundo sob o foco. `from` é o foco no frame
 * anterior e `to` o foco atual; quando diferem, o gesto também faz pan.
 */
export function zoomTransform(
  transform: CameraTransform,
  from: CameraPoint,
  to: CameraPoint,
  nextScale: number,
): CameraTransform {
  const ratio = nextScale / transform.scale;
  return {
    x: to.x - (from.x - transform.x) * ratio,
    y: to.y - (from.y - transform.y) * ratio,
    scale: nextScale,
  };
}

/** Limita a câmera sem permitir que o mundo desapareça do viewport. */
export function constrainCamera(
  transform: CameraTransform,
  viewportWidth: number,
  viewportHeight: number,
  edgeMargin = CAMERA_EDGE_MARGIN,
): CameraTransform {
  const bounds = cameraBounds(
    transform.scale,
    viewportWidth,
    viewportHeight,
    edgeMargin,
  );

  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, transform.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, transform.y)),
    scale: transform.scale,
  };
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia(REDUCED_MOTION_QUERY).matches;
}

export class Camera {
  x = 0;
  y = 0;
  scale = 0.4;
  readonly minScale = 0.15;
  readonly maxScale = 3;
  onChange: (() => void) | null = null;

  private drag: Draggable;
  private pinchDist = 0;
  private pinchCenter: CameraPoint | null = null;

  constructor(
    private world: HTMLElement,
    private viewport: HTMLElement,
  ) {
    this.x = (viewport.clientWidth - WORLD * this.scale) / 2;
    this.y = (viewport.clientHeight - WORLD * this.scale) / 2;
    this.apply();

    const camera = this;
    this.drag = Draggable.create(world, {
      bounds: this.currentBounds(),
      dragClickables: false,
      inertia: !prefersReducedMotion(),
      onPress() {
        camera.interruptMotion();
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
    viewport.addEventListener("touchend", (event) => this.pinchEnd(event));
    viewport.addEventListener("touchcancel", () => this.resetPinch());
    addEventListener("resize", () => this.resize());
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
    this.interruptMotion();

    const view = this.view();
    const targetScale = gsap.utils.clamp(this.minScale, this.maxScale, scale);
    const target = constrainCamera(
      {
        x: view.w / 2 - cx * targetScale,
        y: view.h / 2 - cy * targetScale,
        scale: targetScale,
      },
      view.w,
      view.h,
    );

    return gsap.to(this, {
      ...target,
      duration: prefersReducedMotion() ? 0 : duration,
      ease: "power3.inOut",
      overwrite: "auto",
      onUpdate: () => this.apply(true),
    });
  }

  private currentBounds(): CameraBounds {
    return cameraBounds(
      this.scale,
      this.viewport.clientWidth,
      this.viewport.clientHeight,
    );
  }

  /**
   * Para qualquer mutação fora do Draggable, encerra primeiro o throw atual.
   * O snapshot vem do Draggable porque ele é a autoridade enquanto a inércia
   * está rodando; depois disso Camera volta a ser a única escritora de x/y.
   */
  private interruptMotion(): void {
    gsap.killTweensOf(this);

    if (this.drag) {
      this.x = this.drag.x;
      this.y = this.drag.y;
      this.drag.tween?.kill();
    }
  }

  private apply(syncDrag = false): void {
    const bounded = constrainCamera(
      this,
      this.viewport.clientWidth,
      this.viewport.clientHeight,
    );
    this.x = bounded.x;
    this.y = bounded.y;

    gsap.set(this.world, { x: this.x, y: this.y, scale: this.scale });

    if (syncDrag) {
      this.drag.update();
      this.drag.applyBounds(this.currentBounds());
      this.x = this.drag.x;
      this.y = this.drag.y;
    }

    this.onChange?.();
  }

  private pointInViewport(clientX: number, clientY: number): CameraPoint {
    const rect = this.viewport.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private wheel(event: WheelEvent): void {
    event.preventDefault();
    this.interruptMotion();

    const nextScale = gsap.utils.clamp(
      this.minScale,
      this.maxScale,
      this.scale * Math.exp(-event.deltaY * 0.0012),
    );
    const focus = this.pointInViewport(event.clientX, event.clientY);
    const next = zoomTransform(this, focus, focus, nextScale);

    this.x = next.x;
    this.y = next.y;
    this.scale = next.scale;
    this.apply(true);
  }

  private static distance(touches: TouchList): number {
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    );
  }

  private touchCenter(touches: TouchList): CameraPoint {
    return this.pointInViewport(
      (touches[0].clientX + touches[1].clientX) / 2,
      (touches[0].clientY + touches[1].clientY) / 2,
    );
  }

  private pinchStart(event: TouchEvent): void {
    if (event.touches.length !== 2) return;

    event.preventDefault();
    this.interruptMotion();
    this.pinchDist = Camera.distance(event.touches);
    this.pinchCenter = this.touchCenter(event.touches);
  }

  private pinchMove(event: TouchEvent): void {
    if (
      event.touches.length !== 2 ||
      this.pinchDist === 0 ||
      this.pinchCenter === null
    ) {
      return;
    }

    event.preventDefault();
    const distance = Camera.distance(event.touches);
    if (distance === 0) return;

    const nextScale = gsap.utils.clamp(
      this.minScale,
      this.maxScale,
      this.scale * (distance / this.pinchDist),
    );
    const center = this.touchCenter(event.touches);
    const next = zoomTransform(
      this,
      this.pinchCenter,
      center,
      nextScale,
    );

    this.x = next.x;
    this.y = next.y;
    this.scale = next.scale;
    this.pinchDist = distance;
    this.pinchCenter = center;
    this.apply(true);
  }

  private pinchEnd(event: TouchEvent): void {
    if (event.touches.length === 2) {
      this.pinchDist = Camera.distance(event.touches);
      this.pinchCenter = this.touchCenter(event.touches);
      return;
    }

    this.resetPinch();
  }

  private resetPinch(): void {
    this.pinchDist = 0;
    this.pinchCenter = null;
  }

  private resize(): void {
    this.interruptMotion();
    this.apply(true);
  }
}
