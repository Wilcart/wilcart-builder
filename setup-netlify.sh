#!/bin/bash
set -e

# Load .env.local
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

if [ -z "$NETLIFY_API_TOKEN" ] || [ "$NETLIFY_API_TOKEN" = "YOUR_NETLIFY_TOKEN_HERE" ]; then
  echo "❌ Добавьте NETLIFY_API_TOKEN в .env.local"
  exit 1
fi

NETLIFY_AUTH=$NETLIFY_API_TOKEN

echo "🔧 Настройка Netlify сайта для Wilcart Builder"
echo ""

# 1. Создать сайт
echo "1️⃣  Создание сайта wilcart-builder..."
SITE_RESP=$(curl -s -X POST "https://api.netlify.com/api/v1/sites" \
  -H "Authorization: Bearer $NETLIFY_AUTH" \
  -H "Content-Type: application/json" \
  -d '{"name":"wilcart-builder","custom_domain":"builder.wilcart.com"}')

SITE_ID=$(echo $SITE_RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
SITE_URL=$(echo $SITE_RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('url',''))" 2>/dev/null || echo "")
NETLIFY_SUBDOMAIN=$(echo $SITE_RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('default_domain',''))" 2>/dev/null || echo "wilcart-builder.netlify.app")

if [ -z "$SITE_ID" ]; then
  # Сайт уже существует — получить его
  echo "   Сайт уже существует, получаю данные..."
  SITES=$(curl -s "https://api.netlify.com/api/v1/sites?filter=all" \
    -H "Authorization: Bearer $NETLIFY_AUTH")
  SITE_ID=$(echo $SITES | python3 -c "
import sys, json
sites = json.load(sys.stdin)
for s in sites:
    if s.get('name') == 'wilcart-builder':
        print(s['id'])
        break
" 2>/dev/null || echo "")
  NETLIFY_SUBDOMAIN="wilcart-builder.netlify.app"
fi

echo "   Site ID: $SITE_ID"
echo "   URL: https://$NETLIFY_SUBDOMAIN"

# 2. Сохранить Site ID
mkdir -p .netlify
echo "{\"siteId\":\"$SITE_ID\"}" > .netlify/state.json

# 3. Установить env переменные на Netlify
echo ""
echo "2️⃣  Устанавливаю переменные окружения..."

set_env() {
  local key=$1
  local value=$2
  curl -s -X POST "https://api.netlify.com/api/v1/sites/$SITE_ID/env" \
    -H "Authorization: Bearer $NETLIFY_AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"$key\",\"values\":[{\"value\":\"$value\",\"context\":\"all\"}]}" > /dev/null
  echo "   ✓ $key"
}

set_env "NEXT_PUBLIC_SUPABASE_URL" "$NEXT_PUBLIC_SUPABASE_URL"
set_env "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
set_env "SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY"
set_env "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY"
set_env "NETLIFY_API_TOKEN" "$NETLIFY_API_TOKEN"
set_env "NETLIFY_TEAM_SLUG" "${NETLIFY_TEAM_SLUG:-wilcart}"
set_env "NAMECOM_API_USERNAME" "$NAMECOM_API_USERNAME"
set_env "NAMECOM_API_TOKEN" "$NAMECOM_API_TOKEN"
set_env "NAMECOM_API_BASE" "${NAMECOM_API_BASE:-https://api.name.com/v4}"
set_env "NEXT_TELEMETRY_DISABLED" "1"

# 4. Deploy
echo ""
echo "3️⃣  Сборка и деплой..."
npm run build

NETLIFY_AUTH_TOKEN=$NETLIFY_API_TOKEN netlify deploy \
  --prod \
  --dir .next \
  --site "$SITE_ID" \
  --message "Initial Wilcart Builder deploy"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ГОТОВО!"
echo ""
echo "🌍 Временный URL: https://$NETLIFY_SUBDOMAIN"
echo ""
echo "📌 Для builder.wilcart.com добавьте на name.com:"
echo ""
echo "   Тип:   CNAME"
echo "   Host:  builder"
echo "   Value: $NETLIFY_SUBDOMAIN"
echo "   TTL:   300"
echo ""
echo "   Затем в Netlify: Site Settings → Domain management"
echo "   → Add custom domain → builder.wilcart.com"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
