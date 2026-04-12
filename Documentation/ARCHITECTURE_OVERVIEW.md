# 🏗️ Final Architecture Overview

> Complete system design and data flow documentation

---

## 📊 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SENSOR IoT SYSTEM                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    USER INTERFACES                              │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  📱 Mobile App          🖥️ Admin Portal         🌐 Web Browser  │  │
│  │  (React Native)         (React)                (WebRTC Stream) │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                │                                         │
│                                ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    BACKEND SERVICES (EC2)                        │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  ┌ Sensor Control API ─┐  ┌ Alert API ─┐  ┌ Camera Stream ─┐   │  │
│  │  │ • Device data       │  │ • ML alerts │  │ • WebRTC sig  │   │  │
│  │  │ • Device control    │  │ • Filtering │  │ • Video relay │   │  │
│  │  │ • Status tracking   │  │ • History   │  │ • P2P setup   │   │  │
│  │  └──────────────────────┘  └─────────────┘  └───────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                │                                         │
│                                ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    FIREBASE CLOUD SERVICES                       │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  ┌ Realtime Database ─┐  ┌ Firestore ─┐  ┌ Cloud Functions ─┐  │  │
│  │  │ • Device status   │  │ • Alerts   │  │ • ML processing  │  │  │
│  │  │ • Sensor data     │  │ • Users    │  │ • Notifications  │  │  │
│  │  │ • WebRTC signaling│  │ • Settings │  │ • Scheduled tasks│  │  │
│  │  └──────────────────────┘  └────────────┘  └──────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    IOT DEVICES / SENSORS                         │  │
│  ├──────────────────────────────────────────────────────────────────┤  │
│  │  🎥 Raspberry Pi/Windows    📡 Sensor Devices    🔌 Controllers  │  │
│  │  (Camera + Stream)          (Temperature, etc.)   (Relay, etc.)  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow Architecture

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. SENSOR DATA COLLECTION                                       │
└─────────────────────────────────────────────────────────────────┘

Sensor Device (DHT11, Pressure, etc.)
    │
    ▼ (HTTP/REST)
Sensor Control Server (EC2)
    │
    ▼ (Firebase API)
Firebase Realtime Database (device_data)
    │
    ├─→ Mobile App (listens for updates)
    ├─→ Admin Portal (displays charts)
    └─→ Cloud Functions (processes alerts)

┌─────────────────────────────────────────────────────────────────┐
│ 2. ALERT PROCESSING & DELIVERY                                  │
└─────────────────────────────────────────────────────────────────┘

Firebase Realtime DB (sensor updates)
    │
    ▼ (triggers)
Cloud Functions (ML analysis)
    │
    ▼ (processes)
Firestore (stores alerts)
    │
    ├─→ Firebase Cloud Messaging (FCM)
    │   │
    │   ▼
    │   Mobile App (push notification)
    │
    └─→ Mobile App (real-time listener)
        │
        ▼
        User sees notification

┌─────────────────────────────────────────────────────────────────┐
│ 3. CAMERA STREAMING                                             │
└─────────────────────────────────────────────────────────────────┘

Camera Device (Pi/Windows)
    │
    ▼ (ffmpeg + WebRTC)
WebRTC Stream Server
    │
    ▼ (Firebase signaling)
Firebase Realtime DB (webrtc_sessions)
    │
    ├─→ Mobile App (WebRTC video player)
    └─→ Web Browser (WebRTC video player)
        │
        ▼
        P2P connection established
        │
        ▼
        Live video feed

┌─────────────────────────────────────────────────────────────────┐
│ 4. DEVICE CONTROL                                               │
└─────────────────────────────────────────────────────────────────┘

Mobile App (user command)
    │
    ▼ (REST API)
Sensor Control Server (EC2)
    │
    ▼ (validates auth)
Firebase Realtime DB (commands)
    │
    ▼ (polling/listener)
Remote Device (reads command)
    │
    ▼ (executes)
Relay/Controller actuates
    │
    ▼ (status update)
Firebase Realtime DB (device_status)
    │
    ▼
Mobile App (displays status)
```

---

## 🏢 Component Architecture

### 1. Mobile Application (`sensor_app/`)

```
sensor_app/
├── app/
│   └── dashboard.tsx ─────────→ Main screen with tabs
│       ├── Device Tab ────────→ Shows all devices
│       ├── Alerts Tab ────────→ Shows recent alerts
│       └── Settings Tab ──────→ User preferences
├── components/
│   ├── DeviceCard.tsx
│   ├── AlertItem.tsx
│   └── WebRTCVideoPlayer.tsx
├── db/
│   ├── firebaseQueries.ts ────→ Realtime listeners
│   ├── webrtcSignaling.ts ────→ P2P setup
│   └── realtimeSync.ts ───────→ Data sync
├── firebase/
│   └── firebaseConfig.js ─────→ Init & config
├── hooks/
│   ├── useDevices.ts ─────────→ Fetch devices
│   ├── useAlerts.ts ──────────→ Alert listeners
│   └── useSensorData.ts ──────→ Sensor values
└── types/
    └── index.ts ──────────────→ TypeScript definitions

FEATURES:
  ✅ Real-time sensor monitoring
  ✅ Alert notifications
  ✅ Device control (on/off)
  ✅ Camera viewing
  ✅ User authentication
  ✅ Data visualizations
```

### 2. Backend API (`sensor-control-ec2-server.js`)

```
Sensor Control Server
├── Routes
│   ├── GET /api/devices ──────────→ List all devices
│   ├── GET /api/devices/:id ─────→ Device details
│   ├── POST /api/devices ────────→ Create device
│   ├── GET /api/sensor-data/:id ─→ Get sensor readings
│   ├── POST /api/device-control ─→ Send commands
│   └── GET /api/alerts ─────────→ List alerts
│
├── Firebase Integration
│   ├── Realtime DB listeners
│   ├── Firestore queries
│   └── Cloud Function triggers
│
├── Device Communication
│   ├── HTTP polling from devices
│   ├── HTTP commands to devices
│   └── Status verification
│
└── Authentication
    ├── Firebase token validation
    ├── User permission checks
    └── Device ownership verification

KEY ENDPOINTS:
  POST /api/device-control
    {
      "deviceId": "device-01",
      "command": "SET_RELAY",
      "value": true,
      "userId": "user-123"
    }

  GET /api/sensor-data/device-01
    {
      "temperature": 25.5,
      "humidity": 60,
      "timestamp": 1648392000,
      "deviceId": "device-01"
    }
```

### 3. Alert System (`alert-api-v2/`)

```
Alert Processing Pipeline

1. Sensor Data Update
   Firebase Realtime DB (device_data)
         │
         ▼ (Cloud Function trigger)

2. ML Analysis
   ML Model analyzes readings against:
   ├── Historical average
   ├── Threshold values
   ├── Sensor type (temp, humid, pressure)
   ├── Time of day patterns
   └── User-defined rules

3. Alert Generation
   If anomaly detected:
   ├── Create Firestore entry
   ├── Queue FCM notification
   ├── Log to analytics
   └── Update user's alert feed

4. Delivery
   ├── Mobile push notification (FCM)
   ├── In-app notification display
   ├── Web push (if enabled)
   └── Email (optional)

5. User Interaction
   ├── Dismiss alert
   ├── Rate severity (false positive?)
   ├── View details
   └── Take action (control device)
```

### 4. Camera Streaming (`camera-streaming/`)

```
WebRTC Camera Streaming

1. Initialization
   Pi/Device:
   ├── Start ffmpeg (camera capture)
   ├── Connect to Firebase
   ├── Register as online in device_status
   └── Wait for session request

2. Session Setup
   User (mobile/web):
   ├── Click "Open Camera"
   ├── Create session in Firebase
   ├── Wait for device response
   └── Exchange SDP offer/answer

3. ICE Candidate Exchange
   ┌─────────────────────┬─────────────────────┐
   │ Mobile/Web Client   │ Pi/Device Server    │
   ├─────────────────────┼─────────────────────┤
   │ Create offer        │                     │
   │ Send via Firebase   │                     │
   │                     │ Receive offer       │
   │                     │ Create answer       │
   │                     │ Send via Firebase   │
   │ Receive answer      │                     │
   │ Exchange ICE cands  │ Exchange ICE cands  │
   │ Connection builds   │ Connection builds   │
   │ P2P streams video   │ Streams camera feed│
   └─────────────────────┴─────────────────────┘

4. Stream Quality
   ├── Resolution: 640x480
   ├── FPS: 30 (configurable)
   ├── Bitrate: 1000k (adaptive)
   ├── Codec: H.264
   └── Latency: <500ms typically

Infrastructure:
  - Pi/Windows: ffmpeg + wrtc library
  - Firebase: Signaling + ICE relay
  - Network: P2P preferred, fallback to TURN
```

### 5. Admin Portal (NOT in public repos - local only)

```
Admin Portal Architecture

Login
  │
  ▼ (Firebase Auth)
Dashboard
  ├─→ User Management
  │   ├── List users
  │   ├── Create user
  │   ├── Reset password
  │   └── Manage roles
  │
  ├─→ Device Management
  │   ├── List devices
  │   ├── View ownership
  │   ├── Edit settings
  │   └── View history
  │
  ├─→ System Monitoring
  │   ├── Server status
  │   ├── Database stats
  │   ├── Alert volume
  │   └── API metrics
  │
  └─→ Configuration
      ├── Alert rules
      ├── Notification settings
      ├── Security policies
      └── Backup settings

Technology:
  ├── Frontend: React + TypeScript
  ├── Backend: Node.js (shared)
  ├── Database: Firestore
  ├── Auth: Firebase Auth
  └── Deployment: EC2 / Railway
```

---

## 🔐 Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   SECURITY LAYERS                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. AUTHENTICATION                                           │
│     ├── Firebase Auth (Google Sign-In)       │
│     ├── JWT tokens issued on login                           │
│     └── Token validated on every request                     │
│                                                               │
│  2. AUTHORIZATION                                            │
│     ├── User roles (admin, user, viewer)                     │
│     ├── Device ownership checks                              │
│     ├── Firestore security rules                             │
│     └── Real-time DB security rules                          │
│                                                               │
│  3. DATA ENCRYPTION                                          │
│     ├── HTTPS for all API traffic                            │
│     ├── Firebase handles DB encryption at rest               │
│     └── WebRTC connections use DTLS                          │
│                                                               │
│  4. API SECURITY                                             │
│     ├── Input validation on all endpoints                    │
│     ├── Rate limiting (configurable)                         │
│     ├── CORS restrictions                                    │
│     └── Query parametervalidation                            │
│                                                               │
│  5. DEVICE SECURITY                                          │
│     ├── Device tokens/IDs verified                           │
│     ├── Commands validated before execution                  │
│     └── Status updates authenticated                         │
│                                                               │
└─────────────────────────────────────────────────────────────┘

FIRESTORE SECURITY RULES:
  ├── Users can only read/write their own data
  ├── Devices restricted to authorized users
  ├── Alerts read-only for non-owners
  ├── Sensor data protected by device ownership
  └── Admin functions restricted

REALTIME DB RULES:
  ├── Device status public-read (no auth needed)
  ├── Device commands require auth + ownership
  ├── Settings user-specific
  └── WebRTC sessions time-limited
```

---

## 📊 Database Schema


### Firestore Collections

```
users/
  ├── {userId}/
  │   ├── email: string
  │   ├── displayName: string
  │   ├── role: enum("admin", "user", "viewer")
  │   └── createdAt: timestamp

devices/
  ├── {deviceId}/
  │   ├── name: string
  │   ├── ownerId: string
  │   ├── type: string (sensor, camera, source)
  │   ├── location: string
  │   ├── settings: map
  │   └── createdAt: timestamp

alerts/
  ├── {alertId}/
  │   ├── deviceId: string
  │   ├── userId: string
  │   ├── type: string
  │   ├── severity: enum("low", "medium", "high")
  │   ├── value: number
  │   ├── threshold: number
  │   ├── read: boolean
  │   ├── dismissed: boolean
  │   └── createdAt: timestamp

user_device_access/
  ├── {userId}/
  │   └── {deviceId}/
  │       ├── role: enum("owner", "viewer")
  │       └── grantedAt: timestamp
```

---

## 🔄 Component Interactions

### User Opens App
```
1. App starts
   ├── Load Firebase config
   └── Check authentication

2. User not logged in?
   ├── Show login screen
   ├── User enters credentials
   └── Firebase authenticates
   
3. User logged in
   ├── Fetch user profile from Firestore
   ├── Load user's devices from Firestore
   ├── Subscribe to device_data in Realtime DB
   ├── Update UI with devices
   └── Listen for new alerts

4. User interacts
   ├── Tap device → load details
   ├── Control device → POST to API → Firebase update → Device executes
   ├── View camera → create session → P2P connect → stream video
   └── Check alerts → view from Firestore → dismiss/rate
```

### Alert Gets Generated
```
1. Sensor sends data to backend API
   └── API updates Firebase Realtime DB

2. Realtime DB triggers Cloud Function
   ├── Function retrieves sensor reading
   ├── Analyzes against thresholds
   └── Detects anomaly

3. Cloud Function creates alert
   ├── Save to Firestore
   ├── Queue FCM notification
   ├── Log analytics event
   └── Mark as unread

4. Mobile app receives notification
   ├── FCM delivers push notification
   ├── User sees notification in notification center
   ├── User taps notification
   ├── App opens alert detail
   └── User can dismiss/rate/take action
```

---

## ⚙️ Configuration Management

```
Environment Variables (.env)
├── FIREBASE_API_KEY
├── FIREBASE_AUTH_DOMAIN
├── FIREBASE_DATABASE_URL
├── FIREBASE_PROJECT_ID
├── FIREBASE_STORAGE_BUCKET
├── FIREBASE_MESSAGING_SENDER_ID
├── FIREBASE_APP_ID
├── DEVICE_ID
├── WEBRTC_WIDTH
├── WEBRTC_HEIGHT
├── WEBRTC_FPS
├── WEBRTC_BITRATE
├── AWS_REGION
├── AWS_ACCESS_KEY_ID
├── AWS_SECRET_ACCESS_KEY
├── API_BASE_URL
└── ALERT_THRESHOLD_HIGH

Firestore Custom Claims
├── admin: boolean
├── canCreateDevices: boolean
├── canManageUsers: boolean
└── allowedDevices: array

Realtime DB Rules
├── Data access by user role
├── Device ownership validation
├── Rate limit configuration
└── Session timeout settings
```

---

## 🚀 Deployment Topology

### Single Server Deployment
```
┌────────────────────────┐
│   AWS EC2 Instance     │
├────────────────────────┤
│  Node.js Server        │
│  ├─ Sensor Control API │
│  ├─ Alert API         │
│  └─ WebRTC Signaling  │
└────────────────────────┘
         ▲
         │ (REST API)
         │
    ┌────┴────────────┬────────────────┐
    │                 │                │
┌───▼─┐          ┌────▼──┐      ┌─────▼──┐
│Mobile│          │Admin  │      │Browser │
│App   │          │Portal │      │Camera  │
└─────┘          └───────┘      └────────┘
         │         │ (HTTPS)
         └─────────┴──────────────┐
                                  │
                          ┌───────▼────────┐
                          │Firebase Cloud  │
                          │├─Realtime DB   │
                          │├─Firestore    │
                          │├─Auth         │
                          │└─Functions    │
                          └────────────────┘
```

### Multi-Deployment (Scalable)
```
Load Balancer (AWS ALB / API Gateway)
        │
    ┌───┼───┬──────┐
    │   │   │      │
    ▼   ▼   ▼      ▼
  EC2  EC2  EC2  EC2  (Auto-scaling group)
  ├─ Sensor Control API
  ├─ Alert API (some instances)
  └─ WebRTC Signaling Pool

Shared Backend
  ├─ RDS Database (optional, if using SQL)
  ├─ ElastiCache (Redis for caching)
  ├─ S3 (media storage)
  └─ CloudFront (CDN)

Always in Cloud
  ├─ Firebase (Realtime DB, Firestore, Auth)
  ├─ Cloud Functions (alert processing)
  └─ Cloud Storage (backups)
```

---

---

## 🖥️ EC2 Backend APIs

All backend services are deployed on AWS EC2 instance (IP: `13.205.201.82`) behind an Nginx reverse proxy that exposes HTTP/HTTPS on ports 80/443 and routes internally to backend services.

### Backend Services Architecture

```
┌─────────────────────────────────────────────────────────────┐
│         EC2 Instance (13.205.201.82)                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   Nginx Reverse Proxy (Port 80/443)                │   │
│  │   ├─ /alert-api/* ──→ Port 3001                    │   │
│  │   ├─ /sensor-api/* ──→ Port 3002                   │   │
│  │   ├─ /admin-portal/* ──→ Port 3000                 │   │
│  │   └─ / ──→ Port 3001 (Default: Admin Portal)       │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                        │
│  ┌──────────────────┼──────────────────────────────────┐   │
│  │                  │                                  │   │
│  ▼                  ▼                                  ▼   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Alert API  │  │  Sensor Ctrl │  │Admin Portal  │   │
│  │  Port 3001  │  │   Port 3002   │  │  Port 3000   │   │
│  ├─────────────┤  ├──────────────┤  ├──────────────┤   │
│  │ ML alerts   │  │ Device data  │  │ User mgmt    │   │
│  │ Filtering   │  │ Device ctrl  │  │ Device mgmt  │   │
│  │ History     │  │ Status track │  │ System mon   │   │
│  └─────────────┘  └──────────────┘  └──────────────┘   │
│         │               │                    │          │
│         └───────────────┼────────────────────┘          │
│                         ▼                                │
│         ┌─────────────────────────────┐                │
│         │  PostgreSQL Database        │                │
│         │  Port 5432                  │                │
│         │  Database: sensor_db        │                │
│         └─────────────────────────────┘                │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### API Endpoints

#### 1. **Alert API**
| Item | Details |
|------|---------|
| **Name** | Alert API Server (`server.ec2.alert-api.js`) |
| **IP Address** | `13.205.201.82` |
| **Internal Port** | `3001` |
| **External URL** | `http://13.205.201.82/alert-api/` |
| **Process Manager** | PM2 (`pm2 start server.js --name alert-api`) |
| **Base Route** | `/alert-api/api/` |

**Key Endpoints:**
```
POST   /alert-api/api/devices/register        - Register new device
POST   /alert-api/api/alerts                  - Submit ML alert
GET    /alert-api/api/alerts                  - Retrieve alerts
POST   /alert-api/api/users/sync              - Sync users from Firebase
GET    /alert-api/api/devices                 - List all devices
```

**Authentication:**
- Header: `x-device-secret` (for device registration)
- Firebase token validation for user endpoints

---

#### 2. **Sensor Control API**
| Item | Details |
|------|---------|
| **Name** | Sensor Control Server (`sensor-control-ec2-server.js`) |
| **IP Address** | `13.205.201.82` |
| **Internal Port** | `3002` |
| **External URL** | `http://13.205.201.82/sensor-api/` |
| **Process Manager** | PM2 (`pm2 start server.js --name sensor-control`) |
| **Base Route** | `/api/` (when exposed via `/sensor-api/`) |

**Key Endpoints:**
```
GET    /api/devices                  - List devices
GET    /api/devices/:id              - Get device details
POST   /api/device-control           - Send device commands
GET    /api/sensor-data/:id          - Get sensor readings
POST   /api/device-stats             - Device statistics
GET    /api/gpio/status/:pin         - GPIO pin status
POST   /api/gpio/control             - Control GPIO pins
```

**Authentication:**
- Header: `x-api-key` (for admin endpoints)
- Header: `x-device-secret` (for device registration)

**Request Example:**
```bash
curl -X POST http://13.205.201.82/sensor-api/api/device-control \
  -H "Content-Type: application/json" \
  -H "x-api-key: admin-api-key-here" \
  -d '{
    "deviceId": "device-01",
    "command": "SET_RELAY",
    "pin": 17,
    "value": true
  }'
```

---

#### 3. **Admin Portal**
| Item | Details |
|------|---------|
| **Name** | Admin Portal Server (`admin-portal-v2/server.js`) |
| **IP Address** | `13.205.201.82` |
| **Internal Port** | `3001` |
| **External URL** | `http://13.205.201.82:3001/` |
| **Process Manager** | PM2 (`pm2 start server.js --name admin-portal`) |
| **Base Route** | `/api/` |

**Key Endpoints:**
```
GET    /                             - Admin dashboard
POST   /api/users/sync               - Sync Firebase users to PostgreSQL
GET    /api/users                    - List users
POST   /api/users                    - Create user
PUT    /api/users/:id                - Update user
DELETE /api/users/:id                - Delete user
GET    /api/devices                  - List devices
PUT    /api/devices/:id              - Update device
GET    /api/settings                 - System settings
```

**Authentication:**
- Firebase Auth (Google Sign-In)
- Session tokens

---

### Database Connection

| Component | Host | Port | Database | User |
|-----------|------|------|----------|------|
| PostgreSQL | `13.205.201.82` (via localhost on EC2) | `5432` | `sensor_db` | `sensor_admin` |
| Firestore | Cloud (Firebase) | N/A | Firestore | Service Account |

---

### Port Summary Table

| Port | Service | Status | Access |
|------|---------|--------|--------|
| **80** | HTTP (Nginx) | External | Public |
| **443** | HTTPS (Nginx) | External | Public |
| **3001** | Admin Portal (Node.js) | Internal/External | Public |
| **3001** | Alert API (Node.js) | Internal | Nginx only |
| **3002** | Sensor Control API (Node.js) | Internal | Nginx only |
| **5432** | PostgreSQL | Internal | Localhost only |
| **22** | SSH | External | Restricted (Security Group) |

---

### Network Flow Examples

#### Example 1: Mobile App Sends Alert
```
Mobile App
  │
  #### ⚠️ IMPORTANT: Current vs Documented Architecture

  **Documented Architecture:** Services are behind Nginx reverse proxy on ports 80/443 with path-based routing.

  **Current Actual Deployment:** Services are directly accessible on their raw ports (3001, 3002) from public EC2 IP. Nginx reverse proxy configuration is documented below as the aspirational architecture but is not yet fully deployed in production.

  **Accessing Services (Current State):**
  - Alert API: `http://13.205.201.82:3001/alert-api/api/...`
  - Sensor Control: `http://13.205.201.82:3002/api/...`
  - Admin Portal: `http://13.205.201.82:3001/`

  ---
  ├─ POST http://13.205.201.82/alert-api/api/alerts
  │
  ▼
Nginx (Port 80/443)
  │
  ├─ (Routes to internal port 3001)
  │
  ▼
Alert API (Port 3001)
  │
  ├─ Validates x-device-secret header
  ├─ Stores alert in PostgreSQL
  ├─ Pushes Firebase notification
  └─ Returns 200 OK
```

#### Example 2: Device Registration
```
Raspberry Pi / Device
  │
  ├─ POST http://13.205.201.82/alert-api/api/devices/register
  │  └─ Header: x-device-secret
  │
  ▼
Nginx (Port 80/443)
  │
  ├─ (Routes to internal port 3001)
  │
  ▼
Alert API (Port 3001)
  │
  ├─ Validates x-device-secret
  ├─ Creates device record in PostgreSQL
  ├─ Syncs to Firebase Firestore
  └─ Returns deviceId and registration token
```

#### Example 3: Sensor Data Control
```
Mobile App
  │
  ├─ POST http://13.205.201.82/sensor-api/api/device-control
  │  └─ Header: x-api-key or Firebase token
  │
  ▼
Nginx (Port 80/443)
  │
  ├─ (Routes to internal port 3002)
  │
  ▼
Sensor Control API (Port 3002)
  │
  ├─ Validates device ownership
  ├─ Writes command to Firebase Realtime DB
  ├─ Logs to PostgreSQL
  └─ Returns command ID
```

---

### Security Configuration

**Firewall Rules (AWS Security Group):**
```
Inbound Rules:
├─ Port 22 (SSH) ─────→ IP: Your-Admin-IP/32
├─ Port 80 (HTTP) ────→ 0.0.0.0/0 (Public)
├─ Port 443 (HTTPS) ──→ 0.0.0.0/0 (Public)
└─ Port 5432 (PostgreSQL) ─→ DENY (internal only)

(Ports 3000, 3001, 3002 are internal only - not exposed)
```

**CORS Configuration:**
- Alert API: Allows requests from mobile app (Firebase origin)
- Sensor Control API: Restricts to authorized app origins
- Admin Portal: Restricted to logged-in users only

---

### Environment Variables (EC2)

Create `.env` file on EC2 at `/home/ec2-user/rutag-app-backend/.env`:

```bash
# Alert API (Port 3001)
PORT=3001
NODE_ENV=production
DATABASE_URL=postgresql://sensor_admin:PASSWORD@localhost:5432/sensor_db
FIREBASE_PROJECT_ID=rutag-app
DEVICE_REGISTRATION_SECRET=your-secret-key-here
API_KEY=admin-portal-api-key-here

# Sensor Control API (Port 3002)
SENSOR_CONTROL_PORT=3002
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sensor_db
DB_USER=sensor_admin
DB_PASSWORD=your-db-password-here
API_KEY=admin-portal-api-key-here
DEVICE_REGISTRATION_SECRET=your-secret-key-here

# Admin Portal (Port 3001)
ADMIN_PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sensor_db
DB_USER=sensor_admin
DB_PASSWORD=your-db-password-here
FIREBASE_PROJECT_ID=rutag-app
FIREBASE_ADMIN_SDK_PATH=/path/to/serviceAccountKey.json
```

---

## 📂 EC2 Deployed File Inventory

The documentation set did not previously contain one canonical list of deployed EC2 files.
This section is now the source-of-truth inventory, based on current deployment scripts and EC2 runbooks.

### 1. Sensor Control Service Host Path

Deployment path: `/home/ubuntu/sensor-control`

Files deployed/used:
- `sensor-control-ec2-server.js`
- `user-guide.html` (uploaded from local `user-guide-server.html`)
- `package.json`
- `package-lock.json`
- `.env`
- `node_modules/` (installed on host)
- `sensor-control.log` (runtime log)

### 2. Admin Portal Service Host Path

Deployment path: `/home/ec2-user/rutag-app-admin`

Files deployed/used:
- `server.js`
- `package.json`
- `package-lock.json`
- `database-schema.sql`
- `.env`
- `public/index.html`
- `public/` (static assets)
- `node_modules/` (installed on host)

### 3. Alert API Service Host Path

Deployment path: `/home/ec2-user/rutag-app-backend` (as referenced in EC2 env setup)

Files deployed/used:
- `server.ec2.alert-api.js`
- `package.json`
- `package-lock.json`
- `.env`
- `serviceAccountKey.json` (runtime-only, never commit)
- `node_modules/` (installed on host)

### 4. Process/Runtime Artifacts

Managed at runtime:
- PM2 process metadata for `admin-portal`
- Optional PM2 process metadata for `alert-api` and `sensor-control`
- `sensor-control.log` and PM2-managed logs

### 5. Source References Used For This Inventory

- `deploy-user-guide-to-ec2.ps1`
- `EC2_USER_GUIDE_DEPLOYMENT.md`
- `admin-portal-v2/deploy-to-ec2.sh`
- `Documentation/ARCHITECTURE_OVERVIEW.md` (EC2 env/path sections)

---

## 📈 Performance Characteristics

| Component | Typical Latency | Throughput | Scalability |
|-----------|-----------------|-----------|------------|
| Sensor → API | 100-500ms | 100+ devices | Vertical |
| API → Firebase | 50-200ms | 1000s ops/sec | Horizontal |
| Firebase → Mobile | 100-500ms (near realtime) | 1000s users | Horizontal |
| WebRTC Video | <500ms p2p | 1080p25fps | Per stream |
| Alert Processing | 1-5 seconds | 100s alerts/sec | Horizontal |

---

## 🔒 Compliance & Standards

- ✅ HTTPS/TLS encryption
- ✅ Firebase industry-standard auth
- ✅ Data residency (configurable by region)
- ✅ GDPR compliance ready (user data deletion)
- ✅ No personal data stored without consent
- ✅ Activity logging (audit trails)

---

## 📞 System Monitoring

### Key Metrics to Monitor
```
Application Level
├── API response times
├── Database query times
├── Error rates by endpoint
├── Active user sessions
└── Alert processing latency

Infrastructure Level
├── CPU usage
├── Memory usage
├── Network I/O
├── Disk space
└── Service availability

Business Metrics
├── Active devices
├── Alerts generated/day
├── User sessions/day
└── Feature usage statistics
```

---

**Architecture Last Updated:** March 25, 2026  
**Status:** ✅ Production Ready
