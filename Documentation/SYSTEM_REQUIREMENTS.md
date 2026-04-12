# 🔧 System Requirements

> What you need to run this system

---

## 📋 Quick Checklist

Before starting, ensure you have:

- [ ] **CPU:** Quad-core or better
- [ ] **RAM:** 4GB minimum (8GB recommended)
- [ ] **Storage:** 10GB free space
- [ ] **Network:** High-speed internet (camera streaming needs 10+ Mbps)
- [ ] **OS:** Windows 10/11, macOS, or Linux
- [ ] **Node.js:** Version 18.0.0 or higher
- [ ] **npm:** Version 8.0.0 or higher
- [ ] **Git:** Latest version
- [ ] **Browser:** Modern browser (Chrome/Firefox/Safari/Edge)
- [ ] **Firebase Account:** Active project with credentials
- [ ] **AWS Account:** (Only if deploying to EC2)

---

## 💻 Hardware Requirements

### Development Machine (Local Setup)

```
MINIMUM:
├── CPU: Dual-core (Intel i5 / AMD Ryzen 3 equivalent)
├── RAM: 4GB
├── Storage: 5GB SSD
├── Network: 1 Mbps upload (for mobile dev)
└── OS: Windows 10/11, macOS 10.13+, or Ubuntu 20.04+

RECOMMENDED:
├── CPU: Quad-core or better
├── RAM: 8GB or more
├── Storage: 20GB SSD (for dependencies + Docker)
├── Network: 10+ Mbps for camera streaming
└── OS: Windows 11, macOS 12+, or Ubuntu 22.04
```

### Production Server (Backend)

```
MINIMUM:
├── CPU: Dual-core (2 vCPU)
├── RAM: 2GB
├── Storage: 20GB SSD
├── Network: 1 Mbps upload minimum
└── OS: Ubuntu 20.04 LTS, Amazon Linux 2, Debian 11

RECOMMENDED:
├── CPU: Quad-core (4 vCPU) or better
├── RAM: 4-8GB
├── Storage: 50GB SSD
├── Network: 10+ Mbps guaranteed
├── Bandwidth: Unlimited or 1TB+/month
└── OS: Ubuntu 22.04 LTS, Amazon Linux 2

FOR CAMERAS:
├── CPU: Quad-core (4+ vCPU)
├── RAM: 2GB+ (per concurrent stream)
├── Storage: 100GB+ (if storing videos)
├── Network: 10+ Mbps upload per stream
└── ffmpeg & camera hardware required
```

### Raspberry Pi (Camera + Sensor)

```
MINIMUM:
├── Model: Raspberry Pi 3B or later
├── RAM: 1GB
├── Storage: 16GB microSD (Class 10)
├── Camera: Pi Camera or USB camera
├── Power: 5V 2.5A+ power supply

RECOMMENDED:
├── Model: Raspberry Pi 4B or 5
├── RAM: 2-4GB
├── Storage: 32GB+ microSD (Class A2)
├── Camera: Pi Camera V2 or V3
├── Power: 5V 3A+ power supply
├── Network: Ethernet preferred, 2.4GHz WiFi minimum

OPTIONAL:
├── Cooling: Heatsinks recommended
├── Case: Ventilated case for long use
├── Extra: 5V fans for camera streaming
└── UPS: Battery backup for reliability
```

---

## 📦 Software Requirements

### Node.js & npm

```bash
# REQUIRED VERSION
Node.js: >=18.0.0  (LTS recommended: 18.x or 20.x)
npm: >=8.0.0       (Usually bundled with Node.js)

# CHECK YOUR VERSION
node --version
npm --version

# DOWNLOAD FROM
https://nodejs.org/

# WINDOWS INSTALLATION
# Download installer from nodejs.org and run
# OR: Use Chocolatey
choco install nodejs

# MAC INSTALLATION
# Using Homebrew
brew install node

# LINUX INSTALLATION
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be v18.0.0+
npm --version   # Should be 8.0.0+
```

### Git

```bash
# REQUIRED VERSION
Git: >=2.30.0

# CHECK YOUR VERSION
git --version

# DOWNLOAD FROM
https://git-scm.com/

# WINDOWS INSTALLATION
# Download from git-scm.com and install
# OR: Use Chocolatey
choco install git

# MAC INSTALLATION
brew install git

# LINUX INSTALLATION
sudo apt-get install git
```

### Firebase Tools (Optional)

```bash
# Install Firebase CLI (optional, for advanced features)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Deploy Cloud Functions (if needed)
firebase deploy --only functions
```

### Other Tools (Optional)

```bash
# Docker (for containerized deployment)
VERSION: >=20.10.0
DOWNLOAD: https://www.docker.com/

# Docker Compose (optional)
VERSION: >=1.29.0

# PostgreSQL (if using SQL instead of Firebase)
VERSION: >=14.0
DOWNLOAD: https://www.postgresql.org/

# Redis (optional, for caching)
VERSION: >=6.0
```

---

## 🔐 Credentials & Accounts Required

### Firebase Project

You MUST have:

1. **Active Firebase Project**
   - Project ID
   - API Key
   - Auth Domain
   - Database URL
   - Project Number

2. **Service Account Key** (for backend)
   - JSON file from Firebase Console
   - Stored as `serviceAccountKey.json`

3. **Web Config** (for mobile app)
   ```javascript
   {
     apiKey: "xxx",
     authDomain: "xxx.firebaseapp.com",
     databaseURL: "https://xxx.firebasedatabase.app",
     projectId: "xxx",
     storageBucket: "xxx.appspot.com",
     messagingSenderId: "xxx",
     appId: "xxx"
   }
   ```

### Google Cloud Account

Required for Firebase to work:
- Enable Firebase service
- Enable Realtime Database
- Enable Firestore
- Enable Cloud Functions
- Enable Cloud Messaging

### Optional: AWS Account

Only needed for EC2 deployment:
- AWS Access Key ID
- AWS Secret Access Key
- EC2 Key Pair
- IAM permissions for EC2, S3, RDS

### Optional: Railway Account

For alternative cloud hosting:
- Railway.app account
- GitHub account (for deployment)

---

## 📱 Browser Requirements

### Desktop Browser (for admin portal & camera web view)

```
MINIMUM:
├── Chrome 90+
├── Firefox 88+
├── Safari 14+
└── Edge 90+

FEATURES NEEDED:
├── WebRTC support
├── WebSocket support
├── LocalStorage
├── SessionStorage
├── Service Worker support (optional)
└── Geolocation (optional)
```

### Mobile Browser (for Web camera viewing)

```
iOS:
├── Safari 13+ (iOS 13+)
├── Chrome for iOS (latest 2 versions)
└── Firefox for iOS (latest)

Android:
├── Chrome for Android 90+
├── Firefox for Android 88+
├── Samsung Internet 14+
└── Opera for Android (latest)

FEATURES NEEDED:
├── WebRTC support
├── WebSocket support
└── LocalStorage
```

---

## 🌍 Network Requirements

### Internet Connection

```
MINIMUM:
├── Upload: 1 Mbps
├── Download: 2 Mbps
├── Latency: <100ms to Firebase
└── Jitter: <10ms

FOR CAMERA STREAMING:
├── Upload: 5-10 Mbps (per stream)
├── Download: 5-10 Mbps (per stream)
├── Latency: <50ms preferred
└── Jitter: <5ms preferred

FOR MULTIPLE STREAMS:
├── Upload: 20+ Mbps total
├── Download: 20+ Mbps total
├── Bandwidth capacity: 50GB+/month
└── Dedicated connection recommended
```

### Firewall / Port Requirements

```
OUTBOUND (FROM YOUR NETWORK):
├── Port 443 (HTTPS) — To Firebase, APIs
├── Port 53 (DNS) — For domain resolution
├── Port 123 (NTP) — For time sync
├── Ports 16384-16415 (WebRTC RTP) — For camera streaming
└── Port 3478 (STUN) — For NAT traversal

INBOUND (ONLY FOR SERVER):
├── Port 22 (SSH) — For remote access
├── Port 80 (HTTP) — For redirects (optional)
├── Port 443 (HTTPS) — For secure traffic
├── Ports 10000-20000 (WebRTC) — For P2P streaming

├── Port 3001 (Alert API/Admin Portal) — Backend services
└── Port 3002 (Sensor Control API) — Backend services

Note: These backend service ports are currently exposed directly. Future: Nginx reverse 
proxy will run on 80/443 with path-based routing to internal services.
FIREWALL RULES:
├── Allow HTTPS (443) everywhere
├── Allow SSH (22) from trusted IPs only
├── Block unused ports
└── Enable firewall logging
```

---

## 💾 Storage Requirements

### Local Development

```
Minimal Installation:
├── Node modules: 500MB
├── Code: 100MB
├── Databases: 10MB
└── Total: ~700MB

WITH DEPENDENCIES:
├── Node modules (all): 1.5GB
├── Docker images (optional): 2GB
├── Virtual environments: 500MB
└── Total: ~4GB

COMFORTABLE DEVELOPMENT:
├── Total recommended: 20GB
├── Free space kept: 10GB+
└── Allows for iteration & testing
```

### Production Server

```
Minimal:
├── Application: 100MB
├── Dependencies: 500MB
├── Database cache: 1GB
└── Total: ~2GB

Standard:
├── Application: 100MB
├── Dependencies: 500MB
├── Database backups: 10GB
├── Log files: 5GB
├── Media/Videos: 20GB
└── Total: ~35GB

Large Scale:
├── Everything above: ~50GB
└── Recommend: 100GB+ drive
```

---

## 🔄 Platform Compatibility Matrix

| Component | Windows | macOS | Linux | Raspberry Pi |
|-----------|---------|-------|-------|--------------|
| **Node.js Backend** | ✅ 18+ | ✅ 18+ | ✅ 18+ | ✅ 16+ |
| **Mobile App** | ✅ Expo Web | ✅ Expo | ✅ Expo | N/A |
| **Admin Portal** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Limited |
| **Camera Server** | ✅ Yes | ✅ Limited | ✅ Yes | ✅ Yes |
| **Database** | ✅ Firebase | ✅ Firebase | ✅ Firebase | ✅ Firebase |
| **Docker** | ✅ Desktop | ✅ Desktop | ✅ Yes | ⚠️ Arm32v7 |
| **Production Ready** | ✅ Yes | ⚠️ For dev | ✅ Yes | ✅ Sensors/Cameras |

---

## 🔒 Security Requirements

### Minimum Security Setup

```
ESSENTIAL:
├── HTTPS enabled (TLS 1.2+)
├── Firebase Rules configured
├── Environment variables used (no hardcoded secrets)
├── API rate limiting enabled
├── CORS properly configured
├── Firewall enabled on server
├── SSH key-based auth (no password SSH)
└── Regular security updates

RECOMMENDED:
├── DDoS protection (AWS Shield, Cloudflare)
├── Web Application Firewall (AWS WAF)
├── VPN for admin access
├── Intrusion detection
├── Regular security audits
├── Vulnerability scanning
├── Backup encryption
└── Access logging & monitoring
```

---

## ⚡ Performance Recommendations

### For Optimal Performance

```
Backend Server:
├── CPU: 4+ cores
├── RAM: 8GB+
├── SSD: NVMe preferred
├── Network: Fiber or dedicated
└── Auto-scaling enabled

Sensor Polling Frequency:
├── Every 5-10 seconds (optimal)
├── Every 1 second (maximum, high CPU)
├── Every 30 seconds (low-power mode)
└── Configurable per device

Camera Streaming:
├── Default: 30 fps, 640x480, 1000 kbps
├── High quality: 60 fps, 1080p, 2000 kbps
├── Low latency: 30 fps, 480p, 500 kbps
└── Power saving: 15 fps, 320x240, 250 kbps
```

---

## 🆘 Pre-Flight System Check

Before deployment, verify:

```bash
# Node.js version
node --version
# Must be >=18.0.0

# npm version
npm --version
# Must be >=8.0.0

# Git configuration
git config --global user.name
git config --global user.email
# Must be set to valid values

# Firebase credentials
cat serviceAccountKey.json | head -1
# Must exist and be valid JSON

# Network connectivity
ping 8.8.8.8
# Must respond

# Database connection
# Test in app or backend logs
# Must see successful connection

# Port availability (for local dev)
netstat -ano | findstr :3000
# For Linux/Mac: lsof -i :3000
# Port 3000 should be available

# Battery/power (for Pi)
vcgencmd get_throttled
# Should return: throttled=0x0
```

---

## 📊 Capacity Planning

### Small Deployment (< 10 devices)

```
Backend: EC2 t3.micro ($10/month)
├── CPU: 1 vCPU
├── RAM: 1GB
├── Concurrent: ~10 devices
└── Streams: 1-2 cameras

Database: Firebase (free/spark plan)
├── Realtime DB: 1GB
├── Firestore: 1GB
└── Monthly reads: ~1M

Estimated monthly cost: $10-15
```

### Medium Deployment (50-100 devices)

```
Backend: EC2 t3.small ($20/month)
├── CPU: 2 vCPU
├── RAM: 2GB
├── Concurrent: ~50 devices
└── Streams: 3-5 cameras

Database: Firebase (Blaze pay-as-you-go)
├── Realtime DB: auto-scale
├── Firestore: auto-scale
└── Estimated: $20-40/month

Estimated monthly cost: $40-60
```

### Large Deployment (1000+ devices)

```
Backend: EC2 m5.xlarge ($180/month)
├── CPU: 4 vCPU
├── RAM: 16GB
├── Concurrent: 1000+ devices
└── Streams: 10+ cameras

Database: Firebase Blaze + RDS backup
├── Realtime DB: premium
├── Firestore: premium
├── RDS: micro (~$15)
└── Estimated: $200+/month

Load Balancer: AWS ALB ($15/month)
Monitoring: CloudWatch

Estimated monthly cost: $400+
```

---

## 🚀 Quick Verification Steps

```bash
# 1. Clone repository
git clone https://github.com/rutaghacs/backend_api.git

# 2. Install dependencies
npm install

# 3. Create .env with Firebase credentials
# Copy from Firebase Console

# 4. Start backend
node sensor-control-ec2-server.js

# 5. Test in new terminal
curl http://localhost:3000/api/health

# 6. Should return:
# {"status":"ok","timestamp":1648392000}
```

---

## ❌ Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Node not found | Not installed | Install Node.js 18+ |
| Port 3000 in use | Other app using it | Kill process or use different port |
| Firebase error | Missing .env | Copy credentials from Firebase Console |
| npm install fails | Disk full | Free up space or check internet |
| Camera lag | Network slow | Check bandwidth, reduce resolution |
| High CPU usage | Too many streams | Reduce FPS or resolution |

---

**Last Updated:** March 25, 2026  
**Maintained By:** Development Team  
**Status:** ✅ Verified for Production
