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
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

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
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

    const db = admin.firestore();
    
    // Get user's push token (stored in expoPushToken field for backward compatibility)
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    if (!userData?.expoPushToken) {
      console.log('⚠️  No push token found for user:', userId);
      return null;
    }

    const pushToken = userData.expoPushToken;
    const detectedObjects = Array.isArray(alert.detected_objects)
      ? alert.detected_objects.join(', ')
      : '';

    // Send notification via Firebase Cloud Messaging
    const message = {
      token: pushToken,
      notification: {
        title: notificationContent.title,
        body: notificationContent.body,
      },
      data: {
        type: 'mlAlert',
        deviceId: alert.device_identifier,
        alertId: alert.additional_data?.alert_id || uuidv4(),
        riskLabel: alert.risk_label,
        detectedObjects,
        timestamp: alert.timestamp.toString()
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

    const result = await admin.messaging().send(message);
    console.log('📱 FCM push sent:', result);
    return { success: true, messageId: result, provider: 'fcm' };
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
 * Store alert in Firestore
 */
async function storeAlertInFirestore(userId, deviceId, alert) {
  if (!firebaseInitialized) {
    console.log('⚠️  Firebase not initialized, skipping Firestore storage');
    return null;
  }

  try {
    // Check if user is blocked
    const blockStatus = await isUserBlocked(userId);
    if (blockStatus.blocked) {
      console.log(`🚫 Skipping alert storage for blocked user ${userId}: ${blockStatus.reason}`);
      return { blocked: true, reason: blockStatus.reason };
    }

    const db = admin.firestore();
    
    // Create ML alert document
    const alertDoc = {
      deviceId: deviceId,
      deviceIdentifier: alert.device_identifier,
      userId: userId,
      notificationType: alert.notification_type,
      detectedObjects: alert.detected_objects,
      riskLabel: alert.risk_label,
      predictedRisk: alert.predicted_risk,
      description: alert.description,
      screenshots: alert.screenshot || [],
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      alertGeneratedAt: alert.timestamp,
      modelVersion: alert.model_version,
      confidenceScore: alert.confidence_score,
      acknowledged: false,
      rating: null,
      ratingAccuracy: null,
      additionalData: alert.additional_data || {}
    };

    // Store in user's mlAlerts collection
    const alertRef = await db
      .collection('users')
      .doc(userId)
      .collection('mlAlerts')
      .add(alertDoc);

    console.log('💾 Alert stored in Firestore:', alertRef.id);
    return alertRef.id;
  } catch (error) {
    console.error('❌ Error storing alert in Firestore:', error);
    return null;
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
    firebase: firebaseInitialized
  });
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
    const { deviceId, alert, userId: requestedUserId } = req.body;

    // Validate required fields
    if (!deviceId || !alert) {
      return res.status(400).json({
        error: 'Missing required fields: deviceId, alert'
      });
    }

    if (!alert.detected_objects || !alert.risk_label) {
      return res.status(400).json({
        error: 'Invalid alert data: missing detected_objects or risk_label'
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
      type: alert.notification_type,
      risk: alert.risk_label,
      objects: alert.detected_objects.join(', ')
    });

    // Get users for this device
    let userIds = await getUsersForDevice(deviceId);

    // Fallback for direct testing: allow explicitly provided userId if device membership is missing.
    if (userIds.length === 0 && requestedUserId) {
      const blockStatus = await isUserBlocked(requestedUserId);
      if (!blockStatus.blocked) {
        userIds = [requestedUserId];
        console.log(`🧪 Using fallback userId from request for device ${deviceId}: ${requestedUserId}`);
      } else {
        console.warn(`⚠️  Requested fallback user ${requestedUserId} is blocked`);
      }
    }
    
    if (userIds.length === 0) {
      console.warn('⚠️  No users found for device:', deviceId);
      return res.json({
        success: true,
        message: 'Alert received but no users to notify',
        alertIds: [],
        usersNotified: 0,
        fallbackUserRequested: requestedUserId || null
      });
    }

    // Generate notification content
    const notificationContent = generateNotificationContent(alert);

    // Store alert and send notifications for each user
    const alertIds = [];
    const pushResults = [];

    for (const userId of userIds) {
      // Store alert in Firestore
      const alertId = await storeAlertInFirestore(userId, deviceId, alert);
      if (alertId && typeof alertId === 'string') {
        alertIds.push(alertId);
      }

      // Send push notification
      const pushResult = await sendPushNotification(userId, alert, notificationContent);
      if (pushResult) {
        pushResults.push({ userId, ...pushResult });
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

// Get server stats
app.get('/api/stats', (req, res) => {
  res.json({
    server: 'Alert API Backend',
    version: '1.0.0',
    uptime: process.uptime(),
    firebase: firebaseInitialized,
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

// Start server
app.listen(PORT, () => {
  console.log('🚨 Alert API Backend Server');
  console.log('============================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔥 Firebase initialized: ${firebaseInitialized}`);
  console.log(`🆕 Device registration endpoint: http://localhost:${PORT}/api/devices/register`);
  console.log(`📡 Alert endpoint: http://localhost:${PORT}/api/alerts`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log('============================');
});

module.exports = app;