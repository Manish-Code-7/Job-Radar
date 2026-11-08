#!/bin/bash
# EC2 "User data" for Job Radar (Ubuntu 24.04, Arm, e.g. t4g.medium in ap-southeast-1).
# Paste into: Launch instance → Advanced details → User data. Runs once, as root, on first boot.
# Log: /var/log/cloud-init-output.log
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

# 1) Updates, basic tools, automatic security updates
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw unattended-upgrades fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

# 2) 4 GB swap (Chromium + Next build spikes on a 4 GB box)
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl --system
fi

# 3) Docker Engine + Compose plugin (official repo)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker ubuntu
# Keep container logs from filling the disk
mkdir -p /etc/docker
echo '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' > /etc/docker/daemon.json
systemctl enable --now docker && systemctl restart docker

# 4) Firewall: SSH only. The site is reached through Cloudflare Tunnel (outbound), so no 80/443.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

# 5) App checkout (public repo; .env is copied separately over SSH, never stored in git)
sudo -u ubuntu git clone https://github.com/Manish-Code-7/Job-Radar.git /home/ubuntu/job-radar || true

touch /home/ubuntu/.bootstrap-done
