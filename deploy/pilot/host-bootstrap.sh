#!/usr/bin/env bash
# One-time host preparation (Ubuntu 24.04 LTS on EC2) — Pilot Host Provisioning v1 §2/§3/§11.
# Run once as root after the instance exists. Installs Docker (compose plugin ≥ 2.24 is required for
# `!reset` in the pilot overlay) and the AWS CLI v2 (the off-host backup uploader — blocker B5), adds
# 2 GB swap so a 4 GB host survives an image build, creates the secret file location with the right
# mode, and enables Docker at boot (restart policies do the rest).
# Nothing here creates a cloud resource; nothing here contains a secret.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }
apt-get update -y
apt-get install -y ca-certificates curl git unzip
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

# ── AWS CLI v2 — the off-host backup uploader (blocker B5) ───────────────────────────────────────
# NOT `apt-get install awscli`. Ubuntu's package is AWS CLI **v1**, a different product on a different
# release line, and `backup.sh` calls `aws s3api put-object` expecting v2's behaviour. AWS distributes
# v2 only as this bundle; there is no vendor apt repository for it the way there is for Docker.
#
# Shape, deliberately: download → unpack on disk → run the installer FROM DISK. Not `curl | bash`.
# The difference is that the bytes that execute are the bytes sitting in $tmp, which can be inspected,
# checksummed or held by an operator who wants to look first — the file below is a real file, and the
# repository's own style (the Docker keyring three lines up) is to never execute a stream.
#
# WHAT VERIFIES IT, said plainly: TLS to awscli.amazonaws.com, which is the same trust anchor as the
# Docker GPG key fetched above, and nothing stronger. AWS publishes a PGP signature for this bundle,
# but the signing key is published as a text block in their documentation rather than at a stable URL,
# so verifying it means either embedding a third-party public key in this repository (which then has
# to be rotated here when AWS rotates it, and fails the bootstrap when that is missed) or fetching the
# key from the same host we are already trusting for the payload — which verifies nothing. So the
# signature is fetched and verified ONLY when the operator has already made that key trusted on this
# host (PILOT_AWSCLI_PGP_KEYRING); otherwise the step is skipped OUT LOUD instead of quietly.
#
# VERSION: latest, and the resolved version is printed so the deploy log carries what this host got.
# Pinning is available (PILOT_AWSCLI_VERSION=2.x.y) for a byte-reproducible rebuild. Latest is the
# default for the same reason the Docker install above tracks the vendor repository: a pinned uploader
# is an uploader that ages, and this one holds an S3 credential and the only off-host copy of every
# seller's data. An operator who needs reproducibility more than currency sets the variable.
if command -v aws >/dev/null 2>&1; then
  echo "aws cli already present: $(aws --version 2>&1) — not reinstalling"
else
  case "$(uname -m)" in
    x86_64)  awsarch=x86_64 ;;
    aarch64) awsarch=aarch64 ;;
    # The pilot host contract recommends x86_64 (docs/pilot_host_provisioning_v1.md §3), and the Docker
    # step above is architecture-neutral (it asks dpkg). So this handles both of AWS's Linux builds and
    # refuses anything else rather than installing a bundle that cannot run — a guess here would be an
    # uploader that exists on PATH and fails at 03:17.
    *) echo "unsupported architecture for AWS CLI v2: $(uname -m) (this pilot supports x86_64 and aarch64)" >&2; exit 1 ;;
  esac
  awsfile="awscli-exe-linux-${awsarch}${PILOT_AWSCLI_VERSION:+-$PILOT_AWSCLI_VERSION}.zip"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "https://awscli.amazonaws.com/$awsfile" -o "$tmp/awscliv2.zip"
  if [[ -n "${PILOT_AWSCLI_PGP_KEYRING:-}" ]]; then
    curl -fsSL "https://awscli.amazonaws.com/$awsfile.sig" -o "$tmp/awscliv2.sig"
    gpg --no-default-keyring --keyring "$PILOT_AWSCLI_PGP_KEYRING" --verify "$tmp/awscliv2.sig" "$tmp/awscliv2.zip"
    echo "aws cli bundle: PGP signature verified against $PILOT_AWSCLI_PGP_KEYRING"
  else
    echo "aws cli bundle: NOT PGP-verified (no PILOT_AWSCLI_PGP_KEYRING) — trust rests on TLS to awscli.amazonaws.com"
  fi
  unzip -q "$tmp/awscliv2.zip" -d "$tmp"
  [[ -x "$tmp/aws/install" ]] || { echo "downloaded bundle has no aws/install — refusing" >&2; exit 1; }
  # --update makes a re-run safe if a previous attempt left /usr/local/aws-cli behind; --bin-dir puts
  # the shim where a system install belongs and where cron's PATH can find it.
  "$tmp/aws/install" --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli --update
  rm -rf "$tmp"; trap - EXIT
fi
command -v aws >/dev/null 2>&1 || { echo "aws cli not on PATH after install" >&2; exit 1; }
[[ -x /usr/local/bin/aws ]] || echo "note: aws is on PATH but not at /usr/local/bin/aws — cron's PATH is set explicitly by install-backup-job.sh, so check it matches"
echo "aws cli: $(aws --version 2>&1)"

echo "host ready: clone the repo to /opt/sellerops/repo, fill /etc/sellerops/pilot.env, run deploy/pilot/install-backup-job.sh, then deploy/pilot/deploy.sh"
