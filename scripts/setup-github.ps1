# Script para preparar e subir pro GitHub
# Execute: .\scripts\setup-github.ps1

Write-Host "🚀 VOX-BRIDGE - Setup GitHub" -ForegroundColor Cyan
Write-Host ""

# Check if git is installed
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Git não instalado. Baixe em: https://git-scm.com/download/win" -ForegroundColor Red
    exit 1
}

# Initialize git if needed
if (-not (Test-Path ".git")) {
    Write-Host "📁 Inicializando repositório Git..." -ForegroundColor Yellow
    git init
}

# Add all files
Write-Host "📦 Adicionando arquivos..." -ForegroundColor Yellow
git add .

# Commit
Write-Host "💾 Criando commit..." -ForegroundColor Yellow
git commit -m "VOX-BRIDGE - Ready for deployment"

Write-Host ""
Write-Host "✅ Repositório preparado!" -ForegroundColor Green
Write-Host ""
Write-Host "Agora faça:" -ForegroundColor Cyan
Write-Host "1. Crie um repositório no GitHub: https://github.com/new" -ForegroundColor White
Write-Host "2. Execute os comandos abaixo (substitua SEU-USUARIO):" -ForegroundColor White
Write-Host ""
Write-Host "   git remote add origin https://github.com/SEU-USUARIO/vox-bridge.git" -ForegroundColor Gray
Write-Host "   git branch -M main" -ForegroundColor Gray
Write-Host "   git push -u origin main" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Siga o guia em DEPLOY-FREE.md para deploy no Vercel + Render" -ForegroundColor White
