FROM node:22-alpine AS build

WORKDIR /app

COPY frontend/package.json /app/package.json
COPY frontend/package-lock.json /app/package-lock.json
COPY frontend/tsconfig.json /app/tsconfig.json
COPY frontend/tsconfig.node.json /app/tsconfig.node.json
COPY frontend/postcss.config.js /app/postcss.config.js
COPY frontend/tailwind.config.ts /app/tailwind.config.ts
COPY frontend/vite.config.ts /app/vite.config.ts
COPY frontend/index.html /app/index.html
COPY frontend/src /app/src

RUN npm ci
RUN npm run build

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
