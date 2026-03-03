#!/bin/bash
set -e

# When piped (curl | bash), stdin is the script content, not the terminal.
# Save to a temp file and re-exec so `read` can use the terminal.
if [ ! -t 0 ]; then
  TMPSCRIPT=$(mktemp /tmp/ct-cloud-install.XXXXXX.sh)
  cat > "$TMPSCRIPT"
  exec bash "$TMPSCRIPT" "$@" </dev/tty
fi

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="/opt/ct-cloud"
IS_UPDATE=false

echo ""
echo -e "  ${BOLD}Claude Terminal Cloud — Installer${NC}"
echo -e "  ${DIM}────────────────────────────────────${NC}"
echo ""

# ══════════════════════════════════════════════
# 1. Dependencies
# ══════════════════════════════════════════════

install_pkg() {
  if command -v apt-get &>/dev/null; then
    apt-get update -qq && apt-get install -y -qq "$@"
  elif command -v yum &>/dev/null; then
    yum install -y -q "$@"
  elif command -v apk &>/dev/null; then
    apk add --quiet "$@"
  elif command -v pacman &>/dev/null; then
    pacman -Sy --noconfirm "$@"
  else
    echo -e "  ${RED}Cannot install $* — unknown package manager${NC}"
    echo -e "  ${DIM}Install manually and re-run this script${NC}"
    exit 1
  fi
}

# Docker
if ! command -v docker &>/dev/null; then
  echo -e "  ${YELLOW}Docker not found — installing...${NC}"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker 2>/dev/null || true
  echo -e "  ${GREEN}✓ Docker installed${NC}"
fi

# Docker Compose
if ! docker compose version &>/dev/null; then
  echo -e "  ${YELLOW}Docker Compose not found — installing plugin...${NC}"
  COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | head -1 | cut -d'"' -f4)
  DOCKER_CLI_DIR=${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins
  mkdir -p "$DOCKER_CLI_DIR"
  curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o "$DOCKER_CLI_DIR/docker-compose"
  chmod +x "$DOCKER_CLI_DIR/docker-compose"
  echo -e "  ${GREEN}✓ Docker Compose installed${NC}"
fi

# Git
if ! command -v git &>/dev/null; then
  echo -e "  ${YELLOW}Git not found — installing...${NC}"
  install_pkg git
  echo -e "  ${GREEN}✓ Git installed${NC}"
fi

echo ""

# ══════════════════════════════════════════════
# 2. Clone / Update — detect existing install
# ══════════════════════════════════════════════

if [ -d "$INSTALL_DIR/.git" ]; then
  # Pull latest source first
  echo -e "  ${DIM}Fetching latest release...${NC}"
  cd "$INSTALL_DIR"
  git sparse-checkout set cloud remote-ui 2>/dev/null
  git fetch --unshallow --quiet 2>/dev/null || true
  git fetch origin --tags --quiet 2>/dev/null || true
  LATEST_TAG=$(git tag -l "v*" | sort -V | tail -1)
  if [ -n "$LATEST_TAG" ]; then
    git checkout "$LATEST_TAG" --quiet 2>/dev/null || true
    echo -e "  ${GREEN}✓ Source updated to ${BOLD}$LATEST_TAG${NC}"
  else
    git pull --quiet 2>/dev/null || true
    echo -e "  ${GREEN}✓ Source updated${NC}"
  fi
  cd cloud
  echo ""

  # Detect if this is a fully configured install (has .env = setup was completed)
  if [ -f .env ]; then
    IS_UPDATE=true

    echo -e "  ${CYAN}${BOLD}Existing installation detected${NC}"
    echo ""

    # ── Audit current state ──
    DOMAIN=$(grep '^PUBLIC_URL=' .env 2>/dev/null | sed 's|^PUBLIC_URL=https\?://||' || true)
    CONTAINER_UP=$(docker ps --filter name=ct-cloud --format '{{.Status}}' 2>/dev/null || true)

    USER_COUNT=0
    USERS=""
    CLAUDE_VERSION=""
    CONFIGURED_USERS=""

    if [ -n "$CONTAINER_UP" ]; then
      CLAUDE_VERSION=$(docker exec ct-cloud claude --version 2>/dev/null || true)
      USERS=$(docker exec ct-cloud node dist/cli.js user list 2>/dev/null || true)
    fi

    # Count users from data/users/
    if [ -d data/users ]; then
      USER_COUNT=$(ls -d data/users/*/user.json 2>/dev/null | wc -l || echo 0)
      # Check per-user credentials
      for USER_DIR in data/users/*/; do
        [ ! -d "$USER_DIR" ] && continue
        UNAME=$(basename "$USER_DIR")
        U_HAS_CLAUDE="no"
        U_HAS_GIT="no"
        [ -f "${USER_DIR}home/.claude/.credentials.json" ] && U_HAS_CLAUDE="yes"
        [ -f "${USER_DIR}home/.gitconfig" ] && U_HAS_GIT="yes"
        CONFIGURED_USERS="${CONFIGURED_USERS}${UNAME}(claude:${U_HAS_CLAUDE},git:${U_HAS_GIT}) "
      done
    fi

    HAS_NGINX="no"
    HAS_APACHE="no"
    [ -f /etc/nginx/sites-available/ct-cloud ] && HAS_NGINX="yes"
    ([ -f /etc/apache2/sites-available/ct-cloud.conf ] || [ -f /etc/httpd/conf.d/ct-cloud.conf ]) && HAS_APACHE="yes"

    HAS_SSL="no"
    if [ -n "$DOMAIN" ]; then
      (certbot certificates -d "$DOMAIN" 2>/dev/null | grep -q "Certificate Name" 2>/dev/null) && HAS_SSL="yes"
    fi

    HAS_CRON="no"
    (crontab -l 2>/dev/null | grep -q 'ct-cloud/cloud/update.sh') && HAS_CRON="yes"

    # ── Display status ──
    echo -e "  ${BOLD}Current configuration:${NC}"
    echo ""
    [ -n "$DOMAIN" ] && echo -e "  ${GREEN}✓${NC} Domain         ${BOLD}$DOMAIN${NC}" || echo -e "  ${RED}✗${NC} Domain         ${DIM}not set${NC}"
    [ -n "$CONTAINER_UP" ] && echo -e "  ${GREEN}✓${NC} Container      ${DIM}running${NC}" || echo -e "  ${RED}✗${NC} Container      ${DIM}not running${NC}"
    [ -n "$CLAUDE_VERSION" ] && echo -e "  ${GREEN}✓${NC} Claude CLI     ${DIM}$CLAUDE_VERSION${NC}" || echo -e "  ${RED}✗${NC} Claude CLI     ${DIM}not found${NC}"
    [ "$USER_COUNT" -gt 0 ] && echo -e "  ${GREEN}✓${NC} Users          ${DIM}${USER_COUNT} user(s)${NC}" || echo -e "  ${YELLOW}✗${NC} Users          ${DIM}none${NC}"
    if [ -n "$CONFIGURED_USERS" ]; then
      echo -e "  ${DIM}                 ${CONFIGURED_USERS}${NC}"
    fi
    if [ "$HAS_NGINX" = "yes" ]; then echo -e "  ${GREEN}✓${NC} Reverse proxy  ${DIM}Nginx${NC}"
    elif [ "$HAS_APACHE" = "yes" ]; then echo -e "  ${GREEN}✓${NC} Reverse proxy  ${DIM}Apache${NC}"
    else echo -e "  ${YELLOW}✗${NC} Reverse proxy  ${DIM}not detected${NC}"; fi
    [ "$HAS_SSL" = "yes" ] && echo -e "  ${GREEN}✓${NC} SSL            ${DIM}active${NC}" || echo -e "  ${YELLOW}✗${NC} SSL            ${DIM}not configured${NC}"
    [ "$HAS_CRON" = "yes" ] && echo -e "  ${GREEN}✓${NC} Auto-update    ${DIM}enabled${NC}" || echo -e "  ${YELLOW}✗${NC} Auto-update    ${DIM}disabled${NC}"

    echo ""
    echo -e "  ${BOLD}What would you like to do?${NC}"
    echo ""
    echo -e "  ${DIM}1${NC}) Update & rebuild   ${DIM}(pull latest + rebuild container)${NC}"
    echo -e "  ${DIM}2${NC}) Configure missing  ${DIM}(setup only unconfigured items)${NC}"
    echo -e "  ${DIM}3${NC}) Full reconfigure   ${DIM}(redo all setup steps)${NC}"
    echo -e "  ${DIM}4${NC}) Add user           ${DIM}(create a new API user)${NC}"
    echo -e "  ${DIM}5${NC}) Exit"
    echo ""
    read -p "  Choice [1-5]: " UPDATE_ACTION
    UPDATE_ACTION=${UPDATE_ACTION:-1}

    case "$UPDATE_ACTION" in
      1)
        echo ""
        mkdir -p data/users
        echo -e "  ${CYAN}Rebuilding containers...${NC}"
        docker compose up -d --build
        sleep 3
        echo -e "  ${GREEN}✓ Server rebuilt and running${NC}"
        echo ""

        if [ "$USER_COUNT" -eq 0 ]; then
          echo -e "  ${YELLOW}Reminder:${NC} No users configured — run installer again → \"Add user\""
        fi

        echo ""
        echo -e "  ${GREEN}${BOLD}Update complete!${NC}"
        echo ""
        exit 0
        ;;
      4)
        echo ""
        U_NAME=""
        while [ -z "$U_NAME" ]; do
          read -p "  Username (a-z, 0-9, _, -): " U_NAME
          if [ -z "$U_NAME" ]; then
            echo -e "  ${RED}Username is required${NC}"
          elif ! echo "$U_NAME" | grep -qE '^[a-zA-Z0-9_-]+$'; then
            echo -e "  ${RED}Invalid characters${NC}"
            U_NAME=""
          fi
        done
        echo ""
        docker exec ct-cloud node dist/cli.js user add "$U_NAME"
        echo ""
        read -p "  Configure Claude auth + git for \"$U_NAME\" now? (Y/n): " SETUP_NOW
        SETUP_NOW=${SETUP_NOW:-Y}
        if [ "$SETUP_NOW" = "Y" ] || [ "$SETUP_NOW" = "y" ]; then
          docker exec -it ct-cloud node dist/cli.js user setup "$U_NAME"
        else
          echo -e "  ${DIM}Configure later: docker exec -it ct-cloud node dist/cli.js user setup $U_NAME${NC}"
        fi
        echo ""
        exit 0
        ;;
      5)
        echo -e "  ${DIM}Bye!${NC}"
        exit 0
        ;;
      2) SKIP_CONFIGURED=true ;;
      3) SKIP_CONFIGURED=false ;;
      *) echo -e "  ${RED}Invalid choice${NC}"; exit 1 ;;
    esac

    echo ""

    # Rebuild (source may have changed)
    mkdir -p data/users
    echo -e "  ${CYAN}Rebuilding containers...${NC}"
    docker compose up -d --build
    sleep 3
    echo -e "  ${GREEN}✓ Server rebuilt and running${NC}"
    echo ""

  else
    # .git exists but .env missing — source cloned but never configured
    IS_UPDATE=false
    SKIP_CONFIGURED=false
    echo -e "  ${YELLOW}Source found but not yet configured — running full setup${NC}"
    echo ""
  fi

else
  # ── Fresh install — no existing directory ──
  IS_UPDATE=false
  SKIP_CONFIGURED=false

  echo -e "  ${CYAN}Cloning cloud server...${NC}"
  git clone --filter=blob:none --sparse \
    https://github.com/Sterll/claude-terminal.git "$INSTALL_DIR" 2>/dev/null
  cd "$INSTALL_DIR" && git sparse-checkout set cloud remote-ui 2>/dev/null

  # Checkout latest release tag
  git fetch origin --tags --quiet 2>/dev/null || true
  LATEST_TAG=$(git tag -l "v*" | sort -V | tail -1)
  if [ -n "$LATEST_TAG" ]; then
    git checkout "$LATEST_TAG" --quiet 2>/dev/null || true
    echo -e "  ${GREEN}✓ Source ready at ${BOLD}$LATEST_TAG${NC}"
  else
    echo -e "  ${GREEN}✓ Source ready${NC}"
  fi
  cd cloud
  echo ""
fi

# ══════════════════════════════════════════════
# 3. Domain name
# ══════════════════════════════════════════════

if [ "$IS_UPDATE" = true ] && [ "$SKIP_CONFIGURED" = true ] && [ -n "$DOMAIN" ]; then
  echo -e "  ${GREEN}✓ Domain: ${BOLD}$DOMAIN${NC} ${DIM}(unchanged)${NC}"
else
  # Show current value as default if updating
  if [ -n "$DOMAIN" ]; then
    read -p "  Domain name [$DOMAIN]: " NEW_DOMAIN
    DOMAIN=${NEW_DOMAIN:-$DOMAIN}
  else
    DOMAIN=""
    while [ -z "$DOMAIN" ]; do
      read -p "  Domain name (e.g. cloud.example.com): " DOMAIN
      if [ -z "$DOMAIN" ]; then
        echo -e "  ${RED}Domain is required${NC}"
      fi
    done
  fi

  # Setup .env
  if [ ! -f .env ]; then
    cp .env.example .env
  fi
  sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$DOMAIN|" .env

  echo -e "  ${GREEN}✓ Domain set to ${BOLD}$DOMAIN${NC}"
fi

echo ""

# ══════════════════════════════════════════════
# 4. Create data dirs & build (fresh install only)
# ══════════════════════════════════════════════

if [ "$IS_UPDATE" = false ]; then
  mkdir -p data/users

  echo -e "  ${CYAN}Building and starting containers...${NC}"
  docker compose up -d --build
  echo -e "  ${DIM}Waiting for server to start...${NC}"
  sleep 3
  echo -e "  ${GREEN}✓ Server running on port 3800${NC}"
  echo ""
fi

# ══════════════════════════════════════════════
# 5. Create user + per-user setup (Claude auth + git + GitHub)
# ══════════════════════════════════════════════

if [ "$IS_UPDATE" = true ] && [ "$SKIP_CONFIGURED" = true ]; then
  # Check if any users exist
  EXISTING_USERS=$(docker exec ct-cloud node dist/cli.js user list 2>/dev/null || true)
  if [ -n "$EXISTING_USERS" ]; then
    echo -e "  ${GREEN}✓ Users${NC} ${DIM}($EXISTING_USERS)${NC}"
    read -p "  Add another user? (y/N): " ADD_USER
    if [ "$ADD_USER" != "Y" ] && [ "$ADD_USER" != "y" ]; then
      echo ""
      # Skip to next section — jump past user creation
      SKIP_USER=true
    fi
  fi
fi

if [ "$SKIP_USER" != true ]; then
  USERNAME=""
  while [ -z "$USERNAME" ]; do
    read -p "  Username (a-z, 0-9, _, -): " USERNAME
    if [ -z "$USERNAME" ]; then
      echo -e "  ${RED}Username is required${NC}"
    elif ! echo "$USERNAME" | grep -qE '^[a-zA-Z0-9_-]+$'; then
      echo -e "  ${RED}Invalid characters — use only a-z, 0-9, _, -${NC}"
      USERNAME=""
    fi
  done

  echo ""
  API_OUTPUT=$(docker exec ct-cloud node dist/cli.js user add "$USERNAME" 2>&1)
  echo "$API_OUTPUT"

  # Extract API key from output
  API_KEY=$(echo "$API_OUTPUT" | grep -oP 'API Key: \K.*' || true)

  # Per-user setup: Claude auth + git identity + GitHub token
  echo ""
  echo -e "  ${BOLD}User setup — Claude auth, git identity & GitHub token${NC}"
  echo -e "  ${DIM}Each user has their own credentials for headless sessions.${NC}"
  echo ""
  read -p "  Configure user \"$USERNAME\" now? (Y/n): " SETUP_CHOICE
  SETUP_CHOICE=${SETUP_CHOICE:-Y}

  if [ "$SETUP_CHOICE" = "Y" ] || [ "$SETUP_CHOICE" = "y" ]; then
    docker exec -it ct-cloud node dist/cli.js user setup "$USERNAME"
  else
    echo -e "  ${DIM}Skipped — configure later:${NC}"
    echo -e "  ${DIM}  docker exec -it ct-cloud node dist/cli.js user setup $USERNAME${NC}"
  fi
fi

echo ""

# ══════════════════════════════════════════════
# 8. Reverse proxy
# ══════════════════════════════════════════════

# Re-check proxy state
HAS_NGINX="no"
HAS_APACHE="no"
[ -f /etc/nginx/sites-available/ct-cloud ] && HAS_NGINX="yes"
([ -f /etc/apache2/sites-available/ct-cloud.conf ] || [ -f /etc/httpd/conf.d/ct-cloud.conf ]) && HAS_APACHE="yes"

if [ "$SKIP_CONFIGURED" = true ] && ([ "$HAS_NGINX" = "yes" ] || [ "$HAS_APACHE" = "yes" ]); then
  PROXY_TYPE="Nginx"
  [ "$HAS_APACHE" = "yes" ] && PROXY_TYPE="Apache"
  echo -e "  ${GREEN}✓ Reverse proxy${NC} ${DIM}($PROXY_TYPE — unchanged)${NC}"
  PROXY_CHOICE="skip"
else
  echo -e "  ${BOLD}Reverse proxy setup${NC}"
  echo ""
  if [ "$HAS_NGINX" = "yes" ]; then
    echo -e "  ${DIM}Current: Nginx configured${NC}"
    read -p "  Reconfigure? (y/N): " REDO_PROXY
    if [ "$REDO_PROXY" != "Y" ] && [ "$REDO_PROXY" != "y" ]; then
      PROXY_CHOICE="skip"
    fi
  elif [ "$HAS_APACHE" = "yes" ]; then
    echo -e "  ${DIM}Current: Apache configured${NC}"
    read -p "  Reconfigure? (y/N): " REDO_PROXY
    if [ "$REDO_PROXY" != "Y" ] && [ "$REDO_PROXY" != "y" ]; then
      PROXY_CHOICE="skip"
    fi
  fi

  if [ "$PROXY_CHOICE" != "skip" ]; then
    echo -e "  ${DIM}1${NC}) Nginx   ${DIM}(recommended)${NC}"
    echo -e "  ${DIM}2${NC}) Apache2"
    echo -e "  ${DIM}3${NC}) Skip    ${DIM}(I'll configure it myself)${NC}"
    echo ""
    read -p "  Choice [1/2/3]: " PROXY_CHOICE
  fi
fi

setup_nginx() {
  if ! command -v nginx &>/dev/null; then
    echo -e "  ${YELLOW}Nginx not found — installing...${NC}"
    install_pkg nginx
    systemctl enable nginx 2>/dev/null || true
    echo -e "  ${GREEN}✓ Nginx installed${NC}"
  fi

  NGINX_CONF="/etc/nginx/sites-available/ct-cloud"
  cat > "$NGINX_CONF" <<NGINXEOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3800;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # WebSocket
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
NGINXEOF

  mkdir -p /etc/nginx/sites-enabled
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ct-cloud

  if [ -f /etc/nginx/sites-enabled/default ]; then
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  fi

  nginx -t 2>/dev/null && systemctl reload nginx
  echo -e "  ${GREEN}✓ Nginx configured for ${BOLD}$DOMAIN${NC}"
}

setup_apache() {
  if ! command -v apache2 &>/dev/null && ! command -v httpd &>/dev/null; then
    echo -e "  ${YELLOW}Apache not found — installing...${NC}"
    if command -v apt-get &>/dev/null; then
      install_pkg apache2
      systemctl enable apache2 2>/dev/null || true
    else
      install_pkg httpd
      systemctl enable httpd 2>/dev/null || true
    fi
    echo -e "  ${GREEN}✓ Apache installed${NC}"
  fi

  if command -v a2enmod &>/dev/null; then
    a2enmod proxy proxy_http proxy_wstunnel rewrite headers 2>/dev/null || true
  fi

  APACHE_CONF="/etc/apache2/sites-available/ct-cloud.conf"
  [ ! -d /etc/apache2/sites-available ] && APACHE_CONF="/etc/httpd/conf.d/ct-cloud.conf"

  cat > "$APACHE_CONF" <<APACHEEOF
<VirtualHost *:80>
    ServerName $DOMAIN

    ProxyPreserveHost On
    ProxyRequests Off

    # HTTP
    ProxyPass / http://127.0.0.1:3800/
    ProxyPassReverse / http://127.0.0.1:3800/

    # WebSocket
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule /(.*) ws://127.0.0.1:3800/\$1 [P,L]

    # Timeouts
    ProxyTimeout 86400
</VirtualHost>
APACHEEOF

  if command -v a2ensite &>/dev/null; then
    a2ensite ct-cloud 2>/dev/null || true
    a2dissite 000-default 2>/dev/null || true
    systemctl reload apache2
  else
    systemctl reload httpd 2>/dev/null || true
  fi

  echo -e "  ${GREEN}✓ Apache configured for ${BOLD}$DOMAIN${NC}"
}

case "$PROXY_CHOICE" in
  1) setup_nginx ;;
  2) setup_apache ;;
  skip) ;;
  3|"")
    echo -e "  ${DIM}Skipped — configure your reverse proxy to forward to 127.0.0.1:3800${NC}"
    echo -e "  ${DIM}Don't forget WebSocket support (Upgrade headers)${NC}"
    ;;
esac

echo ""

# ══════════════════════════════════════════════
# 9. SSL with Let's Encrypt
# ══════════════════════════════════════════════

# Re-check SSL
HAS_SSL="no"
if [ -n "$DOMAIN" ]; then
  (certbot certificates -d "$DOMAIN" 2>/dev/null | grep -q "Certificate Name" 2>/dev/null) && HAS_SSL="yes"
fi

if [ "$SKIP_CONFIGURED" = true ] && [ "$HAS_SSL" = "yes" ]; then
  echo -e "  ${GREEN}✓ SSL certificate${NC} ${DIM}(active — unchanged)${NC}"
elif [ "$PROXY_CHOICE" = "1" ] || [ "$PROXY_CHOICE" = "2" ] || ([ "$PROXY_CHOICE" = "skip" ] && ([ "$HAS_NGINX" = "yes" ] || [ "$HAS_APACHE" = "yes" ])); then
  if [ "$HAS_SSL" = "yes" ]; then
    echo -e "  ${GREEN}✓ SSL certificate already active${NC}"
  else
    echo -e "  ${BOLD}SSL Certificate${NC}"
    echo ""
    read -p "  Setup free SSL with Let's Encrypt? (Y/n): " SSL_CHOICE
    SSL_CHOICE=${SSL_CHOICE:-Y}

    if [ "$SSL_CHOICE" = "Y" ] || [ "$SSL_CHOICE" = "y" ]; then
      if ! command -v certbot &>/dev/null; then
        echo -e "  ${YELLOW}Certbot not found — installing...${NC}"
        if command -v apt-get &>/dev/null; then
          install_pkg certbot
          if [ "$HAS_NGINX" = "yes" ] || [ "$PROXY_CHOICE" = "1" ]; then
            install_pkg python3-certbot-nginx
          else
            install_pkg python3-certbot-apache
          fi
        elif command -v yum &>/dev/null; then
          install_pkg certbot
          if [ "$HAS_NGINX" = "yes" ] || [ "$PROXY_CHOICE" = "1" ]; then
            install_pkg python3-certbot-nginx
          else
            install_pkg python3-certbot-apache
          fi
        fi
        echo -e "  ${GREEN}✓ Certbot installed${NC}"
      fi

      echo ""
      read -p "  Email for Let's Encrypt (optional, press Enter to skip): " LE_EMAIL

      CERTBOT_FLAGS="--non-interactive --agree-tos -d $DOMAIN"
      if [ -n "$LE_EMAIL" ]; then
        CERTBOT_FLAGS="$CERTBOT_FLAGS --email $LE_EMAIL"
      else
        CERTBOT_FLAGS="$CERTBOT_FLAGS --register-unsafely-without-email"
      fi

      echo ""
      echo -e "  ${CYAN}Requesting certificate...${NC}"

      if [ "$HAS_NGINX" = "yes" ] || [ "$PROXY_CHOICE" = "1" ]; then
        certbot --nginx $CERTBOT_FLAGS 2>&1 && SSL_OK=true || SSL_OK=false
      else
        certbot --apache $CERTBOT_FLAGS 2>&1 && SSL_OK=true || SSL_OK=false
      fi

      if [ "$SSL_OK" = "true" ]; then
        echo -e "  ${GREEN}✓ SSL certificate installed for ${BOLD}$DOMAIN${NC}"
        echo -e "  ${DIM}Auto-renewal is enabled via certbot timer${NC}"
      else
        echo -e "  ${RED}SSL setup failed — make sure $DOMAIN points to this server${NC}"
        echo -e "  ${DIM}You can retry later: certbot --nginx -d $DOMAIN${NC}"
      fi
    else
      echo -e "  ${DIM}Skipped — you can add SSL later with:${NC}"
      if [ "$HAS_NGINX" = "yes" ] || [ "$PROXY_CHOICE" = "1" ]; then
        echo -e "  ${DIM}  certbot --nginx -d $DOMAIN${NC}"
      else
        echo -e "  ${DIM}  certbot --apache -d $DOMAIN${NC}"
      fi
    fi
  fi

  echo ""
fi

# ══════════════════════════════════════════════
# 10. Auto-update
# ══════════════════════════════════════════════

HAS_CRON="no"
(crontab -l 2>/dev/null | grep -q 'ct-cloud/cloud/update.sh') && HAS_CRON="yes"

if [ "$SKIP_CONFIGURED" = true ] && [ "$HAS_CRON" = "yes" ]; then
  echo -e "  ${GREEN}✓ Auto-update${NC} ${DIM}(enabled — unchanged)${NC}"
else
  echo -e "  ${BOLD}Auto-update${NC}"
  echo ""
  echo -e "  ${DIM}Checks for updates every 6 hours and rebuilds automatically.${NC}"
  echo ""

  if [ "$HAS_CRON" = "yes" ]; then
    echo -e "  ${GREEN}✓ Auto-update already enabled${NC}"
  else
    read -p "  Enable auto-update? (Y/n): " UPDATE_CHOICE
    UPDATE_CHOICE=${UPDATE_CHOICE:-Y}

    if [ "$UPDATE_CHOICE" = "Y" ] || [ "$UPDATE_CHOICE" = "y" ]; then
      chmod +x "$INSTALL_DIR/cloud/update.sh"
      touch /var/log/ct-cloud-update.log
      CRON_LINE="0 */6 * * * $INSTALL_DIR/cloud/update.sh"
      (crontab -l 2>/dev/null | grep -v 'ct-cloud/cloud/update.sh'; echo "$CRON_LINE") | crontab -
      echo -e "  ${GREEN}✓ Auto-update enabled (every 6h)${NC}"
      echo -e "  ${DIM}Logs: /var/log/ct-cloud-update.log${NC}"
    else
      echo -e "  ${DIM}Skipped — update manually:${NC}"
      echo -e "  ${DIM}  $INSTALL_DIR/cloud/update.sh${NC}"
    fi
  fi
fi

echo ""

# ══════════════════════════════════════════════
# Done
# ══════════════════════════════════════════════

if [ "$IS_UPDATE" = true ]; then
  echo -e "  ${GREEN}${BOLD}════════════════════════════════════${NC}"
  echo -e "  ${GREEN}${BOLD}  Configuration updated!${NC}"
  echo -e "  ${GREEN}${BOLD}════════════════════════════════════${NC}"
else
  echo -e "  ${GREEN}${BOLD}════════════════════════════════════${NC}"
  echo -e "  ${GREEN}${BOLD}  Installation complete!${NC}"
  echo -e "  ${GREEN}${BOLD}════════════════════════════════════${NC}"
fi

echo ""
echo -e "  ${BOLD}Server:${NC}    https://$DOMAIN"
if [ -n "$USERNAME" ]; then
  echo -e "  ${BOLD}User:${NC}      $USERNAME"
fi
if [ -n "$API_KEY" ]; then
  echo -e "  ${BOLD}API Key:${NC}   $API_KEY"
fi
echo ""
if [ "$IS_UPDATE" = false ] || [ -n "$API_KEY" ]; then
  echo -e "  ${BOLD}Next step:${NC}"
  echo -e "    Paste the URL and API key in"
  echo -e "    ${CYAN}Claude Terminal > Settings > Cloud${NC}"
  echo ""
fi
echo -e "  ${DIM}────────────────────────────────────${NC}"
echo -e "  ${DIM}Add user:      docker exec ct-cloud node dist/cli.js user add <name>${NC}"
echo -e "  ${DIM}Setup user:    docker exec -it ct-cloud node dist/cli.js user setup <name>${NC}"
echo -e "  ${DIM}List users:    docker exec ct-cloud node dist/cli.js user list${NC}"
echo -e "  ${DIM}View logs:     docker compose -f $INSTALL_DIR/cloud/docker-compose.yml logs -f${NC}"
echo -e "  ${DIM}Manual update: $INSTALL_DIR/cloud/update.sh${NC}"
echo ""
