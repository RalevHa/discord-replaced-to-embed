# Polls origin for new commits; if found, pulls, reinstalls deps, and restarts
# the bot under pm2. Run on a schedule (see README's Auto-deploy section) —
# not meant to be run continuously in a loop itself.

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

git fetch origin
$local = git rev-parse HEAD
$remote = git rev-parse '@{u}'

if ($local -ne $remote) {
    Write-Output "$(Get-Date -Format u) New commits found ($local -> $remote), deploying..."
    git pull
    npm install
    pm2 restart discord-bot
    Write-Output "$(Get-Date -Format u) Deploy complete."
} else {
    Write-Output "$(Get-Date -Format u) Up to date."
}
