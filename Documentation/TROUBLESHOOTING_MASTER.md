# TROUBLESHOOTING MASTER

This guide centralizes troubleshooting for:
1. Mobile app (`sensor_app`)
2. Backend services (Alert API, Sensor Control API, Firebase functions)
3. Admin portal (`admin-portal-v2`)

Use this document as the first-stop runbook before deep debugging.

## 1. Global Triage Flow

When something fails, follow this order:
1. Confirm internet and DNS reachability from the failing machine.
2. Confirm backend health endpoints are up.
3. Confirm environment variables and secrets are loaded correctly.
4. Confirm database and Firebase are reachable.
5. Check service logs for exact error code and stack trace.
6. Re-test with a minimal known-good request.

## 2. Mobile App Troubleshooting (`sensor_app`)

### 2.1 App does not start or crashes on launch

Checks:
1. Run dependency install in `sensor_app`:
   - `npm install`
2. Clear Expo cache:
   - `npx expo start --clear`
3. Confirm Node version is compatible with Expo SDK used in `package.json`.
4. Confirm `app.json` and `eas.json` are valid JSON.

Common fixes:
1. Delete `node_modules` and reinstall.
2. Regenerate native files if config plugin behavior changed:
   - `npx expo prebuild --clean`
3. Rebuild dev client if native plugin config changed.

### 2.2 Login fails (Google or Email/Password)

Checks:
1. Verify Firebase project config in app files and env values.
2. For Android Google login `DEVELOPER_ERROR (10)`, verify package + SHA values in Firebase.
3. Confirm network reachability to Firebase Auth endpoints.
4. Confirm backend user sync endpoint is reachable from device.

Common fixes:
1. Re-download `google-services.json` after SHA/package updates.
2. Rebuild app after changing Firebase native config.
3. Check server URL scheme (`https://` preferred).

### 2.3 Alerts not visible or notification problems

Checks:
1. Confirm push token registration succeeds.
2. Confirm app has notification permission.
3. Confirm alert documents exist in Firestore for the user.
4. Confirm retention setting is not filtering old alerts from view.

Common fixes:
1. Re-login to refresh token and user listeners.
2. Verify device date/time is correct.
3. Inspect app logs for notification scheduling errors.

### 2.4 Device list empty in app

Checks:
1. Confirm the device was registered via API flow.
2. Confirm Firestore `devices/{deviceId}` exists.
3. Confirm user claim/access mapping is present.
4. Confirm listener query constraints match your schema.

Common fixes:
1. Re-run device registration script.
2. Re-claim the device from app/admin portal.
3. Check Firestore rules for read access.

### 2.5 Camera stream not opening

Checks:
1. Confirm stream URL resolves from phone network.
2. Confirm EC2/Nginx routes are active.
3. Confirm CORS and mixed-content policy are not blocking.
4. Confirm correct protocol and certificates.

Common fixes:
1. Move to HTTPS endpoints for production.
2. Validate API path and query params.
3. Check server logs for 4xx/5xx on stream route.

## 3. Backend Troubleshooting

Backend scope includes:
1. Alert API service
2. Sensor control API
3. Firebase functions
4. PostgreSQL connectivity

### 3.1 Service is down

Checks:
1. Check process manager status (PM2/systemd/host runtime).
2. Hit health endpoint from server itself.
3. Check startup logs for missing env/secrets.

Common fixes:
1. Restart the service process.
2. Restore missing environment variables.
3. Roll back to last known good commit if recent deploy broke boot.

### 3.2 Database connection errors

Checks:
1. Validate `DATABASE_URL` format and credentials.
2. Validate SSL mode for the current environment.
3. Confirm DB host/port are reachable.
4. Confirm required tables/columns exist.

Common fixes:
1. Correct DB URL or SSL toggle.
2. Run pending migrations/schema updates.
3. Increase connection timeout/retry for startup spikes.

### 3.3 Device registration API fails

Checks:
1. Confirm `DEVICE_REGISTRATION_SECRET` is set on server.
2. Confirm client sends `x-device-secret` header.
3. Confirm registration endpoint path is correct.
4. Confirm write permissions to PostgreSQL and Firestore.

Common fixes:
1. Re-sync secret values between Pi and server.
2. Verify Nginx forwarding path.
3. Check backend logs for 401/503 details.

### 3.4 Alerts received but no push notification

Checks:
1. Confirm user is not blocked in admin logic.
2. Confirm push token exists for target user.
3. Confirm Firebase Admin initialized successfully.
4. Confirm alert payload has required fields.

Common fixes:
1. Update stale/missing push tokens.
2. Fix Firebase credentials and restart service.
3. Validate notification payload structure.

### 3.5 CORS, HTTP/HTTPS, and mixed-content issues

Checks:
1. Confirm frontend origin is in CORS allowlist.
2. Confirm protocol consistency between app/web and API.
3. Confirm TLS certificate validity and chain.

Common fixes:
1. Prefer HTTPS everywhere in production.
2. Remove temporary cleartext allowances after cert setup.
3. Restart reverse proxy after TLS config updates.

## 4. Admin Portal Troubleshooting (`admin-portal-v2`)

### 4.1 Admin portal not loading

Checks:
1. Confirm Node process is running.
2. Confirm reverse proxy points to correct port.
3. Confirm static files and `public/index.html` are present.

Common fixes:
1. Restart app process.
2. Rebuild/redeploy static assets.
3. Correct upstream target in proxy config.

### 4.2 Cannot login as admin

Checks:
1. Confirm admin user exists in database.
2. Confirm password hash compare logic is functioning.
3. Confirm session/cookie configuration for current domain/protocol.

Common fixes:
1. Recreate admin user if missing.
2. Reset password and verify bcrypt hash path.
3. Fix secure cookie flags when behind proxy/TLS.

### 4.3 Devices or users missing in portal tables

Checks:
1. Confirm read queries target correct schema/table.
2. Confirm DB connection used by portal is correct.
3. Confirm registration/sync jobs are writing expected rows.

Common fixes:
1. Run schema SQL updates.
2. Repair API sync endpoints.
3. Backfill missing records from source of truth.

### 4.4 Access control changes not reflected in app

Checks:
1. Confirm update endpoint returns success.
2. Confirm write persisted in DB.
3. Confirm app listeners read from the same source.

Common fixes:
1. Re-check access-control table writes.
2. Invalidate caches or refresh listeners.
3. Ensure user and device IDs match exactly.

## 5. Log Collection Checklist

For any unresolved issue, collect:
1. Exact timestamp and timezone.
2. Affected user ID and device ID.
3. API endpoint and full status code.
4. App log snippet and backend log snippet.
5. Request payload sample (without secrets).
6. Last known working version/commit.

## 6. Safe Recovery Steps

If production is impacted:
1. Stop further risky deployments.
2. Roll back to last stable backend/app build.
3. Validate health endpoints and critical user flows.
4. Reintroduce changes incrementally with monitoring.

## 7. Security Notes

1. Never commit sensitive keys (for example service account private keys).
2. Store secrets in environment variables or secret managers.
3. Rotate credentials immediately if exposure is suspected.
4. Prefer HTTPS endpoints in production; treat HTTP allowances as temporary only.

## 8. Escalation Guidance

Escalate when:
1. Data loss is suspected.
2. Authentication is failing for many users.
3. Registration or alert pipeline is fully blocked.
4. Incident duration exceeds acceptable SLA.

Include collected logs and exact reproduction steps in escalation handoff.
