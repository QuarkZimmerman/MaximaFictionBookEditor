#!/bin/sh
# RPM %preun scriptlet ($1 = 0 on the last removal, 1 on upgrade): unload the AppArmor profile.
PROFILE=/etc/apparmor.d/mfbe
if [ "$1" = "0" ] && [ -f "$PROFILE" ] && [ -x /sbin/apparmor_parser ] && [ -d /sys/kernel/security/apparmor ]; then
    apparmor_parser -R "$PROFILE" 2>/dev/null || true
fi
exit 0
