@echo off
echo 🚀 Quick Deploy User Guide to EC2
echo.

set /p EC2_HOST="Enter your EC2 IP address: "
set /p PEM_PATH="Enter path to your .pem key file: "

echo.
echo 📤 Deploying to %EC2_HOST%...

powershell -ExecutionPolicy Bypass -File "deploy-user-guide-to-ec2.ps1" -EC2_HOST "%EC2_HOST%" -PEM_KEY_PATH "%PEM_PATH%"

echo.
pause