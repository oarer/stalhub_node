FROM oven/bun:1.4.0 AS build

WORKDIR /app

COPY package.json package.json
RUN bun install

COPY tsconfig.json tsconfig.json
COPY ./src ./src

ENV NODE_ENV=production

RUN bun build \
	--compile \
	--minify-whitespace \
	--minify-syntax \
	--outfile node \
	src/server.ts

FROM oven/bun:1.4.0 AS runtime

WORKDIR /app

COPY --from=build /app/node /app/node

ENV NODE_ENV=production
ENV PORT=3101

EXPOSE 3101

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
	CMD ["bun", "-e", "fetch('http://localhost:3101/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["/app/node"]
