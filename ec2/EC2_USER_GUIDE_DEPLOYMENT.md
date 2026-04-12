# User Guide EC2 Deployment Guide

## What's Been Set Up

✅ **Updated EC2 Server (`sensor-control-ec2-server.js`)**:
- Added `/user-guide` route to serve the HTML guide
- Added `/` root route with API information  
- Added necessary imports (path, fs)

✅ **Updated React Native App (`app/index.tsx`)**:
- "Get Started" button now opens user guide from EC2 server
- Added proper URL handling with Linking API

✅ **User Guide HTML (`user-guide-server.html`)**:
- Mobile-responsive design
- Ready to be served by EC2 server

## Quick Deploy Options

### Option 1: Use the Deployment Scripts
```bash
# Run this batch file and follow prompts
deploy-user-guide.bat
```

### Option 2: Manual SCP Upload
```bash
# Replace with your EC2 details
scp -i "your-key.pem" sensor-control-ec2-server.js ubuntu@YOUR-EC2-IP:/home/ubuntu/sensor-control/
scp -i "your-key.pem" user-guide-server.html ubuntu@YOUR-EC2-IP:/home/ubuntu/sensor-control/user-guide.html

# SSH to restart service
ssh -i "your-key.pem" ubuntu@YOUR-EC2-IP
cd /home/ubuntu/sensor-control
sudo pkill -f 'sensor-control-ec2-server.js'
nohup node sensor-control-ec2-server.js > sensor-control.log 2>&1 &
```

### Option 3: Direct Copy-Paste
1. SSH into your EC2 instance
2. Navigate to your sensor-control directory
3. Replace the content of `sensor-control-ec2-server.js` with the updated version
4. Create `user-guide.html` with the HTML content
5. Restart the service: `sudo pkill -f 'sensor-control-ec2-server.js' && nohup node sensor-control-ec2-server.js > sensor-control.log 2>&1 &`

## After Deployment

### Test the User Guide
- **API Root**: `http://YOUR-EC2-IP:3002/`
- **User Guide**: `http://YOUR-EC2-IP:3002/user-guide` 
- **Health Check**: `http://YOUR-EC2-IP:3002/health`

### App Integration
Your React Native app's "Get Started" button will now automatically open:
`http://YOUR-EC2-IP:3002/user-guide`

The URL is constructed from your `EXPO_PUBLIC_ADMIN_PORTAL_URL` environment variable, switching from port 8000 to 3002.

## File Summary

| File | Purpose |
|------|---------|
| `sensor-control-ec2-server.js` | Updated EC2 server with user guide route |
| `user-guide-server.html` | Mobile-responsive HTML guide for EC2 |
| `app/index.tsx` | Updated React Native app with Get Started functionality |
| `deploy-user-guide-to-ec2.ps1` | PowerShell deployment script |
| `deploy-user-guide.bat` | Simple batch file wrapper |

## Environment Variables Needed

Make sure your React Native app has:
```
EXPO_PUBLIC_ADMIN_PORTAL_URL=http://YOUR-EC2-IP:8000
```

The user guide URL will automatically be: `http://YOUR-EC2-IP:3002/user-guide`