# ---- 构建前端静态资源 ----
FROM node:22-alpine AS build
WORKDIR /web
COPY package.json ./
RUN npm install
COPY . .
RUN npx vite build

# ---- 运行：由 nginx 托管静态资源并反代后端 ----
FROM nginx:alpine
COPY --from=build /web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
