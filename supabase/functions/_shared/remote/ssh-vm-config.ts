// Shell command generators for configuring SSH trust on an already-booted
// managed VM. These are run
// through `ManagedComputeProvider.execOnMachine`, not interpolated from
// frontend text (PRD "Do not interpolate frontend text into remote shell
// scripts") - every value here is server-generated: a CA public key line or
// an already-validated OpenSSH public key line.

const MANAGED_SSH_USER_HOME = "/home/treq";
const TRUSTED_CA_MARKER_FILE = "/etc/ssh/treq_ca.pub";
const SSHD_CONFIG_DROPIN = "/etc/ssh/sshd_config.d/60-treq-ca.conf";

// Idempotent: writes the CA public key line to a fixed path and points
// `TrustedUserCAKeys` at it via an sshd config drop-in, then reloads sshd.
// Safe to re-run (e.g. on every reprovision) since it only overwrites its own
// two files.
export function installCaTrustCommand(caPublicKeyLine: string): string[] {
  const script = `#!/bin/sh
set -eu
mkdir -p /etc/ssh/sshd_config.d
cat > "${TRUSTED_CA_MARKER_FILE}" <<'TREQ_CA_EOF'
${caPublicKeyLine}
TREQ_CA_EOF
cat > "${SSHD_CONFIG_DROPIN}" <<'TREQ_SSHD_EOF'
TrustedUserCAKeys ${TRUSTED_CA_MARKER_FILE}
TREQ_SSHD_EOF
if command -v systemctl >/dev/null 2>&1 && systemctl is-active sshd >/dev/null 2>&1; then
  systemctl reload sshd
elif command -v systemctl >/dev/null 2>&1 && systemctl is-active ssh >/dev/null 2>&1; then
  systemctl reload ssh
elif [ -f /var/run/sshd.pid ]; then
  kill -HUP "$(cat /var/run/sshd.pid)"
fi
echo "treq: CA trust installed"
`;
  return ["/bin/sh", "-c", script];
}

// Idempotent authorized_keys install: appends the key only if a line with
// the same fingerprint marker comment is not already present, so repeated
// installs (retry, re-registration) never duplicate an entry.
export function installAuthorizedKeyCommand(publicKeyLine: string, fingerprintSha256: string): string[] {
  const marker = `# treq-client-key:${fingerprintSha256}`;
  const script = `#!/bin/sh
set -eu
mkdir -p "${MANAGED_SSH_USER_HOME}/.ssh"
chmod 700 "${MANAGED_SSH_USER_HOME}/.ssh"
touch "${MANAGED_SSH_USER_HOME}/.ssh/authorized_keys"
if ! grep -qF "${marker}" "${MANAGED_SSH_USER_HOME}/.ssh/authorized_keys" 2>/dev/null; then
  printf '%s\\n%s\\n' "${marker}" "${publicKeyLine}" >> "${MANAGED_SSH_USER_HOME}/.ssh/authorized_keys"
fi
chmod 600 "${MANAGED_SSH_USER_HOME}/.ssh/authorized_keys"
echo "treq: authorized key installed"
`;
  return ["/bin/sh", "-c", script];
}

// Removes exactly the two lines (marker + key) this module's install added
// for a given fingerprint, leaving every other entry untouched.
export function removeAuthorizedKeyCommand(fingerprintSha256: string): string[] {
  const marker = `# treq-client-key:${fingerprintSha256}`;
  const script = `#!/bin/sh
set -eu
FILE="${MANAGED_SSH_USER_HOME}/.ssh/authorized_keys"
if [ -f "$FILE" ]; then
  MARKER="${marker}"
  awk -v marker="$MARKER" '
    $0 == marker { skip = 2; next }
    skip > 0 { skip--; next }
    { print }
  ' "$FILE" > "$FILE.treq_tmp"
  mv "$FILE.treq_tmp" "$FILE"
fi
echo "treq: authorized key removed"
`;
  return ["/bin/sh", "-c", script];
}
