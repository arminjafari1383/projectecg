# مرحله ۱: ساخت پروژه (Build Stage)
FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_BOT_USERNAME=Aipolynetbot
ARG VITE_MINI_APP_SHORT_NAME=app
ARG VITE_API_BASE_URL=
ARG VITE_TONCONNECT_MANIFEST_URL=

ENV VITE_BOT_USERNAME=$VITE_BOT_USERNAME
ENV VITE_MINI_APP_SHORT_NAME=$VITE_MINI_APP_SHORT_NAME
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_TONCONNECT_MANIFEST_URL=$VITE_TONCONNECT_MANIFEST_URL

# نصب وابستگی‌ها
COPY package*.json ./
RUN npm install

# اضافه کردن کد پروژه
COPY . .

# ساخت خروجی نهایی
RUN npm run build

# مرحله ۲: سرو خروجی با Nginx (Production Serve)
FROM nginx:1.25-alpine

# نصب curl برای health check
RUN apk add --no-cache curl

# پاک‌سازی کانفیگ پیش‌فرض Nginx
RUN rm -rf /usr/share/nginx/html/*

# کپی کردن خروجی build به مسیر Nginx
# اگر خروجی در dist است:
COPY --from=build /app/dist /usr/share/nginx/html
# اگر خروجی در build است (بیشتر React پروژه‌ها):
# COPY --from=build /app/build /usr/share/nginx/html

# کپی کانفیگ Nginx (اختیاری)
# COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]