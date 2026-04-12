# Deploy User Guide to EC2 Server
# This script uploads the updated sensor control server with user guide functionality

param(
    [Parameter(Mandatory=$true)]
    [string]$EC2_HOST,
    
    [Parameter(Mandatory=$true)]
    [string]$PEM_KEY_PATH,
    
    [string]$EC2_USER = "ubuntu"
)

Write-Host "🚀 Deploying User Guide to EC2 Server..." -ForegroundColor Green

# Files to deploy
$SERVER_FILE = "sensor-control-ec2-server.js"
$USER_GUIDE_FILE = "user-guide-server.html"
$REMOTE_PATH = "/home/ubuntu/sensor-control"

Write-Host "📁 Preparing files for deployment..." -ForegroundColor Cyan

# Check if files exist
if (!(Test-Path $SERVER_FILE)) {
    Write-Error "❌ Server file not found: $SERVER_FILE"
    exit 1
}

if (!(Test-Path $USER_GUIDE_FILE)) {
    Write-Error "❌ User guide file not found: $USER_GUIDE_FILE"
    exit 1
}

# SCP files to EC2
Write-Host "📤 Uploading server file to EC2..." -ForegroundColor Cyan
scp -i "$PEM_KEY_PATH" "$SERVER_FILE" "${EC2_USER}@${EC2_HOST}:${REMOTE_PATH}/"

Write-Host "📤 Uploading user guide to EC2..." -ForegroundColor Cyan
scp -i "$PEM_KEY_PATH" "$USER_GUIDE_FILE" "${EC2_USER}@${EC2_HOST}:${REMOTE_PATH}/user-guide.html"

# SSH commands to restart the service
Write-Host "🔄 Restarting sensor control service..." -ForegroundColor Cyan
ssh -i "$PEM_KEY_PATH" "${EC2_USER}@${EC2_HOST}" @"
    cd ${REMOTE_PATH}
    
    # Stop existing process
    sudo pkill -f 'sensor-control-ec2-server.js' || true
    
    # Install dependencies if needed
    npm install
    
    # Start service in background
    nohup node sensor-control-ec2-server.js > sensor-control.log 2>&1 &
    
    echo "✅ Sensor control service restarted"
    echo "📋 User guide available at: http://${EC2_HOST}:3002/user-guide"
"@

Write-Host "🎉 Deployment Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Service Information:" -ForegroundColor Yellow
Write-Host "   • Sensor Control API: http://${EC2_HOST}:3002" -ForegroundColor White
Write-Host "   • User Guide: http://${EC2_HOST}:3002/user-guide" -ForegroundColor White
Write-Host "   • Health Check: http://${EC2_HOST}:3002/health" -ForegroundColor White
Write-Host ""
Write-Host "🔍 To check service status:" -ForegroundColor Yellow
Write-Host "   ssh -i `"$PEM_KEY_PATH`" ${EC2_USER}@${EC2_HOST} 'ps aux | grep sensor-control'" -ForegroundColor White
Write-Host ""
Write-Host "📱 Update your React Native app environment:" -ForegroundColor Yellow
Write-Host "   EXPO_PUBLIC_ADMIN_PORTAL_URL=http://${EC2_HOST}:8000" -ForegroundColor White