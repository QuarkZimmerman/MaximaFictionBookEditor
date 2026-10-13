#!/bin/sh
# RPM %postun scriptlet ($1 = 0 on the last removal, 1 on upgrade): refresh desktop caches.
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications || true
fi
if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1 && [ -f /usr/share/icons/hicolor/index.theme ]; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
if [ "$1" = "0" ]; then
    rm -f /var/cache/apparmor/*/mfbe 2>/dev/null || true
fi
exit 0
