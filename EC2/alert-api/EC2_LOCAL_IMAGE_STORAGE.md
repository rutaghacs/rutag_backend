Alert images can be stored on EC2 local disk and served through Nginx instead of Firebase Storage.

Server behavior implemented in [server.ec2.alert-api.js](c:/Users/SUDIPTA/Downloads/Sensor_app/temp/ec2/alert/server.ec2.alert-api.js):
1. POST /api/uploads/alert-image accepts JSON with deviceId, fileName, contentType, imageBase64.
2. Files are written under ALERT_IMAGE_UPLOAD_DIR or ./uploads by default.
3. Returned public URLs use ALERT_IMAGE_PUBLIC_BASE_URL if set, otherwise {host}/alert-api/uploads/...

Recommended EC2 directory:
1. /home/ec2-user/alert-api-server/uploads

Recommended environment variables:
```env
ALERT_IMAGE_UPLOAD_DIR=/home/ec2-user/alert-api-server/uploads
ALERT_IMAGE_PUBLIC_BASE_URL=http://13.205.201.82/alert-api/uploads
```

Recommended Nginx config:
```nginx
location /alert-api/uploads/ {
    alias /home/ec2-user/alert-api-server/uploads/;
    autoindex off;
    add_header Cache-Control "public, max-age=31536000";
    try_files $uri =404;
}

location /alert-api/ {
    proxy_pass http://127.0.0.1:3001/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Deployment notes:
1. Create the uploads directory and make it writable by the alert-api process user.
2. Restart Nginx after adding the alias.
3. Restart the alert-api PM2 process after updating environment variables.
4. The Pi image sender now uploads images to /alert-api/api/uploads/alert-image and stores the returned URL in screenshot[].