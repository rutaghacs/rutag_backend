#!/usr/bin/env node

/**
 * 🚨 Alert API Backend Server
 * Receives alerts from external sources and pushes notifications to mobile app
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const WEBSOCKET_CORS_ORIGIN = process.env.WEBSOCKET_CORS_ORIGIN || '*';
const ALERT_IMAGE_UPLOAD_DIR = path.resolve(process.env.ALERT_IMAGE_UPLOAD_DIR || path.join(__dirname, 'uploads'));
const ALERT_IMAGE_PUBLIC_PATH = (process.env.ALERT_IMAGE_PUBLIC_PATH || '/alert-api/uploads').replace(/\/$/, '');

const io = new Server(server, {
  cors: {
    origin: WEBSOCKET_CORS_ORIGIN,
    methods: ['GET', 'POST']
  }
});

const databaseUrl = process.env.DATABASE_URL || '';
const isLocalDbUrl = /@(localhost|127\.0\.0\.1|::1)(:\d+)?\//i.test(databaseUrl);
const dbSslOverride = (process.env.DB_SSL || '').toLowerCase();
const useDbSsl = dbSslOverride
  ? dbSslOverride === 'true'
  : (process.env.NODE_ENV === 'production' && !isLocalDbUrl);

// Initialize PostgreSQL connection for user blocking checks
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: useDbSsl ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err);
});

console.log('🔌 PostgreSQL connection initialized for user blocking checks');
console.log(`🔐 PostgreSQL SSL enabled: ${useDbSsl}`);

// Middleware
// Behind Nginx/ALB we must trust proxy headers so rate limiting keys users correctly.
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(ALERT_IMAGE_UPLOAD_DIR));

fs.mkdirSync(ALERT_IMAGE_UPLOAD_DIR, { recursive: true });

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

function initializeFirebase() {
  try {
    if (!firebaseInitialized) {
      let serviceAccount;
      
      // Prioritize individual environment variables (more reliable for Railway)
      if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
        serviceAccount = {
          type: "service_account",
          project_id: process.env.FIREBASE_PROJECT_ID || "rutag-app",
          private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
          private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          client_id: process.env.FIREBASE_CLIENT_ID,
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
          auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
          client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
        };
        console.log('✅ Using individual Firebase environment variables');
      } 
      // Fallback to service account file (for local development)
      else {
        try {
          serviceAccount = require('./serviceAccountKey.json');
          console.log('✅ Using serviceAccountKey.json file');
        } catch (fileError) {
          throw new Error('No Firebase credentials provided. Set FIREBASE_PRIVATE_KEY and FIREBASE_CLIENT_EMAIL environment variables');
        }
      }
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || "https://rutag-app-default-rtdb.asia-southeast1.firebasedatabase.app"
      });
      
      firebaseInitialized = true;
      console.log('✅ Firebase Admin SDK initialized');
    }
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    console.log('⚠️  Server will continue without Firebase (notifications disabled)');
  }
}

function normalizeAlertTimestamp(rawTimestamp) {
  if (!rawTimestamp) return new Date();

  const dateCandidate = new Date(rawTimestamp);
  if (!Number.isNaN(dateCandidate.getTime())) {
    return dateCandidate;
  }

  const numericTimestamp = Number(rawTimestamp);
  if (Number.isFinite(numericTimestamp)) {
    return new Date(numericTimestamp);
  }

  return new Date();
}

function sanitizeFileSegment(value, fallback) {
  const cleaned = String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_');
  return cleaned || fallback;
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0);
  }

  if (value === undefined || value === null) {
    return [];
  }

  const single = String(value).trim();
  return single ? [single] : [];
}

function getAlertImagePublicBaseUrl(req) {
  if (process.env.ALERT_IMAGE_PUBLIC_BASE_URL) {
    return process.env.ALERT_IMAGE_PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  return `${req.protocol}://${req.get('host')}${ALERT_IMAGE_PUBLIC_PATH}`;
}

function normalizeAlertScreenshots(deviceId, screenshotInput, req) {
  const base = getAlertImagePublicBaseUrl(req);
  const safeDeviceId = sanitizeFileSegment(deviceId, 'unknown-device');

  return toStringArray(screenshotInput).map((raw) => {
    const item = raw.replace(/\\/g, '/').trim();

    if (/^https?:\/\//i.test(item)) {
      return item;
    }

    if (item.startsWith('/alert-api/uploads/')) {
      return `${req.protocol}://${req.get('host')}${item}`;
    }

    if (item.startsWith('/uploads/')) {
      return `${base}/${item.replace(/^\/uploads\//, '')}`;
    }

    if (item.startsWith('alerts/')) {
      return `${base}/${item.replace(/^\/+/, '')}`;
    }

    if (item.startsWith('/')) {
      return `${req.protocol}://${req.get('host')}${item}`;
    }

    const encodedFileName = encodeURIComponent(path.basename(item));
    return `${base}/alerts/${safeDeviceId}/${encodedFileName}`;
  });
}

/**
 * Middleware: verify Firebase ID token from "Authorization: Bearer <token>" header.
 * Sets req.uid to the verified UID on success.
 */
async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const idToken = authHeader.slice(7);
  try {
    initializeFirebase();
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    console.warn('[Auth] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

async function ensureAlertSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_user_membership (
      membership_id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      device_id VARCHAR(255) NOT NULL,
      added_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      removed_at TIMESTAMP WITHOUT TIME ZONE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_membership_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE,
      CONSTRAINT fk_membership_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      alert_id UUID PRIMARY KEY,
      device_id VARCHAR(255) NOT NULL,
      notification_type VARCHAR(64) NOT NULL,
      detected_objects TEXT[] NOT NULL,
      risk_label VARCHAR(64) NOT NULL,
      predicted_risk VARCHAR(64),
      description TEXT[] NOT NULL,
      screenshots TEXT[] NOT NULL DEFAULT '{}',
      alert_generated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
      model_version VARCHAR(128),
      confidence_score DOUBLE PRECISION,
      additional_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_alert_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alert_recipients (
      alert_id UUID NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      delivered_realtime BOOLEAN NOT NULL DEFAULT false,
      acknowledged BOOLEAN NOT NULL DEFAULT false,
      acknowledged_at TIMESTAMP WITHOUT TIME ZONE,
      user_rating INTEGER,
      rating_accuracy INTEGER,
      rating_notes TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (alert_id, user_id),
      CONSTRAINT fk_recipient_alert FOREIGN KEY (alert_id) REFERENCES alerts(alert_id) ON DELETE CASCADE,
      CONSTRAINT fk_recipient_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      token_id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      token TEXT NOT NULL,
      platform VARCHAR(32) NOT NULL DEFAULT 'unknown',
      provider VARCHAR(32) NOT NULL DEFAULT 'fcm',
      app_build VARCHAR(64),
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_push_token_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE,
      CONSTRAINT uq_push_token UNIQUE (token)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_delivery_logs (
      delivery_id VARCHAR(36) PRIMARY KEY,
      alert_id UUID NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      token TEXT,
      provider VARCHAR(32) NOT NULL DEFAULT 'fcm',
      success BOOLEAN NOT NULL DEFAULT false,
      provider_message_id TEXT,
      error_message TEXT,
      sent_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_delivery_alert FOREIGN KEY (alert_id) REFERENCES alerts(alert_id) ON DELETE CASCADE,
      CONSTRAINT fk_delivery_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_device_profiles (
      user_id VARCHAR(255) NOT NULL,
      device_id VARCHAR(255) NOT NULL,
      label VARCHAR(255),
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, device_id),
      CONSTRAINT fk_udp_user FOREIGN KEY (user_id) REFERENCES app_users(user_id) ON DELETE CASCADE,
      CONSTRAINT fk_udp_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
    )
  `);

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_active ON device_user_membership (user_id, device_id) WHERE is_active = true`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_membership_device_active ON device_user_membership (device_id, is_active, added_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_alerts_device_time ON alerts (device_id, alert_generated_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_alerts_created_at ON alerts (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_alert_recipients_user ON alert_recipients (user_id, created_at DESC)`);
  // Migration: add rating_notes if the table was created before this column existed
  await pool.query(`ALTER TABLE alert_recipients ADD COLUMN IF NOT EXISTS rating_notes TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_push_tokens_user_active ON push_tokens (user_id, is_active, last_seen_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_push_delivery_logs_alert ON push_delivery_logs (alert_id, sent_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS ix_user_device_profiles_user ON user_device_profiles (user_id, updated_at DESC)`);
}

function serializeAlertForClient(row) {
  return {
    id: row.alert_id,
    alertId: row.alert_id,
    userId: row.user_id,
    deviceId: row.device_id,
    notificationType: row.notification_type,
    detectedObjects: row.detected_objects || [],
    riskLabel: row.risk_label,
    predictedRisk: row.predicted_risk,
    description: row.description || [],
    screenshots: row.screenshots || [],
    alertGeneratedAt: row.alert_generated_at,
    modelVersion: row.model_version,
    confidenceScore: row.confidence_score,
    additionalData: row.additional_data || {},
    acknowledged: row.acknowledged === true,
    userRating: row.user_rating,
    ratingAccuracy: row.rating_accuracy,
    ratingNotes: row.rating_notes,
    timestamp: row.created_at,
    deliveredRealtime: row.delivered_realtime === true,
  };
}

async function getEligibleUsersForAlert(deviceId, alertGeneratedAt) {
  const query = `
    SELECT DISTINCT m.user_id
    FROM device_user_membership m
    WHERE m.device_id = $1
      AND m.added_at <= $2
      AND (m.removed_at IS NULL OR m.removed_at > $2)
  `;

  const result = await pool.query(query, [deviceId, alertGeneratedAt]);
  const userIds = result.rows.map((row) => row.user_id).filter(Boolean);

  if (userIds.length > 0) {
    return userIds;
  }

  return [];
}

async function createAlertWithRecipients(deviceId, alert, userIds, alertGeneratedAt) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const alertId = uuidv4();
    await client.query(
      `
      INSERT INTO alerts (
        alert_id,
        device_id,
        notification_type,
        detected_objects,
        risk_label,
        predicted_risk,
        description,
        screenshots,
        alert_generated_at,
        model_version,
        confidence_score,
        additional_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        alertId,
        deviceId,
        alert.notification_type || 'Alert',
        alert.detected_objects || [],
        alert.risk_label,
        alert.predicted_risk || null,
        alert.description || [],
        alert.screenshot || [],
        alertGeneratedAt,
        alert.model_version || null,
        alert.confidence_score ?? null,
        alert.additional_data || {},
      ]
    );

    if (userIds.length > 0) {
      const recipientValues = userIds.map((_, index) => `($1, $${index + 2})`).join(', ');
      await client.query(
        `INSERT INTO alert_recipients (alert_id, user_id) VALUES ${recipientValues}`,
        [alertId, ...userIds]
      );
    }

    await client.query('COMMIT');
    return alertId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markRealtimeDelivered(alertId, userId) {
  await pool.query(
    `
    UPDATE alert_recipients
    SET delivered_realtime = true
    WHERE alert_id = $1 AND user_id = $2
    `,
    [alertId, userId]
  );
}

async function logPushDelivery({ alertId, userId, token, provider, success, providerMessageId, errorMessage }) {
  await pool.query(
    `
    INSERT INTO push_delivery_logs (
      delivery_id,
      alert_id,
      user_id,
      token,
      provider,
      success,
      provider_message_id,
      error_message
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      uuidv4(),
      alertId,
      userId,
      token || null,
      provider || 'fcm',
      success === true,
      providerMessageId || null,
      errorMessage || null,
    ]
  );
}

async function getUserPushTokens(userId) {
  const result = await pool.query(
    `
    SELECT token, provider, platform
    FROM push_tokens
    WHERE user_id = $1 AND is_active = true
    ORDER BY last_seen_at DESC
    `,
    [userId]
  );

  return result.rows;
}

function emitAlertToUser(userId, payload) {
  io.to(`user:${userId}`).emit('alert:new', payload);
}

// Initialize Firebase on startup
initializeFirebase();

/**
 * Generate notification content from alert data
 */
function generateNotificationContent(alert) {
  const riskEmojis = {
    'critical': '🔴',
    'high': '🟠', 
    'medium': '🟡',
    'low': '🟢'
  };

  const riskLevel = alert.risk_label.toLowerCase();
  const emoji = riskEmojis[riskLevel] || '🔵';
  
  const title = `${emoji} ${alert.risk_label} Alert - ${alert.device_identifier}`;
  const body = `${alert.detected_objects.join(', ')}: ${alert.description[0] || 'Alert detected'}`;

  return { title, body, emoji };
}

/**
 * Check if user is blocked
 */
async function isUserBlocked(userId) {
  try {
    const result = await pool.query(
      'SELECT user_id, email, display_name, is_blocked FROM app_users WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      console.log(`ℹ️  User ${userId} not found in app_users`);
      return { blocked: false, exists: false };
    }

    if (result.rows[0].is_blocked) {
      console.log(`🚫 User ${userId} is BLOCKED in admin portal`);
      return {
        blocked: true,
        exists: true,
        reason: 'User is blocked in admin portal'
      };
    }

    return { blocked: false, exists: true };
  } catch (error) {
    console.error('❌ Error checking user block status:', error);
    // On error, allow notification (fail open for availability)
    return { blocked: false };
  }
}

async function getDeviceStatus(deviceId) {
  try {
    const result = await pool.query(
      `SELECT device_id, device_name, location, is_active, last_seen, created_at, updated_at
       FROM devices
       WHERE device_id = $1`,
      [deviceId]
    );

    if (result.rows.length === 0) {
      return { exists: false, active: false };
    }

    return {
      exists: true,
      active: result.rows[0].is_active === true,
      device: result.rows[0]
    };
  } catch (error) {
    console.error('❌ Error checking device status:', error);
    return { exists: false, active: false, error: error.message };
  }
}

async function upsertDeviceInFirestore(deviceId, deviceInfo) {
  if (!firebaseInitialized) {
    throw new Error('Firebase is not initialized');
  }

  const db = admin.firestore();
  const deviceRef = db.collection('devices').doc(deviceId);
  const existingDoc = await deviceRef.get();
  const timestamp = admin.firestore.Timestamp.now();
  const existingData = existingDoc.exists ? existingDoc.data() || {} : {};
  const firestorePayload = {
    label: deviceInfo.label,
    name: deviceInfo.name,
    type: deviceInfo.type || existingData.type || 'sensor_device',
    platform: deviceInfo.platform || existingData.platform || 'linux',
    version: deviceInfo.version || existingData.version || 'unknown',
    location: deviceInfo.location || existingData.location || 'Raspberry Pi',
    isActive: true,
    lastSeen: timestamp
  };

  // Keep existing owner when present; otherwise mark as unassigned for claim flow.
  if (Object.prototype.hasOwnProperty.call(existingData, 'userId')) {
    firestorePayload.userId = existingData.userId;
  } else {
    firestorePayload.userId = null;
  }

  if (!existingDoc.exists) {
    firestorePayload.createdAt = timestamp;
  }

  await deviceRef.set(firestorePayload, { merge: true });
  return firestorePayload;
}

/**
 * Send push notification via Firebase
 */
async function sendPushNotification(userId, alert, notificationContent) {
  if (!firebaseInitialized) {
    console.log('⚠️  Firebase not initialized, skipping push notification');
    return null;
  }

  try {
    // Check if user is blocked
    const blockStatus = await isUserBlocked(userId);
    if (blockStatus.blocked) {
      console.log(`🚫 Skipping notification for blocked user ${userId}: ${blockStatus.reason}`);
      return { blocked: true, reason: blockStatus.reason };
    }

    const userTokens = await getUserPushTokens(userId);
    if (userTokens.length === 0) {
      console.log('⚠️  No active push tokens found for user:', userId);
      return null;
    }

    const detectedObjects = Array.isArray(alert.detected_objects)
      ? alert.detected_objects.join(', ')
      : '';

    let sendCount = 0;
    const errors = [];

    for (const tokenRecord of userTokens) {
      const message = {
        token: tokenRecord.token,
        notification: {
          title: notificationContent.title,
          body: notificationContent.body,
        },
        data: {
          type: 'mlAlert',
          deviceId: String(alert.device_identifier || ''),
          alertId: String(alert.additional_data?.alert_id || uuidv4()),
          riskLabel: String(alert.risk_label || ''),
          detectedObjects: String(detectedObjects || ''),
          timestamp: String(alert.timestamp || '')
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      try {
        const result = await admin.messaging().send(message);
        sendCount += 1;
        errors.push(null);
        console.log('📱 FCM push sent:', result);
      } catch (tokenError) {
        const tokenErrorMessage = tokenError?.message || 'Unknown push error';
        errors.push(tokenErrorMessage);
        console.error('❌ Error sending push notification to token:', tokenErrorMessage);
      }
    }

    return {
      success: sendCount > 0,
      sentCount: sendCount,
      tokenCount: userTokens.length,
      provider: 'fcm',
      errors: errors.filter(Boolean),
    };
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
    return null;
  }
}

/**
 * Get users who have explicitly added this device to their account.
 * Only sends alerts to users who:
 * 1. Have added the device (tracked in Firestore)
 * 2. Are not blocked in PostgreSQL
 * 3. Device is active (not blocked)
 */
async function getUsersForDevice(deviceId) {
  try {
    // First check if device is active (not blocked)
    const deviceResult = await pool.query(
      `SELECT device_id, is_active FROM devices WHERE device_id = $1`,
      [deviceId]
    );

    if (deviceResult.rows.length === 0) {
      console.warn(`⚠️  Device ${deviceId} not registered in admin portal - no alerts will be sent`);
      return [];
    }

    if (deviceResult.rows[0].is_active !== true) {
      console.warn(`⚠️  Device ${deviceId} is blocked/inactive - no alerts will be sent`);
      return [];
    }

    if (!firebaseInitialized) {
      console.warn('⚠️  Firebase not initialized - cannot check device membership');
      return [];
    }

    // Get all users who have added this device (multiple users can add same device)
    const db = admin.firestore();
    const deviceDoc = await db.collection('devices').doc(deviceId).get();

    if (!deviceDoc.exists) {
      console.warn(`⚠️  Device ${deviceId} not found in user devices - no alerts will be sent`);
      return [];
    }

    const deviceData = deviceDoc.data() || {};
    let memberUserIds = [];

    // Support both single user (legacy) and multiple users (new)
    if (Array.isArray(deviceData.userIds)) {
      memberUserIds = deviceData.userIds;
    } else if (deviceData.userId) {
      memberUserIds = [deviceData.userId];
    }

    if (memberUserIds.length === 0) {
      console.warn(`⚠️  No users have added device ${deviceId} - no alerts will be sent`);
      return [];
    }

    // Filter out blocked users from PostgreSQL
    const placeholders = memberUserIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT user_id FROM app_users WHERE user_id IN (${placeholders}) AND is_blocked = false`,
      memberUserIds
    );

    const eligibleUsers = result.rows.map((row) => row.user_id).filter(Boolean);

    if (eligibleUsers.length === 0) {
      console.warn(`⚠️  All users who added device ${deviceId} are blocked - no alerts will be sent`);
      return [];
    }

    console.log(`👥 Alert for device ${deviceId} will be sent to ${eligibleUsers.length} users who added it: ${eligibleUsers.join(', ')}`);
    return eligibleUsers;
  } catch (error) {
    console.error('❌ Error getting users for device:', error);
    return [];
  }
}

/**
 * API Routes
 */

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    firebase: firebaseInitialized,
    websocket: true
  });
});

app.post('/api/push-tokens/register', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.uid;
    const { token, provider = 'fcm', platform = 'unknown', appBuild = null } = req.body || {};

    if (!token) {
      return res.status(400).json({
        error: 'Missing required field: token'
      });
    }

    await pool.query(
      `
      INSERT INTO push_tokens (token_id, user_id, token, provider, platform, app_build, is_active, last_seen_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW(), NOW())
      ON CONFLICT (token)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        provider = EXCLUDED.provider,
        platform = EXCLUDED.platform,
        app_build = EXCLUDED.app_build,
        is_active = true,
        last_seen_at = NOW(),
        updated_at = NOW()
      `,
      [uuidv4(), userId, token, provider, platform, appBuild]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('❌ Push token registration error:', error);
    return res.status(500).json({ error: 'Failed to register push token', message: error.message });
  }
});

app.delete('/api/push-tokens/deactivate', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.uid;
    const { token } = req.body || {};

    if (!token) {
      return res.status(400).json({ error: 'Missing required field: token' });
    }

    await pool.query(
      `
      UPDATE push_tokens
      SET is_active = false,
          updated_at = NOW()
      WHERE user_id = $1 AND token = $2
      `,
      [userId, token]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('❌ Push token deactivate error:', error);
    return res.status(500).json({ error: 'Failed to deactivate push token', message: error.message });
  }
});

app.post('/api/device-memberships/add', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.uid;
    const { deviceId } = req.body || {};

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing required field: deviceId' });
    }

    const userResult = await pool.query('SELECT user_id, is_blocked FROM app_users WHERE user_id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (userResult.rows[0].is_blocked === true) {
      return res.status(403).json({ error: 'User is blocked' });
    }

    const deviceResult = await pool.query('SELECT device_id, is_active FROM devices WHERE device_id = $1', [deviceId]);
    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (deviceResult.rows[0].is_active !== true) {
      return res.status(403).json({ error: 'Device is blocked' });
    }

    await pool.query(
      `
      UPDATE device_user_membership
      SET is_active = false,
          removed_at = NOW(),
          updated_at = NOW()
      WHERE user_id = $1 AND device_id = $2 AND is_active = true
      `,
      [userId, deviceId]
    );

    await pool.query(
      `
      INSERT INTO device_user_membership (membership_id, user_id, device_id, added_at, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), true, NOW(), NOW())
      `,
      [uuidv4(), userId, deviceId]
    );

    return res.json({ success: true, userId, deviceId, addedAt: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Device membership add error:', error);
    return res.status(500).json({ error: 'Failed to add device membership', message: error.message });
  }
});

app.post('/api/device-memberships/remove', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.uid;
    const { deviceId } = req.body || {};

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing required field: deviceId' });
    }

    await pool.query(
      `
      UPDATE device_user_membership
      SET is_active = false,
          removed_at = NOW(),
          updated_at = NOW()
      WHERE user_id = $1 AND device_id = $2 AND is_active = true
      `,
      [userId, deviceId]
    );

    return res.json({ success: true, userId, deviceId, removedAt: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Device membership remove error:', error);
    return res.status(500).json({ error: 'Failed to remove device membership', message: error.message });
  }
});

app.get('/api/devices/user', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.uid;

    const result = await pool.query(
      `
      SELECT
        d.device_id,
        d.device_name,
        d.location,
        d.is_active,
        d.last_seen,
        m.added_at,
        p.label AS user_label
      FROM device_user_membership m
      INNER JOIN devices d ON d.device_id = m.device_id
      LEFT JOIN user_device_profiles p
        ON p.user_id = m.user_id
       AND p.device_id = m.device_id
      WHERE m.user_id = $1
        AND m.is_active = true
      ORDER BY m.added_at DESC
      `,
      [userId]
    );

    const devices = result.rows.map((row) => ({
      id: row.device_id,
      deviceId: row.device_id,
      name: row.device_name || row.location || row.device_id,
      label: row.user_label || row.device_name || row.location || row.device_id,
      userLabel: row.user_label || null,
      userId,
      userIds: [userId],
      active: row.is_active === true,
      lastSeen: row.last_seen,
      claimedAt: row.added_at,
    }));

    return res.json({ success: true, userId, count: devices.length, devices });
  } catch (error) {
    console.error('❌ User devices fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch user devices', message: error.message });
  }
});

app.get('/api/devices/available', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.uid;

    const result = await pool.query(
      `
      SELECT
        d.device_id,
        d.device_name,
        d.location,
        d.is_active,
        d.last_seen
      FROM devices d
      WHERE d.is_active = true
        AND NOT EXISTS (
          SELECT 1
          FROM device_user_membership m
          WHERE m.user_id = $1
            AND m.device_id = d.device_id
            AND m.is_active = true
        )
      ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST
      `,
      [userId]
    );

    const devices = result.rows.map((row) => ({
      id: row.device_id,
      deviceId: row.device_id,
      name: row.device_name || row.location || row.device_id,
      label: row.device_name || row.location || row.device_id,
      active: row.is_active === true,
      lastSeen: row.last_seen,
      userIds: [],
      userId: null,
    }));

    return res.json({ success: true, userId, count: devices.length, devices });
  } catch (error) {
    console.error('❌ Available devices fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch available devices', message: error.message });
  }
});

app.put('/api/devices/:deviceId/profile', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.uid;
    const { deviceId } = req.params;
    const { label } = req.body || {};

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    if (typeof label !== 'string' || label.trim() === '') {
      return res.status(400).json({ error: 'label must be a non-empty string' });
    }

    const membership = await pool.query(
      `
      SELECT 1
      FROM device_user_membership
      WHERE user_id = $1
        AND device_id = $2
        AND is_active = true
      LIMIT 1
      `,
      [userId, deviceId]
    );
    if (membership.rowCount === 0) {
      return res.status(403).json({ error: 'No active membership for this device' });
    }

    await pool.query(
      `
      INSERT INTO user_device_profiles (user_id, device_id, label, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id, device_id)
      DO UPDATE SET
        label = EXCLUDED.label,
        updated_at = NOW()
      `,
      [userId, deviceId, label.trim()]
    );

    return res.json({ success: true, userId, deviceId, label: label.trim() });
  } catch (error) {
    console.error('❌ Device profile update error:', error);
    return res.status(500).json({ error: 'Failed to update device profile', message: error.message });
  }
});

app.get('/api/alerts/user/:userId', verifyFirebaseToken, async (req, res) => {
  try {
    const userId = req.uid; // verified — ignore URL param to prevent impersonation
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const sinceRaw = req.query.since;

    const params = [userId, limit];
    let query = `
      SELECT
        a.alert_id,
        a.device_id,
        a.notification_type,
        a.detected_objects,
        a.risk_label,
        a.predicted_risk,
        a.description,
        a.screenshots,
        a.alert_generated_at,
        a.model_version,
        a.confidence_score,
        a.additional_data,
        a.created_at,
        r.user_id,
        r.acknowledged,
        r.user_rating,
        r.rating_accuracy,
        r.rating_notes,
        r.delivered_realtime
      FROM alert_recipients r
      INNER JOIN alerts a ON a.alert_id = r.alert_id
      WHERE r.user_id = $1
    `;

    if (sinceRaw) {
      params.push(new Date(sinceRaw));
      query += ` AND a.created_at > $${params.length}`;
    }

    query += ' ORDER BY a.created_at DESC LIMIT $2';

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      userId,
      count: result.rows.length,
      alerts: result.rows.map(serializeAlertForClient),
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ User alerts fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch alerts', message: error.message });
  }
});

// Rate / acknowledge an alert — called by the mobile app
app.patch('/api/alerts/:alertId/rating', verifyFirebaseToken, async (req, res) => {
  try {
    const { alertId } = req.params;
    const userId = req.uid;
    const { rating, isAccurate, notes } = req.body;

    if (!alertId) {
      return res.status(400).json({ error: 'alertId is required' });
    }

    if (rating !== undefined) {
      const r = Number(rating);
      if (!Number.isInteger(r) || r < 1 || r > 10) {
        return res.status(400).json({ error: 'rating must be an integer between 1 and 10' });
      }
    }

    // Verify the user is a recipient of this alert
    const memberCheck = await pool.query(
      `SELECT 1 FROM alert_recipients WHERE alert_id = $1 AND user_id = $2 LIMIT 1`,
      [alertId, userId]
    );
    if (memberCheck.rowCount === 0) {
      return res.status(403).json({ error: 'User is not a recipient of this alert' });
    }

    const setParts = [];
    const values = [];
    let idx = 1;

    if (rating !== undefined) {
      setParts.push(`user_rating = $${idx++}`);
      values.push(Math.min(10, Math.max(1, Number(rating))));
    }
    if (isAccurate !== undefined) {
      // store as 1 (accurate) or 0 (inaccurate) in rating_accuracy column
      setParts.push(`rating_accuracy = $${idx++}`);
      values.push(isAccurate ? 1 : 0);
    }
    if (notes !== undefined) {
      setParts.push(`rating_notes = $${idx++}`);
      values.push(notes);
    }

    // Always mark acknowledged on any rating action
    setParts.push(`acknowledged = true`);
    setParts.push(`acknowledged_at = NOW()`);

    if (setParts.length === 2) {
      // Only ack fields — still proceed to mark acknowledged
    }

    values.push(alertId, userId);
    await pool.query(
      `UPDATE alert_recipients
          SET ${setParts.join(', ')}
        WHERE alert_id = $${idx++} AND user_id = $${idx++}`,
      values
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('[Alert API] Error rating alert:', error);
    return res.status(500).json({ error: 'Failed to rate alert', message: error.message });
  }
});

// Register a device through the alert API behind Nginx
app.post('/api/devices/register', async (req, res) => {
  try {
    const expectedSecret = process.env.DEVICE_REGISTRATION_SECRET;
    const providedSecret = req.get('x-device-secret');

    if (!expectedSecret) {
      return res.status(503).json({
        error: 'DEVICE_REGISTRATION_SECRET is not configured on the server'
      });
    }

    if (!providedSecret || providedSecret !== expectedSecret) {
      return res.status(401).json({
        error: 'Unauthorized device registration request'
      });
    }

    const { deviceId, label, name, platform, version, location } = req.body || {};
    const finalDeviceId = deviceId || uuidv4();
    const finalName = label || name || `Device-${finalDeviceId.substring(0, 8)}`;
    const finalLocation = location || 'Raspberry Pi';
    const existingDevice = await getDeviceStatus(finalDeviceId);

    const insertQuery = `
      INSERT INTO devices (device_id, device_name, location, is_active, last_seen, created_at, updated_at)
      VALUES ($1, $2, $3, true, NOW(), NOW(), NOW())
      ON CONFLICT (device_id) DO UPDATE
      SET device_name = EXCLUDED.device_name,
          location = EXCLUDED.location,
          is_active = true,
          last_seen = NOW(),
          updated_at = NOW()
      RETURNING device_id, device_name, location, is_active, last_seen, created_at, updated_at
    `;

    const result = await pool.query(insertQuery, [
      finalDeviceId,
      finalName,
      finalLocation
    ]);

    try {
      await upsertDeviceInFirestore(finalDeviceId, {
        label: finalName,
        name: finalName,
        platform,
        version,
        location: finalLocation,
        type: 'sensor_device'
      });
    } catch (firestoreError) {
      if (!existingDevice.exists) {
        await pool.query('DELETE FROM devices WHERE device_id = $1', [finalDeviceId]);
      }
      throw firestoreError;
    }

    console.log('🆕 Device registered via API:', {
      deviceId: finalDeviceId,
      deviceName: finalName,
      location: finalLocation
    });

    res.json({
      success: true,
      message: 'Device registered successfully',
      deviceId: finalDeviceId,
      device: result.rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Device registration error:', error);
    res.status(500).json({
      error: 'Failed to register device',
      message: error.message
    });
  }
});

// Receive and process alerts
app.post('/api/alerts', async (req, res) => {
  try {
    const { deviceId, alert } = req.body;

    // Validate required fields
    if (!deviceId || !alert) {
      return res.status(400).json({
        error: 'Missing required fields: deviceId, alert'
      });
    }

    const notificationType = String(alert.notification_type || 'Alert');
    const normalizedDetectedObjects = toStringArray(alert.detected_objects || alert.detected_condition);
    const normalizedDescription = toStringArray(alert.description);

    if (normalizedDetectedObjects.length === 0 || !alert.risk_label) {
      return res.status(400).json({
        error: 'Invalid alert data: missing detected_objects/detected_condition or risk_label'
      });
    }

    const deviceStatus = await getDeviceStatus(deviceId);
    if (deviceStatus.error) {
      return res.status(500).json({
        error: 'Failed to validate device status',
        message: deviceStatus.error
      });
    }

    if (!deviceStatus.exists) {
      return res.status(404).json({
        error: 'Device is not registered',
        deviceId
      });
    }

    if (!deviceStatus.active) {
      return res.status(403).json({
        error: 'Device is restricted and cannot send alerts',
        deviceId
      });
    }

    await pool.query(
      'UPDATE devices SET last_seen = NOW(), updated_at = NOW() WHERE device_id = $1',
      [deviceId]
    );

    console.log('🚨 Received alert:', {
      deviceId,
      type: notificationType,
      risk: alert.risk_label,
      objects: normalizedDetectedObjects.join(', ')
    });

    const alertGeneratedAt = normalizeAlertTimestamp(alert.timestamp);

    // Get users for this device based on membership at alert time (prevents legacy notifications)
    const userIds = await getEligibleUsersForAlert(deviceId, alertGeneratedAt);
    
    if (userIds.length === 0) {
      console.warn('⚠️  No users found for device:', deviceId);
      return res.json({
        success: true,
        message: 'Alert received but no users to notify',
        alertIds: [],
        usersNotified: 0
      });
    }

    // Generate notification content
    const notificationContent = generateNotificationContent(alert);

    const normalizedScreenshots =
      notificationType.toLowerCase() === 'alert'
        ? normalizeAlertScreenshots(deviceId, alert.screenshot || alert.screenshots, req)
        : [];

    const normalizedAlert = {
      ...alert,
      notification_type: notificationType,
      detected_objects: normalizedDetectedObjects,
      predicted_risk: alert.predicted_risk || alert.risk_label,
      description: normalizedDescription,
      screenshot: normalizedScreenshots,
      timestamp: alertGeneratedAt.toISOString(),
      additional_data: {
        ...(alert.additional_data || {}),
      },
    };

    const primaryAlertId = await createAlertWithRecipients(deviceId, normalizedAlert, userIds, alertGeneratedAt);
    normalizedAlert.additional_data.alert_id = primaryAlertId;

    // Send notifications for each user and publish realtime update
    const alertIds = [primaryAlertId];
    const pushResults = [];

    for (const userId of userIds) {
      const realtimePayload = serializeAlertForClient({
        alert_id: primaryAlertId,
        user_id: userId,
        device_id: deviceId,
        notification_type: normalizedAlert.notification_type || 'Alert',
        detected_objects: normalizedAlert.detected_objects || [],
        risk_label: normalizedAlert.risk_label,
        predicted_risk: normalizedAlert.predicted_risk,
        description: normalizedAlert.description || [],
        screenshots: normalizedAlert.screenshot || [],
        alert_generated_at: alertGeneratedAt,
        model_version: normalizedAlert.model_version || null,
        confidence_score: normalizedAlert.confidence_score ?? null,
        additional_data: normalizedAlert.additional_data || {},
        created_at: new Date(),
        acknowledged: false,
        user_rating: null,
        rating_accuracy: null,
        delivered_realtime: true,
      });

      emitAlertToUser(userId, realtimePayload);
      await markRealtimeDelivered(primaryAlertId, userId);

      // Send push notification
      const pushResult = await sendPushNotification(userId, normalizedAlert, notificationContent);
      if (pushResult) {
        pushResults.push({ userId, ...pushResult });
        await logPushDelivery({
          alertId: primaryAlertId,
          userId,
          token: null,
          provider: 'fcm',
          success: pushResult.success === true,
          providerMessageId: null,
          errorMessage: pushResult.success === true ? null : (pushResult.errors || []).join('; '),
        });
      }
    }

    // Response
    res.json({
      success: true,
      message: 'Alert processed successfully',
      alertIds,
      usersNotified: userIds.length,
      pushResults,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error processing alert:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/api/uploads/alert-image', async (req, res) => {
  try {
    const { deviceId, imageBase64, fileName, contentType } = req.body || {};

    if (!deviceId || !imageBase64) {
      return res.status(400).json({ error: 'Missing required fields: deviceId, imageBase64' });
    }

    const deviceStatus = await getDeviceStatus(deviceId);
    if (deviceStatus.error) {
      return res.status(500).json({ error: 'Failed to validate device status', message: deviceStatus.error });
    }

    if (!deviceStatus.exists || !deviceStatus.active) {
      return res.status(403).json({ error: 'Device is not allowed to upload images', deviceId });
    }

    const normalizedContentType = String(contentType || 'image/jpeg').toLowerCase();
    const extension =
      normalizedContentType === 'image/png'
        ? '.png'
        : normalizedContentType === 'image/webp'
          ? '.webp'
          : '.jpg';

    const safeDeviceId = sanitizeFileSegment(deviceId, 'unknown-device');
    const safeName = sanitizeFileSegment(fileName, `alert_${Date.now()}${extension}`);
    const finalFileName = safeName.endsWith(extension) ? safeName : `${safeName}${extension}`;
    const relativeDir = path.join('alerts', safeDeviceId);
    const targetDir = path.join(ALERT_IMAGE_UPLOAD_DIR, relativeDir);
    const targetPath = path.join(targetDir, finalFileName);

    fs.mkdirSync(targetDir, { recursive: true });

    const normalizedBase64 = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
    const imageBuffer = Buffer.from(normalizedBase64, 'base64');
    if (!imageBuffer.length) {
      return res.status(400).json({ error: 'Invalid imageBase64 payload' });
    }

    fs.writeFileSync(targetPath, imageBuffer);

    const relativeUrl = `${relativeDir.replace(/\\/g, '/')}/${encodeURIComponent(finalFileName)}`;
    const imageUrl = `${getAlertImagePublicBaseUrl(req)}/${relativeUrl}`;

    res.json({
      success: true,
      imageUrl,
      relativePath: relativeUrl,
      sizeBytes: imageBuffer.length,
    });
  } catch (error) {
    console.error('❌ Alert image upload error:', error);
    res.status(500).json({ error: 'Failed to upload alert image', message: error.message });
  }
});

// Get server stats
app.get('/api/stats', (req, res) => {
  res.json({
    server: 'Alert API Backend',
    version: '2.0.0',
    uptime: process.uptime(),
    firebase: firebaseInitialized,
    websocket: true,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl
  });
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication token required'));
  }
  try {
    initializeFirebase();
    const decoded = await admin.auth().verifyIdToken(token);
    socket.uid = decoded.uid;
    next();
  } catch (err) {
    next(new Error('Invalid authentication token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.uid;

  socket.join(`user:${userId}`);
  socket.emit('connected', {
    success: true,
    userId,
    timestamp: new Date().toISOString()
  });

  socket.on('disconnect', () => {
    // No-op; disconnects are expected with mobile network changes.
  });
});

// Start server
server.listen(PORT, async () => {
  try {
    await ensureAlertSchema();
    console.log('✅ Alert schema verified');
  } catch (schemaError) {
    console.error('❌ Failed ensuring alert schema:', schemaError.message);
  }

  console.log('🚨 Alert API Backend Server');
  console.log('============================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔥 Firebase initialized: ${firebaseInitialized}`);
  console.log(`🔌 WebSocket enabled: true`);
  console.log(`🆕 Device registration endpoint: http://localhost:${PORT}/api/devices/register`);
  console.log(`📡 Alert endpoint: http://localhost:${PORT}/api/alerts`);
  console.log(`📥 Alerts polling endpoint: http://localhost:${PORT}/api/alerts/user/:userId`);
  console.log(`🔑 Push token endpoint: http://localhost:${PORT}/api/push-tokens/register`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log('============================');
});

module.exports = app;