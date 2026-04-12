# ⚡ Quick Start Guide - Get Running in 30 Minutes

> The absolute fastest way to get your system up and running

---

## ✅ Prerequisites (5 minutes)

Before you begin, you need:

### Local Machine
- [ ] Node.js 18+ (`node --version`)
- [ ] npm 8+ (`npm --version`)  
- [ ] Git (`git --version`)
- [ ] Firebase account with active project
- [ ] `.env` file with your credentials

### Credentials You'll Need
```
FIREBASE_API_KEY=xxxxx
FIREBASE_AUTH_DOMAIN=xxxxx.firebaseapp.com
FIREBASE_DATABASE_URL=https://xxxxx.firebasedatabase.app
FIREBASE_PROJECT_ID=xxxxx
FIREBASE_STORAGE_BUCKET=xxxxx.appspot.com
FIREBASE_MESSAGING_SENDER_ID=xxxxx
FIREBASE_APP_ID=xxxxx
```

Get these from: Firebase Console → Project Settings → Your Apps → Copy config

---

## 🚀 30-Minute Setup (in 5 steps)

### STEP 1: Clone the Repository (2 minutes)

```bash
# Navigate to your workspace
cd c:\Users\SUDIPTA\Downloads\

# Clone the repo (ALREADY DONE - you have it)
# Skip this if you already have the code

# Move into the directory
cd Sensor_app
```

### STEP 2: Install Backend Dependencies (5 minutes)

```bash
# Check Node version
node --version
# Should be 18.0.0 or higher

# Install backend dependencies
npm install

# Install alert API dependencies (optional, already included)
cd alert-api-v2 && npm install && cd ..
```

### STEP 3: Configure Environment (3 minutes)

```bash
# Edit or create .env file
# Copy these exact values from your Firebase project:

FIREBASE_API_KEY="your-api-key-here"
FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com"
FIREBASE_DATABASE_URL="https://your-project.firebasedatabase.app"
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_STORAGE_BUCKET="your-project.appspot.com"
FIREBASE_MESSAGING_SENDER_ID="123456789"
FIREBASE_APP_ID="1:123456789:web:abcdef"

DEVICE_ID="device-01"
WEBRTC_WIDTH="640"
WEBRTC_HEIGHT="480"
WEBRTC_FPS="30"
```

**Where to find these:** Firebase Console → Project → Settings → Your apps

### STEP 4: Start Backend Server (3 minutes)

```bash
# Start the sensor control server
node sensor-control-ec2-server.js

# You should see:
# ✅ Firebase initialized
# ✅ Server running on port 3000
# ✅ Listening for device data
```

**Keep this terminal open!**

### STEP 5: Test with Your Mobile App (12 minutes)

**In a new terminal:**

```bash
# Navigate to mobile app
cd sensor_app

# Install dependencies
npm install

# Start Expo
npx expo start

# Follow on-screen instructions to run on:
# - iOS simulator: Press 'i'
# - Android emulator: Press 'a'
# - Web browser: Press 'w'
```

---

## ✨ What You Should See

### Backend Console
```
╔════════════════════════════════════════╗
║  🎯 Sensor Control API Server         ║
║  ✅ Firebase initialized              ║
║  ✅ Realtime DB connected             ║
║  ✅ Port 3000                         ║
║  ✅ Ready for connections             ║
╚════════════════════════════════════════╝
```

### Mobile App
```
📱 Dashboard Screen
├── Sensors (0 devices) ← Add a device to see data
├── Alerts (0 unread)
└── Settings
```

---

## 🧪 Quick Test (2 minutes)

### Add a Test Device

```bash
# In a third terminal, add a test device:

curl -X POST http://localhost:3000/api/devices \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-01",
    "name": "Test Sensor",
    "type": "temperature",
    "location": "Room 1"
  }'

# Response should include:
# "deviceId": "test-device-01
# "name": "Test Sensor"
```

### Send Test Sensor Data

```bash
curl -X POST http://localhost:3000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-01",
    "temperature": 25.5,
    "humidity": 60,
    "timestamp": '$(date +%s)'
  }'
```

### See Data in App

Go back to mobile app and:
1. Tap "Refresh" (pull down to refresh)
2. Device "Test Sensor" should appear
3. Temperature: 25.5°C should display
4. Status: Online ✅

---

## 🎯 Next Steps (What to Do After 30 Minutes)

### Immediate Next Steps
1. ✅ Backend running locally
2. ✅ Mobile app connected
3. ✅ Test device showing data
4. 👉 **Read [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)** for production setup

### Optional: Enable Camera Streaming

```bash
# In another terminal:
cd camera-streaming

# Install dependencies
npm install

# Start camera server (requires ffmpeg + camera hardware)
npm start

# You can then open camera in browser:
# http://your-device-ip/camera
```

### Optional: Deploy to Cloud

- **Railway.app:** See [RAILWAY_DEPLOYMENT_GUIDE.md](RAILWAY_DEPLOYMENT_GUIDE.md) (1-2 hours)
- **AWS EC2:** See [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md) (2-4 hours)

---

## ⚡ Essential Commands Reference

```bash
# Start backend
node sensor-control-ec2-server.js

# Start mobile app
cd sensor_app && npx expo start

# Start camera streaming
cd camera-streaming && npm start

# Stop any service
# Press Ctrl+C in the terminal

# Clear Node modules (if stuck)
rm -r node_modules
npm install
```

---

## 🐛 Quick Troubleshooting

### "Port 3000 already in use"
```bash
# Free the port (Windows)
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Or use different port
PORT=3001 node sensor-control-ec2-server.js
```

### "Cannot find module 'firebase'"
```bash
# Reinstall dependencies
rm -r node_modules
npm install
```

### "Expo command not found"
```bash
# Install Expo CLI globally
npm install -g expo-cli
# Then try again
npx expo start
```

### "Firebase connection failed"
```bash
# Check .env file has correct values
cat .env | grep FIREBASE

# Verify Firebase project is active
# Go to Firebase Console and check project settings
```

### "Device doesn't appear in app"
```bash
# Check backend is running
# Check .env is configured
# Refresh mobile app (pull down)
# Check console logs for errors
```

---

## 📊 System Status Check

### Verify Backend is Running

```bash
# In terminal, check response:
curl http://localhost:3000/api/health

# Should return:
# {"status":"ok","timestamp":1648392000}
```

### Check Mobile App Connection

```bash
# In mobile app, go to Settings
# Should show: Backend connected ✅
# Should show: Database connected ✅
```

### Check Firebase Connection

```bash
# In backend console, you should see:
# ✅ Firebase initialized
# ✅ Realtime DB connected  
# ✅ Listening for device updates
```

---

## 🎓 Learning Path After Quick Start

```
✅ Completed: Quick Start (30 min)
    ↓
    ### ℹ️ About Backend Services

    **For this quick start:** We'll start just the Sensor Control API (port 3000) for local testing.

    **In production:** Three separate services run:
    - Alert API (port 3001) — Handles ML alerts and device registration
    - Sensor Control API (port 3002) — Handles device control and sensor data
    - Admin Portal (port 3001) — Management dashboard

    For now, port 3000 is fine for local development.

    ---
Read: FEATURE_INVENTORY.md (15 min)
├─ Understand what features exist
├─ See what sensors are supported
└─ Learn about capabilities
    ↓
Read: FINAL_ARCHITECTURE_OVERVIEW.md (30 min)
├─ Understand system design
├─ Learn data flow
└─ Understand components
    ↓
Read: DEPLOYMENT_CHECKLIST.md (as needed)
├─ For production deployment
├─ For testing features
└─ For verification
```

---

## 🔑 Key Ports & URLs

| Service | URL | Port |
|---------|-----|------|
| Backend API | http://localhost:3000 | 3000 |
| Expo Web | http://localhost:19006 | 19006 |
| Camera Stream | http://localhost:8080 | 8080 |
| Firebase Console | https://console.firebase.google.com | N/A |

---

## ✅ Success Checklist

After 30 minutes, verify you have:

- [ ] Node.js 18+ installed
- [ ] Backend server running on port 3000
- [ ] Mobile app running in Expo
- [ ] Can see "Sensors" tab in app
- [ ] Added test device successfully
- [ ] Can see sensor data in app
- [ ] Backend and app communicating
- [ ] No major errors in console
- [ ] Firebase connected
- [ ] Ready to move to production setup

---

## 🚀 You're Done!

Congratulations! You have:

✅ A working backend API  
✅ A working mobile app  
✅ Real-time data syncing  
✅ Firebase integration working  
✅ Test device with live data  

**Next:** Continue to [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for production setup.

---

**Estimated Complete Time:** 30 minutes  
**Difficulty:** Beginner  
**Prerequisites:** Node.js, Firebase account  
**Support:** See TROUBLESHOOTING_MASTER.md
