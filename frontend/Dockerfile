# FellaRide web app: build with Vite, serve the static files with nginx.
# VITE_API_URL is baked in at build time (docker compose / Render pass it as a build arg).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine
# nginx fills ${PORT} into the template at start (Render sets PORT; 80 otherwise)
ENV PORT=80
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# files checked out on Windows can lose read permission for the nginx user
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
