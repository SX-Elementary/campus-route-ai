# push-to-github.ps1
# 用途：把本仓库推送到 GitHub（在你自己电脑的 PowerShell 里运行，不需要 DSH）。
# 前置：1) 本机 SSH 公钥已加到 GitHub  2) GitHub 上已建好空仓库 campus-route-ai
# 用法：右键 → 使用 PowerShell 运行；或  powershell -ExecutionPolicy Bypass -File .\push-to-github.ps1

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

# 沙箱/受限环境下 ssh 无法写入 ~/.ssh/known_hosts，这里改用仓库内的文件
$kh = Join-Path $PSScriptRoot ".git-ssh-known-hosts"
$env:GIT_SSH_COMMAND = 'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile="' + $kh + '"'

Write-Host "=== 1/4 检查 SSH 认证 ===" -ForegroundColor Cyan
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile="$kh" -T git@github.com
if ($LASTEXITCODE -ne 255 -and $LASTEXITCODE -ne 1) {
    Write-Host "（出现 'successfully authenticated' 即表示公钥已生效）" -ForegroundColor DarkGray
}

Write-Host "`n=== 2/4 配置 remote ===" -ForegroundColor Cyan
git remote remove origin 2>$null
git remote add origin "git@github.com:SX-Elementary/campus-route-ai.git"
git remote -v

Write-Host "`n=== 3/4 推送 main ===" -ForegroundColor Cyan
git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n推送失败。常见原因：" -ForegroundColor Yellow
    Write-Host "  · 公钥还没加到 GitHub：https://github.com/settings/ssh/new"
    Write-Host "  · 仓库还没建：https://github.com/new （名字 campus-route-ai，不要勾 README）"
    Write-Host "  · 需要先把本地分支改名：git branch -M main"
    exit 1
}

Write-Host "`n=== 4/4 打标签 ===" -ForegroundColor Cyan
git tag -f v0.1-competition
git push -f origin v0.1-competition

Write-Host "`n完成：https://github.com/SX-Elementary/campus-route-ai" -ForegroundColor Green
