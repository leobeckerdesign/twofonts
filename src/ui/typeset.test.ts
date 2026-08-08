import { describe, expect, it } from "vitest";
import type { FontMeta } from "../types";
import {
  CASE_MODES,
  clampTo,
  defaultState,
  LIMITS,
  nearestRole,
  rolesOf,
  slotCss,
} from "./typeset";

/**
 * O que o editor lateral decide sem ver a tela.
 *
 * Duas dessas regras existem por causa de defeito visível: um controle que
 * aceita valor fora da faixa mostra um título de 900px que sai do painel, e um
 * peso que a família não tem faz o navegador FALSIFICAR o negrito — a amostra
 * deixa de ser a fonte, que é a única coisa que o app tem para vender.
 */

const font = (f: string, w: FontMeta["w"]): FontMeta => ({ f, c: "Sans Serif", w });

const TRES = font("Inter", { light: 300, regular: 400, bold: 700 });
const SEM_BOLD = font("Magra", { light: 300, regular: 400 });
const SO_REGULAR = font("Lustria", { regular: 400 });
const EXTREMOS = font("Oswald", { light: 200, bold: 700 });

describe("clampTo", () => {
  it("prende nas duas pontas da faixa", () => {
    expect(clampTo(9999, LIMITS.title.size)).toBe(LIMITS.title.size.max);
    expect(clampTo(-40, LIMITS.title.size)).toBe(LIMITS.title.size.min);
  });

  it("cai no mínimo quando o valor não é número", () => {
    expect(clampTo(Number.NaN, LIMITS.body.size)).toBe(LIMITS.body.size.min);
    expect(clampTo(Number.POSITIVE_INFINITY, LIMITS.body.leading)).toBe(LIMITS.body.leading.max);
  });

  it("arredonda ao passo do controle", () => {
    expect(clampTo(56.4, LIMITS.title.size)).toBe(56);
    expect(clampTo(1.374, LIMITS.body.leading)).toBe(1.37);
  });

  it("não devolve lixo binário — o valor vai para o CSS como está", () => {
    for (let raw = LIMITS.body.leading.min; raw <= LIMITS.body.leading.max; raw += 0.007) {
      const value = clampTo(raw, LIMITS.body.leading);
      expect(String(value).replace("-", "").replace(".", "").length).toBeLessThanOrEqual(3);
    }
  });
});

describe("nearestRole", () => {
  it("mantém o papel quando a família o tem", () => {
    expect(nearestRole(TRES, "bold")).toBe("bold");
    expect(nearestRole(TRES, "light")).toBe("light");
  });

  it("cai para o vizinho quando falta a faixa", () => {
    expect(nearestRole(SEM_BOLD, "bold")).toBe("regular");
    expect(nearestRole(SO_REGULAR, "light")).toBe("regular");
    expect(nearestRole(SO_REGULAR, "bold")).toBe("regular");
  });

  it("empate fica com o mais pesado", () => {
    // light e bold ficam à mesma distância de regular; o texto aguenta melhor
    // um peso a mais do que um a menos.
    expect(nearestRole(EXTREMOS, "regular")).toBe("bold");
  });

  it("devolve o pedido quando não há fonte nem pesos", () => {
    expect(nearestRole(undefined, "bold")).toBe("bold");
    expect(nearestRole(font("Vazia", {}), "light")).toBe("light");
  });
});

describe("rolesOf", () => {
  it("lista só o que existe, na ordem tipográfica", () => {
    expect(rolesOf(TRES)).toEqual(["light", "regular", "bold"]);
    expect(rolesOf(SEM_BOLD)).toEqual(["light", "regular"]);
    expect(rolesOf(undefined)).toEqual([]);
  });
});

describe("defaultState", () => {
  it("abre nos pesos do corte, não num padrão fixo", () => {
    const state = defaultState(["bold", "light"]);
    expect(state.title.weight).toBe("bold");
    expect(state.body.weight).toBe("light");
  });

  it("abre com os dois campos preenchidos e dentro dos limites", () => {
    const state = defaultState(["regular", "regular"]);
    expect(state.title.text.length).toBeGreaterThan(0);
    expect(state.body.text.length).toBeGreaterThan(0);
    for (const name of ["title", "body"] as const) {
      const slot = state[name];
      expect(clampTo(slot.size, LIMITS[name].size)).toBe(slot.size);
      expect(clampTo(slot.leading, LIMITS[name].leading)).toBe(slot.leading);
      expect(CASE_MODES).toContain(slot.caps);
    }
  });
});

describe("slotCss", () => {
  const state = defaultState(["bold", "regular"]);

  it("traduz o papel em peso NUMÉRICO da família", () => {
    expect(slotCss("title", state.title, TRES).fontWeight).toBe("700");
    // A família não tem negrito: sai o peso real dela, nunca um 700 inventado.
    expect(slotCss("title", state.title, SEM_BOLD).fontWeight).toBe("400");
  });

  it("mantém a pilha de reserva do palco", () => {
    expect(slotCss("title", state.title, TRES).fontFamily).toBe('"Inter", serif');
    expect(slotCss("body", state.body, TRES).fontFamily).toBe('"Inter", sans-serif');
  });

  it("sobrevive a par ainda não carregado", () => {
    expect(slotCss("body", state.body, undefined).fontFamily).toBe("sans-serif");
  });

  it("traduz a caixa", () => {
    expect(slotCss("title", { ...state.title, caps: "upper" }, TRES).textTransform)
      .toBe("uppercase");
    expect(slotCss("title", { ...state.title, caps: "lower" }, TRES).textTransform)
      .toBe("lowercase");
    expect(slotCss("title", state.title, TRES).textTransform).toBe("none");
  });

  it("leva corpo e entrelinha com unidade certa", () => {
    const css = slotCss("title", { ...state.title, size: 72, leading: 1.1 }, TRES);
    expect(css.fontSize).toBe("72px");
    expect(css.lineHeight).toBe("1.1");
  });
});
