# Static build of the Debt Switch web app, served by nginx. Build context is the repo root
# because the app reads contract addresses from deployments/31611.json.
FROM node:22-alpine AS build
WORKDIR /src
COPY deployments ./deployments
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci --no-audit --no-fund
COPY app ./app
RUN cd app && npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/app/dist /usr/share/nginx/html
EXPOSE 80
