import type { PairState } from "./types";

export const DEFAULT_STATE: PairState = {
  a: "Playfair Display",
  b: "Inter",
  lockA: false,
  lockB: false,
  contrast: 0.5,
  text: "Beleza é função",
};

export function encodeState(s: PairState): string {
  const p = new URLSearchParams();
  p.set("a", s.a);
  p.set("b", s.b);
  p.set("c", String(s.contrast));
  if (s.lockA) p.set("la", "1");
  if (s.lockB) p.set("lb", "1");
  if (s.text !== DEFAULT_STATE.text) p.set("t", s.text);
  return p.toString();
}

export function decodeState(qs: string): PairState {
  const p = new URLSearchParams(qs);
  const c = Number(p.get("c"));
  return {
    a: p.get("a") ?? DEFAULT_STATE.a,
    b: p.get("b") ?? DEFAULT_STATE.b,
    lockA: p.get("la") === "1",
    lockB: p.get("lb") === "1",
    contrast: Number.isFinite(c) && p.get("c") !== null
      ? Math.min(1, Math.max(0, c))
      : DEFAULT_STATE.contrast,
    text: p.get("t") ?? DEFAULT_STATE.text,
  };
}
