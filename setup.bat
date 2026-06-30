@echo off
echo ======================================
echo  Atlas Capture Tool - Setup
echo ======================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Download Python 3.10+ from https://python.org
    pause
    exit /b 1
)

echo [1/3] Installing Python dependencies...
pip install opencv-python-headless requests python-dotenv
if errorlevel 1 (
    echo ERROR: Failed to install Python packages.
    pause
    exit /b 1
)

echo.
echo [2/3] Installing Node.js dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed. Make sure Node.js is installed.
    pause
    exit /b 1
)

echo.
echo [3/3] Setup complete!
echo.
echo To run the app in development:
echo   npm run dev
echo.
echo To build a Windows installer:
echo   npm run dist
echo.
pause
