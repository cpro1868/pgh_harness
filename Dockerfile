# syntax=docker/dockerfile:1
# Purple Grapes Harness (PGH) 生产运行镜像
# 零 Native 编译、零 MSVC/node-gyp 依赖、Node 22 原生特性驱动
FROM node:22-alpine AS runner

WORKDIR /app

# 安装基础运行工具 (git / bash)
RUN apk add --no-cache git bash dumb-init

# 创建低权限非 root 安全用户
RUN addgroup -g 1001 -S pgh && adduser -u 1001 -S pgh -G pgh

# 拷贝全仓必要产物与资源
COPY --chown=pgh:pgh . .

# 暴露数据存储目录并建立属主权限
RUN mkdir -p /home/pgh/.pg_harness && chown -R pgh:pgh /home/pgh/.pg_harness && chmod 700 /home/pgh/.pg_harness

USER pgh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3210

EXPOSE 3210

VOLUME ["/home/pgh/.pg_harness"]

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "--experimental-strip-types", "apps/server/src/index.ts"]
