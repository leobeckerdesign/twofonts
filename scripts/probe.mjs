/**
 * Roda as sondas de navegador num Chrome de verdade e falha se alguma acusar.
 *
 * São cinco, e nenhuma é verificável em teste unitário — todas dependem de
 * layout real, fonte real e tempo passando:
 *
 *   transbordo — o campo tira o corpo do título de uma razão de contraste
 *     global que não conhece a largura de cada card, então um display largo no
 *     contraste máximo estoura a caixa.
 *   tremor — `line-height: normal` sai das métricas da fonte, e o app troca de
 *     fonte o tempo todo; qualquer texto de UI sem entrelinha explícita faz a
 *     barra de baixo mudar de tamanho e o campo inteiro tremer.
 *   controle — o slider deixou de ser `<input>`; teclado, ARIA e arrasto viraram
 *     código nosso.
 *   dock — a lente da prateleira é uma mola integrada a cada frame.
 *   editor — o painel entrou num app que já escutava teclado e roda na janela
 *     inteira; cada controle dele é uma chance de rolar o campo ou trocar o par
 *     por acidente.
 *
 * POR QUE CDP, E NÃO `--dump-dom --virtual-time-budget`:
 * sob tempo virtual o Chrome não produz frames, e sem frames não existe
 * `requestAnimationFrame`. Toda a sonda do dock media zero, e as outras mediam
 * um app pela metade — as timelines do GSAP também nunca rodavam. Aqui o Chrome
 * roda em tempo real e a leitura vem por `Runtime.evaluate`.
 *
 * Uso: com o `npm run dev` de pé, `npm run probe`.
 * Variáveis: CHROME para o binário, PROBE_URL para a origem do servidor.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const chrome = CANDIDATES.find((p) => p !== undefined && existsSync(p));
if (chrome === undefined) {
  console.error("Nenhum Chromium encontrado. Aponte um com CHROME=/caminho/do/chrome.");
  process.exit(2);
}

const origin = process.env.PROBE_URL ?? "http://127.0.0.1:5180";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cada sonda devolve `TOTAL <n>` na última linha; n > 0 é falha. */
const SONDAS = [
  {
    nome: "transbordo",
    page: "scripts/overflow-probe.html",
    // Card estreito importa: a mesma palavra tem menos espaço.
    viewports: ["1440,820", "1920,1080", "390,844"],
    unidade: "estouros",
    detalhe: (l) => l.includes("estouros=") && !l.includes("estouros=0"),
    veredito: (n) => `${n} texto(s) passando da caixa. O ajuste de corpo não segurou.`,
  },
  {
    nome: "tremor",
    page: "scripts/jitter-probe.html",
    // Um viewport basta: o defeito é de métrica de fonte, não de largura.
    viewports: ["1440,820"],
    unidade: "elementos instáveis",
    detalhe: (l) => l.startsWith("TREME"),
    veredito: (n) => `${n} elemento(s) mudam de tamanho ao trocar de corte. A barra vai tremer.`,
  },
  {
    nome: "controle",
    page: "scripts/control-probe.html",
    viewports: ["1440,820"],
    unidade: "verificações falhas",
    detalhe: (l) => l.startsWith("FALHA"),
    veredito: (n) => `${n} verificação(ões) do slider falharam.`,
  },
  {
    nome: "dock",
    page: "scripts/dock-probe.html",
    viewports: ["1440,820"],
    unidade: "verificações falhas",
    detalhe: (l) => l.startsWith("FALHA"),
    veredito: (n) => `${n} verificação(ões) do dock falharam.`,
  },
  {
    nome: "editor",
    page: "scripts/editor-probe.html",
    // O painel abre em 1/3 da tela, então a largura é a medida em jogo.
    viewports: ["1440,820"],
    unidade: "verificações falhas",
    detalhe: (l) => l.startsWith("FALHA"),
    veredito: (n) => `${n} verificação(ões) do editor falharam.`,
  },
];

async function alvoDaPagina(port, url) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const alvos = await res.json();
      const alvo = alvos.find((t) => t.type === "page" && t.url.startsWith(url));
      if (alvo?.webSocketDebuggerUrl) return alvo.webSocketDebuggerUrl;
    } catch {
      // O Chrome ainda não abriu a porta; tenta de novo.
    }
    await espera(200);
  }
  return null;
}

function conecta(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pendentes = new Map();
    let seq = 0;
    ws.onopen = () => resolve({
      avaliar(expressao) {
        const id = ++seq;
        ws.send(JSON.stringify({
          id, method: "Runtime.evaluate",
          params: { expression: expressao, returnByValue: true, awaitPromise: true },
        }));
        return new Promise((res) => pendentes.set(id, res));
      },
      fecha: () => ws.close(),
    });
    ws.onerror = () => reject(new Error("nao conectou ao Chrome via CDP"));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && pendentes.has(msg.id)) {
        pendentes.get(msg.id)(msg.result?.result?.value);
        pendentes.delete(msg.id);
      }
    };
  });
}

async function corre(page, size, nome) {
  const port = 9333 + Math.floor(Math.random() * 400);
  const [w, h] = size.split(",");
  const proc = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    `--remote-debugging-port=${port}`,
    `--window-size=${w},${h}`,
    `--user-data-dir=${process.env.TEMP ?? "/tmp"}/probe-${port}`,
    `${origin}/${page}`,
  ], { stdio: "ignore" });

  try {
    const wsUrl = await alvoDaPagina(port, `${origin}/${page}`);
    if (!wsUrl) throw new Error(`nao achou a aba — o dev server esta de pe em ${origin}?`);
    const cdp = await conecta(wsUrl);

    // A sonda escreve `TOTAL <n>` na última linha quando termina.
    for (let i = 0; i < 300; i++) {
      const texto = await cdp.avaliar("document.getElementById('out')?.textContent ?? ''");
      if (typeof texto === "string" && /^TOTAL \d+$/m.test(texto)) {
        cdp.fecha();
        return { texto, count: Number(/^TOTAL (\d+)$/m.exec(texto)[1]) };
      }
      await espera(300);
    }
    cdp.fecha();
    throw new Error("a sonda nao chegou ao fim em 90s");
  } finally {
    proc.kill();
  }
}

let failed = 0;
for (const sonda of SONDAS) {
  console.log(`\n— ${sonda.nome} —`);
  let soma = 0;
  for (const size of sonda.viewports) {
    let r;
    try {
      r = await corre(sonda.page, size, sonda.nome);
    } catch (err) {
      console.error(`   ${sonda.page} @ ${size}: ${err.message}`);
      process.exit(2);
    }
    soma += r.count;
    console.log(`viewport ${size.padEnd(10)} ${sonda.unidade}=${r.count}`);
    if (r.count > 0) for (const l of r.texto.split("\n")) if (sonda.detalhe(l)) console.log(`   ${l.trim()}`);
  }
  if (soma > 0) {
    console.error(`   ${sonda.veredito(soma)}`);
    failed += soma;
  }
}

if (failed > 0) process.exit(1);
console.log(
  "\nTudo verde: nada transborda, nada treme, o slider responde, o dock amplia " +
  "e o editor abre sem levar o campo junto.",
);
