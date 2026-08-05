import { defineConfig } from "vite";

// Sem porta fixa: o harness atribui uma via PORT e o Vite a respeita, então
// uma instância órfã na 5173 não bloqueia o próximo start.
export default defineConfig({
  server: {
    port: Number(process.env.PORT) || undefined,
  },
});
