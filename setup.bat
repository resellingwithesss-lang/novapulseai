@echo off

echo Creating ViralForge structure...

mkdir apps
mkdir apps\web
mkdir apps\server
mkdir apps\server\src
mkdir apps\server\src\config
mkdir apps\server\src\middleware
mkdir apps\server\src\modules
mkdir apps\server\src\modules\auth
mkdir apps\server\src\modules\billing
mkdir apps\server\src\modules\projects
mkdir apps\server\src\modules\render
mkdir apps\server\src\modules\story
mkdir apps\server\src\modules\clip
mkdir apps\server\src\utils
mkdir packages
mkdir packages\shared

type nul > docker-compose.yml
type nul > Dockerfile
type nul > package.json
type nul > .env.example
type nul > README.md

type nul > apps\server\package.json
type nul > apps\server\src\index.ts
type nul > apps\server\src\app.ts
type nul > apps\server\src\config\env.ts
type nul > apps\server\src\config\db.ts
type nul > apps\server\src\config\redis.ts
type nul > apps\server\src\middleware\auth.ts
type nul > apps\server\src\middleware\role.ts
type nul > apps\server\src\middleware\rateLimit.ts
type nul > apps\server\src\middleware\usage.ts
type nul > apps\server\src\utils\logger.ts
type nul > apps\server\src\utils\errorHandler.ts

echo Structure created successfully!
pause
