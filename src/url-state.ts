import type { PairState } from "./types";

export const DEFAULT_STATE: PairState = {
  a: "Playfair Display",
  b: "Inter",
  lockA: false,
  lockB: false,
  contrast: 0.5,
  text: "Beleza é função",
};

export const MAX_TEXT_LENGTH = 500;
const MAX_FAMILY_LENGTH = 200;

function familyParam(value: string | null, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, MAX_FAMILY_LENGTH) : fallback;
}

function contrastParam(value: string | null): number {
  if (value === null || value.trim() === "") return DEFAULT_STATE.contrast;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(1, Math.max(0, number))
    : DEFAULT_STATE.contrast;
}

export function encodeState(s: PairState): string {
  const p = new URLSearchParams();
  p.set("a", familyParam(s.a, DEFAULT_STATE.a));
  p.set("b", familyParam(s.b, DEFAULT_STATE.b));
  p.set("c", String(contrastParam(String(s.contrast))));
  if (s.lockA) p.set("la", "1");
  if (s.lockB) p.set("lb", "1");
  if (s.text !== DEFAULT_STATE.text) p.set("t", s.text.slice(0, MAX_TEXT_LENGTH));
  return p.toString();
}

export function decodeState(qs: string): PairState {
  const p = new URLSearchParams(qs);
  return {
    a: familyParam(p.get("a"), DEFAULT_STATE.a),
    b: familyParam(p.get("b"), DEFAULT_STATE.b),
    lockA: p.get("la") === "1",
    lockB: p.get("lb") === "1",
    contrast: contrastParam(p.get("c")),
    text: (p.get("t") ?? DEFAULT_STATE.text).slice(0, MAX_TEXT_LENGTH),
  };
}
