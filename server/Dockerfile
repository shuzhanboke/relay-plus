# ---- 构建阶段 ----
FROM node:22-alpine AS build
WORKDIR /app

# 安装依赖
COPY package.json ./
RUN npm install

# 编译 TS
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

# ---- 运行阶段 ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
