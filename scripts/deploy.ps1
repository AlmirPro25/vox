# VOX-BRIDGE Quick Deploy Script for Windows
# Run this after setting up your VPS

param(
    [Parameter(Mandatory=$true)]
    [string]$ServerIP,
    
    [Parameter(Mandatory=$true)]
    [string]$Domain,
    
    [Parameter(Mandatory=$true)]
    [string]$Email
)

Write-Host "🚀 VOX-BRIDGE Deploy Script" -ForegroundColor Cyan
Write-Host "Server: $ServerIP"
Write-Host "Domain: $Domain"
Write-Host ""

# Check if SSH key exists
if (-not (Test-Path "~/.ssh/id_rsa.pub")) {
    Write-Host "⚠️ No SSH key found. Generate one with: ssh-keygen" -ForegroundColor Yellow
    exit 1
}

Write-Host "📦 Step 1: Copying files to server..." -ForegroundColor Green
scp -r . root@${ServerIP}:/root/vox-bridge

Write-Host "🔧 Step 2: Setting up server..." -ForegroundColor Green
ssh root@$ServerIP @"
cd /root/vox-bridge

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
fi

# Generate SSL
chmod +x scripts/init-ssl.sh
./scripts/init-ssl.sh $Domain $Email

# Create .env from template
cp .env.production .env
sed -i 's/vox-bridge.com/$Domain/g' .env

# Generate random JWT secret
JWT_SECRET=\$(openssl rand -base64 32)
sed -i "s/your-super-secret-jwt-key-min-32-chars-here/\$JWT_SECRET/g" .env

# Generate random DB password
DB_PASS=\$(openssl rand -base64 16)
sed -i "s/your-secure-database-password/\$DB_PASS/g" .env

# Start services
docker compose -f docker-compose.prod.yml up -d

echo "✅ Deploy complete!"
echo "🌐 Your site: https://$Domain"
"@

Write-Host ""
Write-Host "✅ Deploy complete!" -ForegroundColor Green
Write-Host "🌐 Your site is live at: https://$Domain" -ForegroundColor Cyan
