import type { AppState } from "./types";

export const DEFAULT_CONTRAST = 0.5;
const MAX_FAMILY_LENGTH = 200;

export interface UrlState {
  a: string | null;
  b: string | null;
  contrast: number;
}

function familyParam(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, MAX_FAMILY_LENGTH) : null;
}

export function encodeState(state: AppState): string {
  const p = new URLSearchParams();
  p.set("a", state.a.slice(0, MAX_FAMILY_LENGTH));
  p.set("b", state.b.slice(0, MAX_FAMILY_LENGTH));
  p.set("c", state.contrast.toFixed(2));
  return p.toString();
}

/**
 * Lê a querystring sem confiar nela. Contraste presente mas vazio, com espaço
 * ou não numérico volta ao padrão — `Number("")` devolve 0, que passaria como
 * valor válido e daria harmonia total num link truncado.
 *
 * As famílias voltam como `null` quando ausentes: quem chama valida contra o
 * catálogo antes de usar, porque um link antigo pode citar fonte que saiu.
 */
export function decodeState(qs: string): UrlState {
  const p = new URLSearchParams(qs);
  const raw = p.get("c");
  const parsed = raw !== null && raw.trim() !== "" ? Number(raw) : NaN;

  return {
    a: familyParam(p.get("a")),
    b: familyParam(p.get("b")),
    contrast: Number.isFinite(parsed)
      ? Math.min(1, Math.max(0, parsed))
      : DEFAULT_CONTRAST,
  };
}
