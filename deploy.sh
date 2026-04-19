#!/bin/bash
set -e

# Load .env.local
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | grep NETLIFY_API_TOKEN | xargs)
fi

if [ -z "$NETLIFY_API_TOKEN" ] || [ "$NETLIFY_API_TOKEN" = "YOUR_NETLIFY_TOKEN_HERE" ]; then
  echo ""
  echo "❌ NETLIFY_API_TOKEN не заполнен в .env.local"
  echo "   Добавьте токен из: netlify.com → User Settings → Applications → Personal access tokens"
  echo ""
  exit 1
fi

echo ""
echo "🚀 Wilcart Builder — деплой на Netlify"
echo "========================================"

# Build
echo ""
echo "📦 Сборка проекта..."
npm run build

# Check if site already exists
SITE_ID_FILE=".netlify/state.json"
if [ -f "$SITE_ID_FILE" ]; then
  SITE_ID=$(cat "$SITE_ID_FILE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('siteId',''))" 2>/dev/null || echo "")
fi

if [ -z "$SITE_ID" ]; then
  echo ""
  echo "🌐 Создание нового сайта на Netlify..."
  NETLIFY_AUTH_TOKEN=$NETLIFY_API_TOKEN netlify sites:create \
    --name "wilcart-builder" \
    --disable-linking 2>/dev/null || true
fi

# Deploy
echo ""
echo "⬆️  Деплой..."
NETLIFY_AUTH_TOKEN=$NETLIFY_API_TOKEN netlify deploy \
  --prod \
  --dir .next \
  --site "wilcart-builder" \
  --message "Wilcart Builder deploy $(date +%Y-%m-%d\ %H:%M)"

echo ""
echo "✅ Деплой завершён!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📌 СЛЕДУЮЩИЙ ШАГ — DNS на name.com:"
echo ""
echo "   Добавьте CNAME запись:"
echo "   Host:  builder"
echo "   Value: wilcart-builder.netlify.app"
echo "   TTL:   300"
echo ""
echo "   Затем в Netlify Dashboard добавьте домен:"
echo "   builder.wilcart.com"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
