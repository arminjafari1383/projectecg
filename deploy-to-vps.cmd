@echo off
chcp 65001 >nul
echo.
echo اسکریپت آپلود اختصاصی حذف/غیرفعال شد.
echo مشتری باید خودش طبق README.md روی VPS نصب کند:
echo.
echo   cp backend/.env.example backend/.env
echo   cp .env.example .env
echo   cp frontend/.env.example frontend/.env
echo   docker-compose build --no-cache
echo   docker-compose up -d
echo.
pause
