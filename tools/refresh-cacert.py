#!/usr/bin/env python3
"""Refresh the bundled Mozilla CA certificate bundle (feature 005, resource-formats section C).

Downloads ``cacert.pem`` - Mozilla's root store in PEM form as extracted and published by the
curl project - together with its digest file ``cacert.pem.sha256`` from https://curl.se/ca/,
verifies the SHA-256, writes the bundle byte-exact to ``resources/certs/cacert.pem`` and
rewrites the notice ``resources/certs/cacert.NOTICE.txt`` next to it. The notice holds, in this
order: the statement of what the file is (Mozilla's CA certificate data as distributed by the
curl project), the licence statement (MPL-2.0, with the pointer to the full text in
``resources/certs/MPL-2.0.txt``, under ``share/doc/mfbe/licenses/`` and in
``THIRD-PARTY-NOTICES.md``), the provenance of the shipped copy (URL, Mozilla's "Certificate
data from Mozilla as of" date, size in bytes, SHA-256, root count), the sentence that the
editor uses the bundle on Linux only when neither the environment nor the distribution provides
one, and the refresh recipe. ``MPL-2.0.txt`` is a static copy of the licence text and is never
touched; the tool only checks that it is present, because the notice points to it.

Usage::

    python3 tools/refresh-cacert.py              # download from curl.se, verify, rewrite both files
    python3 tools/refresh-cacert.py --source DIR # read cacert.pem + cacert.pem.sha256 from DIR
                                                 #   (an offline re-run or a test of the tool)

The bundle is an aggregated data file (``tools/licence-check.py``, group "aggregate"): after a
refresh, run ``python3 tools/licence-check.py`` so that the notices record the new date and
digest, and commit ``cacert.pem``, ``cacert.NOTICE.txt`` and ``THIRD-PARTY-NOTICES.md``
together. Standard library only. Exit status 0 when the files were written (changed or not),
1 when the download, the digest or the bundle's shape is wrong, 2 on a usage error.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CERTS_DIR = REPO / "resources" / "certs"
BUNDLE = CERTS_DIR / "cacert.pem"
NOTICE = CERTS_DIR / "cacert.NOTICE.txt"
LICENCE_TEXT = CERTS_DIR / "MPL-2.0.txt"

SOURCE = "https://curl.se/ca/"
BUNDLE_NAME = "cacert.pem"
DIGEST_NAME = "cacert.pem.sha256"
USER_AGENT = "MaximaFictionBookEditor-refresh-cacert/1"
TIMEOUT_SECONDS = 60

DATE_LINE = re.compile(r"^## Certificate data from Mozilla as of: (?P<date>.+?)\s*$", re.MULTILINE)
DIGEST_LINE = re.compile(r"^(?P<sha256>[0-9a-fA-F]{64})(?:\s+\*?(?P<name>\S+))?\s*$")
BEGIN_CERTIFICATE = b"-----BEGIN CERTIFICATE-----"
END_CERTIFICATE = b"-----END CERTIFICATE-----"


class RefreshError(Exception):
    pass


def fetch(source: str, name: str) -> bytes:
    """One file from the source: an https:// (or http://) base URL, or a local folder."""
    if source.startswith(("https://", "http://")):
        url = source.rstrip("/") + "/" + name
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return response.read()
        except (urllib.error.URLError, OSError) as error:
            raise RefreshError(f"download of {url} failed: {error}") from error
    path = Path(source) / name
    try:
        return path.read_bytes()
    except OSError as error:
        raise RefreshError(f"cannot read {path}: {error}") from error


def expected_digest(digest_file: bytes) -> str:
    """The hex SHA-256 of ``cacert.pem.sha256`` (``<hex>  cacert.pem``)."""
    for line in digest_file.decode("utf-8", errors="replace").splitlines():
        match = DIGEST_LINE.match(line.strip())
        if match and match.group("name") in (None, BUNDLE_NAME):
            return match.group("sha256").lower()
    raise RefreshError(f"{DIGEST_NAME} does not hold a SHA-256 line for {BUNDLE_NAME}")


def iso_date(mozilla_date: str) -> str:
    """``Tue Oct 20 13:32:40 2026 GMT`` -> ``2026-10-20`` (the raw text when the form changed)."""
    for form in ("%a %b %d %H:%M:%S %Y %Z", "%a %b %d %H:%M:%S %Y"):
        try:
            return datetime.strptime(mozilla_date, form).date().isoformat()
        except ValueError:
            continue
    return mozilla_date


def inspect_bundle(data: bytes) -> tuple[str, int]:
    """(Mozilla date line, number of root certificates); fails when the file is not a bundle."""
    head = data[:4096].decode("utf-8", errors="replace")
    if not head.startswith("##\n## Bundle of CA Root Certificates"):
        raise RefreshError(f"{BUNDLE_NAME} does not start with the curl bundle header")
    match = DATE_LINE.search(head)
    if not match:
        raise RefreshError(f"{BUNDLE_NAME} has no 'Certificate data from Mozilla as of' line")
    roots = data.count(BEGIN_CERTIFICATE)
    if roots == 0 or roots != data.count(END_CERTIFICATE):
        raise RefreshError(f"{BUNDLE_NAME} holds no complete certificate ({roots} BEGIN markers)")
    if b"\r" in data:
        raise RefreshError(f"{BUNDLE_NAME} has CR bytes - not the file curl.se publishes")
    if not data.endswith(b"\n"):
        raise RefreshError(f"{BUNDLE_NAME} does not end with a newline")
    return match.group("date"), roots


def render_notice(source_url: str, mozilla_date: str, size: int, sha256: str, roots: int) -> str:
    return f"""Mozilla CA certificate bundle (cacert.pem)
==========================================

cacert.pem is Mozilla's CA certificate data - the root certificates of the Mozilla root
store (certdata.txt of the Network Security Services) in PEM form, as extracted and
distributed by the curl project (https://curl.se/docs/caextract.html). Maxima Fiction
Book Editor ships the file unmodified.

Licence
-------
The certificate data is distributed under the Mozilla Public License, version 2.0
(MPL-2.0, https://www.mozilla.org/MPL/2.0/). The editor only reads the file at run time
and never combines it with its code - an aggregated data file in the sense of GPLv3
section 5 - and redistributes it under the MPL-2.0 together with this notice. The full
licence text is in MPL-2.0.txt next to this file and, with the other third-party licence
texts, installed under share/doc/mfbe/licenses/; THIRD-PARTY-NOTICES.md lists the bundle
in its "Aggregated data files" section.

Provenance of the shipped copy
------------------------------
Source : {source_url} (digest file {DIGEST_NAME} next to it)
Date   : Certificate data from Mozilla as of: {mozilla_date} ({iso_date(mozilla_date)})
Size   : {size} bytes, {roots} root certificates
SHA-256: {sha256}

Use by the editor
-----------------
The editor uses this bundle on Linux only, and only when neither the environment
(SSL_CERT_FILE, CURL_CA_BUNDLE) nor the distribution (/etc/ssl/certs/ca-certificates.crt,
/etc/pki/tls/certs/ca-bundle.crt, /etc/ssl/ca-bundle.pem, /etc/ssl/cert.pem) provides a
CA bundle. The Windows and macOS packages do not carry it: there the system certificate
stores verify the connections.

Refresh
-------
python3 tools/refresh-cacert.py downloads the current bundle and its digest from
https://curl.se/ca/, verifies the digest and rewrites cacert.pem and this notice.
"""


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", default=SOURCE,
                        help=f"base URL or local folder holding {BUNDLE_NAME} and {DIGEST_NAME} (default {SOURCE})")
    args = parser.parse_args(argv)

    try:
        data = fetch(args.source, BUNDLE_NAME)
        digest = expected_digest(fetch(args.source, DIGEST_NAME))
        actual = hashlib.sha256(data).hexdigest()
        if actual != digest:
            raise RefreshError(f"SHA-256 mismatch: {DIGEST_NAME} says {digest}, {BUNDLE_NAME} hashes to {actual}")
        mozilla_date, roots = inspect_bundle(data)
        if not LICENCE_TEXT.is_file():
            raise RefreshError(f"{LICENCE_TEXT.relative_to(REPO).as_posix()} is missing - the notice points to it "
                               "(the verbatim Mozilla Public License 2.0 text, https://www.mozilla.org/MPL/2.0/)")
    except RefreshError as error:
        print(f"refresh-cacert: ERROR: {error}", file=sys.stderr)
        return 1

    source_url = SOURCE + BUNDLE_NAME  # the provenance names the published location, not a local copy
    notice = render_notice(source_url, mozilla_date, len(data), actual, roots)
    CERTS_DIR.mkdir(parents=True, exist_ok=True)
    bundle_changed = not BUNDLE.is_file() or BUNDLE.read_bytes() != data
    notice_changed = not NOTICE.is_file() or NOTICE.read_bytes() != notice.encode("utf-8")
    BUNDLE.write_bytes(data)
    NOTICE.write_bytes(notice.encode("utf-8"))

    print(f"refresh-cacert: {BUNDLE_NAME}: {len(data)} bytes, {roots} root certificates, "
          f"Certificate data from Mozilla as of: {mozilla_date} ({iso_date(mozilla_date)}), SHA-256 {actual}")
    for path, changed in ((BUNDLE, bundle_changed), (NOTICE, notice_changed)):
        print(f"refresh-cacert: {'wrote' if changed else 'unchanged'} {path.relative_to(REPO).as_posix()}")
    if bundle_changed or notice_changed:
        print("refresh-cacert: now run python3 tools/licence-check.py and commit the result with both files")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
