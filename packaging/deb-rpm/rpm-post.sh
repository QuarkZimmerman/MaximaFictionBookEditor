#!/bin/sh
# RPM %post scriptlet ($1 = 1 install, 2 upgrade): same steps as the Debian postinst.
HELPER=/usr/lib/mfbe/chrome-sandbox
PROFILE=/etc/apparmor.d/mfbe
if [ -f "$HELPER" ]; then
    chown root:root "$HELPER" || true
    chmod 4755 "$HELPER" || true
fi
if [ -f "$PROFILE" ] && [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] \
   && [ -x /sbin/apparmor_parser ] && [ -d /sys/kernel/security/apparmor ]; then
    apparmor_parser -r -T -W "$PROFILE" 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications || true
fi
if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1 && [ -f /usr/share/icons/hicolor/index.theme ]; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
exit 0
