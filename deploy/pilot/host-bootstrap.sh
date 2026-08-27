#!/usr/bin/env bash
# One-time host preparation (Ubuntu 24.04 LTS on EC2) — Pilot Host Provisioning v1 §2/§3/§11.
# Run once as root after the instance exists. Installs Docker (compose plugin ≥ 2.24 is required for
# `!reset` in the pilot overlay), adds 2 GB swap so a 4 GB host survives an image build, creates the
# secret file location with the right mode, and enables Docker at boot (restart policies do the rest).
# Nothing here creates a cloud resource; nothing here contains a secret.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }
apt-get update -y
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
docker compose version
# swap (image builds: the Gradle stage alone peaks above 2 GB)
if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# secret file location — operator fills it from deploy/pilot/pilot.env.example
install -d -m 0700 /etc/sellerops
[[ -f /etc/sellerops/pilot.env ]] || { install -m 0600 /dev/null /etc/sellerops/pilot.env; echo "created empty /etc/sellerops/pilot.env (0600) — fill it from deploy/pilot/pilot.env.example"; }
install -d -m 0700 /var/backups/sellerops
install -d /opt/sellerops
echo "host ready: clone the repo to /opt/sellerops/repo, fill /etc/sellerops/pilot.env, then deploy/pilot/deploy.sh"
