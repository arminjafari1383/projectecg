@echo off
chcp 65001 >nul
echo.
echo این فایل فقط برای توسعه محلی بود.
echo برای نصب روی VPS راهنمای README.md را دنبال کنید.
echo.
echo خلاصه روی سرور:
echo   1) cp backend/.env.example backend/.env
echo   2) cp .env.example .env
echo   3) cp frontend/.env.example frontend/.env
echo   4) مقادیر واقعی را پر کنید
echo   5) docker-compose build --no-cache ^&^& docker-compose up -d
echo.
pause
