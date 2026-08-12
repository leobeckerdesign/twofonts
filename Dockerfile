# Imagem estática: o Node só existe para construir, e não vai para a produção.
#
# O que sai daqui é nginx servindo `dist/` — nenhum processo Node no ar, nenhuma
# porta de aplicação, nenhuma dependência de runtime. O site é estático de fato:
# o catálogo de pares é um JSON servido como arquivo, e todo o resto acontece no
# navegador.

# ---------- construção ----------
FROM node:24-alpine AS build

WORKDIR /app

# O manifesto antes do código: enquanto as dependências não mudam, esta camada
# vem do cache e o `npm ci` não roda de novo a cada commit de CSS.
COPY package.json package-lock.json ./
# `ci` e não `install`: instala exatamente o que o lockfile fixa, e falha se os
# dois discordarem, em vez de resolver versões novas silenciosamente no build.
RUN npm ci

COPY . .

# `npm run build` é `node docs/case/build.mjs && vite build`, nessa ordem: a
# página do case é gerada para `public/` ANTES do build da aplicação, que é
# quem copia `public/` para `dist/`. Invertido, a página que vai ao ar seria a
# do commit anterior.
RUN npm run build

# ---------- serviço ----------
FROM nginx:alpine

# O `default.conf` da imagem serve o diretório sem cabeçalho nenhum e sem
# compressão. Ele é substituído, não complementado.
RUN rm -f /etc/nginx/conf.d/default.conf && mkdir -p /etc/nginx/snippets
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Fora de `conf.d/`: o nginx carrega tudo o que casa com `conf.d/*.conf` no
# nível `http`, e o arquivo de cabeçalhos existe para ser incluído à mão dentro
# de cada `location`, não para valer sozinho.
COPY nginx-headers.conf /etc/nginx/snippets/headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Falha o build se a configuração não for válida, em vez de descobrir no deploy.
RUN nginx -t

EXPOSE 80

# O Coolify lê o healthcheck da imagem. Sem ele o contêiner é dado como saudável
# assim que o processo sobe, e um nginx que subiu com a raiz vazia passaria.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
