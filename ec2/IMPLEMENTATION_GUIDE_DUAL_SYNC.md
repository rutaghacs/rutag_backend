# Implementation Guide: Dual-System Database Sync

## Overview
This guide explains how to implement seamless synchronization between Firebase (Firestore) and PostgreSQL (admin portal database) for devices and users. Device registration now goes through the Alert API behind Nginx instead of connecting Raspberry Pi directly to PostgreSQL.

---

## Step 1: Clean Up Dummy Data

### On EC2 (PostgreSQL cleanup):
```bash
cd ~/rutag-app-admin

# Run cleanup script
PGPASSWORD='sensor_admin_pass123' psql -h localhost -U sensor_admin -d sensor_db -f ~/cleanup-dummy-data.sql
```

Expected output:
```
DELETE 4
DELETE 3
DELETE 0

Remaining devices: 0
Remaining users: 0
```

### On Local Machine (Firestore cleanup):
```bash
cd C:\Users\SUDIPTA\Downloads\Sensor_app

# Run cleanup script
node cleanup-dummy-firestore.js
```

Expected output:
```
✅ Deleted device: rpi-001
✅ Deleted device: rpi-002
✅ Deleted device: rpi-003
✅ Deleted device: rpi-004
✅ Deleted user: user-001
✅ Deleted user: user-002
✅ Deleted user: user-003

Total devices: 0
Total users: 0
```

---

## Step 2: Register New Devices Through Alert API (Nginx)

### Local or Raspberry Pi:
```bash
cd /path/to/sensor_app

# Create .env for API-based device registration + alert sending
cat > .env << 'EOF'
DEVICE_REGISTRATION_URL=http://13.205.201.82/alert-api/api/devices/register
DEVICE_REGISTRATION_SECRET=your-strong-secret-here
DEVICE_ID_FILE=./device_id.txt
ALERT_API_URL=http://13.205.201.82/alert-api/api/alerts
ADMIN_PORTAL_URL=http://13.205.201.82
CHECK_ACCESS_BEFORE_SEND=true
API_KEY=admin-portal-api-key-here
EOF

# Register device through Nginx -> Alert API -> Firestore + PostgreSQL
node test_device_registration_dual_sync.js
```

This will:
1. Call the Alert API through Nginx
2. Register the device in PostgreSQL on EC2
3. Register the device in Firestore on EC2
4. Save the returned device ID locally for reuse
5. Allow the Pi to send alerts without any Firebase user ID in its `.env`

Example output:
```
✅ Saved device ID to ./device_id.txt

Device ID: a1b2c3d4-e5f6-47g8-h9i0-j1k2l3m4n5o6
Device Name: your-hostname
Registration Path: Raspberry Pi -> Nginx -> Alert API -> Firestore + PostgreSQL
Status: Ready for use

Next steps:
  1. Open admin portal: http://13.205.201.82/
  2. Login with admin/admin123
  3. Check Devices tab - your device should appear
  4. You can now restrict/allow this device
```

---

## Step 3: Update Admin Portal with User Sync Endpoints

### Edit `/home/ec2-user/rutag-app-admin/server.js`

Find this section (around line 48):
```javascript
app.post('/api/login', (req, res) => {
  // ... existing code ...
});
```

**After the `/api/logout` endpoint (around line 62)**, add these new endpoints:

```javascript
// ============================================
// USER SYNC ENDPOINTS
// ============================================

/**
 * User Registration/Sync Endpoint (Called by mobile app after sign-in)
 * POST /api/users/sync
 * Body: { userId, email, displayName }
 */
app.post('/api/users/sync', async (req, res) => {
  try {
    const { userId, email, displayName } = req.body;

    // Validate required fields
    if (!userId || !email) {
      return res.status(400).json({
        error: 'Missing required fields: userId, email'
      });
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM app_users WHERE user_id = $1',
      [userId]
    );

    if (existingUser.rows.length > 0) {
      // Update last_login timestamp
      const updateQuery = `
        UPDATE app_users 
        SET last_login = NOW(),
            display_name = COALESCE($1, display_name)
        WHERE user_id = $2
        RETURNING *
      `;

      const result = await pool.query(updateQuery, [displayName || null, userId]);
      
      console.log(`✅ User updated: ${userId} (${email})`);
      return res.json({
        success: true,
        message: 'User updated successfully',
        user: result.rows[0]
      });
    } else {
      // Create new user
      const insertQuery = `
        INSERT INTO app_users (user_id, email, display_name, is_blocked, last_login, created_at, updated_at)
        VALUES ($1, $2, $3, false, NOW(), NOW(), NOW())
        RETURNING *
      `;

      const result = await pool.query(insertQuery, [userId, email, displayName || email]);
      
      console.log(`✅ User created: ${userId} (${email})`);
      return res.json({
        success: true,
        message: 'User created successfully',
        user: result.rows[0]
      });
    }
  } catch (error) {
    console.error('User sync error:', error);
    
    // Check if it's a duplicate email error
    if (error.code === '23505' && error.constraint === 'app_users_email_key') {
      return res.status(409).json({
        error: 'Email already registered'
      });
    }

    res.status(500).json({
      error: 'Failed to sync user',
      message: error.message
    });
  }
});

/**
 * Sync existing Firestore users to PostgreSQL
 * POST /api/users/sync-all (authenticated endpoint)
 */
app.post('/api/users/sync-all', requireAuth, async (req, res) => {
  try {
    const admin = require('firebase-admin');
    const db = admin.firestore();

    // Get all users from Firestore
    const usersSnapshot = await db.collection('users').get();

    let synced = 0;
    let errors = 0;

    for (const doc of usersSnapshot.docs) {
      try {
        const userId = doc.id;
        const userData = doc.data();
        
        const email = userData.email || `user-${userId}@example.com`;
        const displayName = userData.displayName || userData.email || userId;

        // Upsert to PostgreSQL
        await pool.query(`
          INSERT INTO app_users (user_id, email, display_name, is_blocked, last_login, created_at, updated_at)
          VALUES ($1, $2, $3, false, NOW(), NOW(), NOW())
          ON CONFLICT (user_id) DO UPDATE
          SET email = EXCLUDED.email,
              display_name = EXCLUDED.display_name,
              updated_at = NOW()
        `, [userId, email, displayName]);

        synced++;
      } catch (error) {
        console.error(`Error syncing user ${doc.id}:`, error.message);
        errors++;
      }
    }

    res.json({
      success: true,
      message: `Synced ${synced} users with ${errors} errors`,
      synced,
      errors,
      total: usersSnapshot.size
    });
  } catch (error) {
    console.error('Sync all users error:', error);
    res.status(500).json({
      error: 'Failed to sync users',
      message: error.message
    });
  }
});
```

Then restart the admin portal:
```bash
pm2 restart admin-portal
```

---

## Step 4: Update Mobile App to Sync User on Sign-In

### Edit `sensor_app/app/index.tsx`

Find the sign-in success handler (around line 68):
```typescript
const firebaseUser = await signInWithCredential(auth, credential);
```

**After this line**, add the user sync call:
```typescript
// Sync user to admin portal database
if (firebaseUser.user) {
  try {
    const response = await fetch('http://13.205.201.82/api/users/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: firebaseUser.user.uid,
        email: firebaseUser.user.email,
        displayName: firebaseUser.user.displayName || userInfo.user.name
      })
    });

    if (!response.ok) {
      console.warn('Failed to sync user to admin portal:', await response.text());
    } else {
      console.log('✅ User synced to admin portal');
    }
  } catch (error) {
    console.warn('User sync error:', error);
    // Continue even if sync fails - don't block sign-in
  }
}
```

Complete example block should look like:
```typescript
const firebaseUser = await signInWithCredential(auth, credential);

// Sync user to admin portal database
if (firebaseUser.user) {
  try {
    const response = await fetch('http://13.205.201.82/api/users/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: firebaseUser.user.uid,
        email: firebaseUser.user.email,
        displayName: firebaseUser.user.displayName || userInfo.user.name
      })
    });

    if (!response.ok) {
      console.warn('Failed to sync user:', await response.text());
    }
  } catch (error) {
    console.warn('User sync error:', error);
  }
}

setUser(firebaseUser.user);
setLoading(false);
```

Then rebuild the mobile app.

---

## Step 5: Test the Full Flow

### 1. Verify Device Functionality
```bash
# On local/Pi machine
node test_device_registration_dual_sync.js

# Verify in admin portal
# Login: http://13.205.201.82/
# Go to Devices tab - see your device
# Click "Restrict" - should change status in both systems
```

### 2. Verify User Functionality
```bash
# In mobile app
# Sign in with Google account

# In admin portal (Users tab)
# Should see your user appear
# Click "Block" - user can no longer send alerts
# Click "Unblock" - user can send alerts again
```

### 3. Verify Device Access Control
```bash
# When sending alert via Pi:
# If device is "Restricted": Alert rejected
# If device is "Allowed": Alert accepted

# If user is "Blocked": Alert rejected
# If user is unblocked: Alert accepted
```

---

## API Reference

### Device Registration (Dual-System)
**Endpoint:** `POST /alert-api/api/devices/register` (called by Node.js script)
```bash
node test_device_registration_dual_sync.js
```

**What it does:**
- Sends registration through Nginx to the Alert API
- Creates or updates the device in Firestore
- Creates or updates the device in PostgreSQL
- Saves the device ID locally in `device_id.txt`
- Does not require a Firebase user ID on the Raspberry Pi

---

### User Sync (Mobile App → PostgreSQL)
**Endpoint:** `POST /api/users/sync`

**Request:**
```json
{
  "userId": "firebase-uid",
  "email": "user@example.com",
  "displayName": "User Name"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "user": {
    "user_id": "firebase-uid",
    "email": "user@example.com",
    "display_name": "User Name",
    "is_blocked": false,
    "created_at": "2026-03-12T17:00:00Z",
    "last_login": "2026-03-12T17:00:00Z"
  }
}
```

---

### Bulk User Sync (Firestore → PostgreSQL)
**Endpoint:** `POST /api/users/sync-all` (authenticated)

**Headers:**
```
Content-Type: application/json
Cookie: connect.sid=<session-cookie>
```

**Response:**
```json
{
  "success": true,
  "message": "Synced 10 users with 0 errors",
  "synced": 10,
  "errors": 0,
  "total": 10
}
```

---

## Restrict/Allow Device Flow

1. **Admin clicks "Restrict" in admin portal**
   - PostgreSQL updated: `UPDATE devices SET is_active = false WHERE device_id = ?`
   
2. **When Pi sends alert:**
   - Alert API checks: `SELECT is_active FROM devices WHERE device_id = ?`
   - If `false`: Alert rejected with `403 Device is restricted`
   - If `true`: Alert processed

---

## Block/Unblock User Flow

1. **Admin clicks "Block" in admin portal**
   - PostgreSQL updated: `UPDATE app_users SET is_blocked = true WHERE user_id = ?`
   - Can also insert into `user_blocks` table for additional audit trail
   
2. **When alerts are delivered to apps:**
   - Alert API checks: `SELECT is_blocked FROM app_users WHERE user_id = ?`
   - If blocked: alert storage and push notification are skipped for that user
   - If not blocked: alert is stored in `users/{userId}/mlAlerts` and push is sent if the user has an Expo token

---

## Troubleshooting

### Device not appearing in admin portal
```bash
# Check the API route through Nginx
curl -X POST http://13.205.201.82/alert-api/api/devices/register \
  -H "Content-Type: application/json" \
  -H "x-device-secret: your-strong-secret-here" \
  -d '{"label":"test-device","platform":"linux","version":"manual-test"}'

# Check alert API logs on EC2
pm2 logs alert-api --lines 50

# Check PostgreSQL
PGPASSWORD='sensor_admin_pass123' psql -h localhost -U sensor_admin -d sensor_db
SELECT * FROM devices;

# Check Firestore (from local machine with serviceAccountKey.json)
node -e "const admin = require('firebase-admin'); const sa = require('./serviceAccountKey.json'); admin.initializeApp({credential: admin.credential.cert(sa)}); admin.firestore().collection('devices').get().then(s => console.log(s.size + ' devices'));"
```

### User not syncing after sign-in
Check mobile app logs:
```
Look for: "✅ User synced to admin portal"
or error: "Failed to sync user"
```

Check admin portal logs:
```bash
pm2 logs admin-portal --lines 50
```

### Restrict/Allow not working
Verify PostgreSQL is being updated:
```bash
PGPASSWORD='sensor_admin_pass123' psql -h localhost -U sensor_admin -d sensor_db -c "SELECT device_id, is_active FROM devices;"
```

Test admin portal device precheck:
```bash
curl -H "x-api-key: admin-portal-api-key-here" http://13.205.201.82/api/check-device/<device-id>
```

Check alert API logs:
```bash
pm2 logs alert-api --lines 50
```

---

## Files Summary

| File | Purpose |
|------|---------|
| `cleanup-dummy-data.sql` | Remove dummy devices/users from PostgreSQL |
| `cleanup-dummy-firestore.js` | Remove dummy devices/users from Firestore |
| `alert-api-v2/server.js` | Alert API device registration endpoint behind Nginx |
| `test_device_registration_dual_sync.js` | Register new devices through Alert API |
| `ADMIN_PORTAL_USER_SYNC_ENDPOINT.js` | Reference code for admin portal endpoints |
| `IMPLEMENTATION_GUIDE.md` | This document |

---

## Summary Checklist

- [ ] Run `cleanup-dummy-data.sql` on EC2
- [ ] Run `cleanup-dummy-firestore.js` on local machine
- [ ] Register test device: `node test_device_registration_dual_sync.js`
- [ ] Add user sync endpoints to admin portal
- [ ] Restart admin portal: `pm2 restart admin-portal`
- [ ] Update mobile app sign-in handler
- [ ] Rebuild and test mobile app
- [ ] Verify device appears in admin portal
- [ ] Test restrict/allow functionality
- [ ] Verify user appears after app sign-in
- [ ] Test block/unblock functionality

All systems should now be fully synchronized!
