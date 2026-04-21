# Admin Portal User Guide

This guide explains how to use the Precision IoT Admin Portal for monitoring devices and managing user access.

## Purpose

The admin portal is used to:

- Sign in as an administrator
- View dashboard totals for devices and users
- Refresh sync data from backend systems
- Restrict or allow devices
- Block or unblock app users
- Edit display names for eligible email/password users
- Generate password reset links for eligible non-Gmail email/password users
- Delete users and devices

## Accessing the Portal

1. Open the admin portal URL in your browser.
2. Enter the admin username and password.
3. Click the login button.
4. After successful login, the main portal opens on the Dashboard tab.

If login fails, verify that the admin credentials in the server environment are correct.

## Main Areas

The portal has three main tabs:

- Dashboard
- Devices
- Users

It also includes:

- A `Sync Data` button to refresh backend data
- A logout action to end the admin session

## Dashboard

The Dashboard shows summary counts for:

- Total devices
- Active devices
- Total users
- Blocked users

Use this tab when you want a quick operational overview.

## Sync Data

The `Sync Data` button triggers a backend refresh and then reloads dashboard, device, and user data.

Typical use cases:

- A newly registered app user is not visible yet
- A recently changed device state is not visible yet
- You want to force a fresh read instead of waiting for background refresh

When the sync completes, the portal displays a short status message showing synced user and device totals.

## Devices Tab

The Devices tab lists:

- Device ID
- Device name
- Location
- Status
- Last seen timestamp

### Device Status

- `Active` means the device is currently allowed
- `Restricted` means the device has been disabled through the portal

### Device Actions

Each device row supports these actions:

#### Restrict or Allow

- Click `Restrict` to disable an active device
- Click `Allow` to re-enable a restricted device

This changes the device access state in the backend.

#### Delete Device

- Click `Delete` to permanently remove the device record
- Confirm the action in the browser prompt

Use this only when the device record should no longer exist in the system.

## Users Tab

The Users tab lists:

- User ID
- Email
- Display name
- Authentication type
- Status
- Last login timestamp

### Authentication Types

- `Google` for Google-authenticated users
- `Email/Password` for manual credential users

### User Status

- `Active` means the user can access the app
- `Blocked` means the user cannot access the app

### User Actions

Each user row supports one or more of the following actions.

#### Block or Unblock

- Click `Block` to prevent the user from accessing the app
- Click `Unblock` to restore access

This is especially important for email/password users created through app sign-up. Those users are created in a blocked state by default and must be unblocked by an administrator before first login succeeds.

#### Edit Display Name

This action is available only for eligible `Email/Password` users.

Steps:

1. Click `Edit Display Name`
2. Enter the updated name in the prompt
3. Confirm the change

The new display name is then saved through the backend.

#### Forgot Password

This action is available only for eligible `Email/Password` users.

Steps:

1. Click `Forgot Password`
2. Confirm reset link generation
3. Copy the generated reset link from the clipboard prompt or browser prompt
4. Share that link with the user securely

Important notes:

- This option is not available for Google users
- This option is not available for Gmail-address users on the password flow
- The portal generates a reset link; it does not directly change the password in the portal UI

#### Delete User

Click `Delete` to permanently remove the user.

This action removes account data from:

- The EC2-backed application database
- Firebase authentication and related backend-managed records

Use this only when the account should be removed completely.

## Email/Password Sign-Up Approval Flow

For users created from the mobile app:

1. The user signs up from the app
2. The backend receives the new credentials
3. The account is created in blocked state by default
4. The admin sees the user in the Users tab as `Blocked`
5. The admin clicks `Unblock`
6. The user can then sign in with the same email and password

If the user reports that sign-up succeeded but login is still denied, verify that the row shows `Active` after the unblock operation.

## Auto Refresh Behavior

The portal refreshes visible data automatically about every 10 seconds.

This means:

- Dashboard counts update automatically
- Device rows update automatically while the Devices tab is open
- User rows update automatically while the Users tab is open

You can still use `Sync Data` when you want an immediate backend refresh.

## Logout

To end the admin session:

1. Click the logout action
2. The portal clears the session
3. The login screen appears again

## Troubleshooting

### Login does not work

- Verify the admin username and password on the EC2 server `.env`
- Restart the PM2 process if credentials were recently changed
- Confirm the server is healthy at the health endpoint

### User is still blocked after admin action

- Refresh the Users tab
- Use `Sync Data`
- Confirm the user status changed from `Blocked` to `Active`

### Forgot Password button is missing

The button appears only for `Email/Password` users.

It will not appear for:

- Google users
- Gmail-address users
- users that are not stored as `Email/Password`

### Device or user changes are not visible

- Wait for auto refresh
- Use `Sync Data`
- Reload the browser page

## Related Files

- `app-user-guide.html` for the mobile app user guide
- `change_admin_portal_password.md` for admin credential change steps