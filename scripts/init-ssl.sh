#!/bin/bash

# VOX-BRIDGE SSL Certificate Setup Script
# Usage: ./init-ssl.sh your-domain.com your-email@example.com

DOMAIN=$1
EMAIL=$2

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Usage: ./init-ssl.sh <domain> <email>"
    echo "Example: ./init-ssl.sh vox-bridge.com admin@vox-bridge.com"
    exit 1
fi

echo "🔐 Setting up SSL for $DOMAIN..."

# Create directories
mkdir -p certbot/conf certbot/www

# Create temporary nginx config for certificate generation
cat > nginx/nginx.temp.conf << EOF
events { worker_connections 1024; }
http {
    server {
        listen 80;
        server_name $DOMAIN;
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        location / {
            return 200 'VOX-BRIDGE SSL Setup';
            add_header Content-Type text/plain;
        }
    }
}
EOF

echo "📦 Starting temporary nginx..."
docker run -d --name nginx-temp \
    -p 80:80 \
    -v $(pwd)/nginx/nginx.temp.conf:/etc/nginx/nginx.conf:ro \
    -v $(pwd)/certbot/www:/var/www/certbot \
    nginx:alpine

sleep 5

echo "🔑 Requesting certificate from Let's Encrypt..."
docker run --rm \
    -v $(pwd)/certbot/conf:/etc/letsencrypt \
    -v $(pwd)/certbot/www:/var/www/certbot \
    certbot/certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN \
    -d www.$DOMAIN

echo "🧹 Cleaning up..."
docker stop nginx-temp
docker rm nginx-temp
rm nginx/nginx.temp.conf

# Update nginx config with actual domain
sed -i "s/vox-bridge.com/$DOMAIN/g" nginx/nginx.conf

echo "✅ SSL setup complete!"
echo ""
echo "Next steps:"
echo "1. Update your .env.production with your domain"
echo "2. Run: docker-compose -f docker-compose.prod.yml up -d"
echo "3. Your site will be available at https://$DOMAIN"
