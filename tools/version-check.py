#!/usr/bin/env python3
"""Keeps every version-bearing file in step with the version label, and prints the version forms.

Feature 006 (specs/006-table-editing/contracts/installer.md, "The version forms" and "Release
workflow"; FR-054 to FR-056). The label is made of two inputs committed in CMakeLists.txt - the
numbers of ``project(MaximaFictionBookEditor VERSION <numeric> ...)`` and the pre-release part of
``set(MFBE_VERSION_PRERELEASE "<pre-release>")``, emptied only for a final version - and, in the
release workflow only, of the tag being built (the environment variable MFBE_RELEASE_TAG).
cmake/MfbeVersion.cmake derives the forms at every configure (``mfbe_version_forms``) and stays
the authority; this tool mirrors it for the checks that run before a configure or without one.

    form                         untagged    tag v0.0.6-rc.N   final: "" and the tag v0.0.6 or none
    MFBE_VERSION (the label)     0.0.6-rc    0.0.6-rc.N        0.0.6
    MFBE_VERSION_PACKAGE         0.0.6~rc    0.0.6~rc.N        0.0.6
    MFBE_VERSION_NUMERIC         0.0.6       0.0.6             0.0.6
    MFBE_UI_VERSION              0.0.6-rc    0.0.6-rc.N        0.0.6
    MFBE_APPIMAGE_CHANNEL        (empty)     latest-all        latest

The tag rule: an empty tag is untagged; with a pre-release part the tag must be
``v<numeric>-<pre-release>.N``, N a whole number from 1 without a leading zero; without one it
must be exactly ``v<numeric>``. Any other tag is refused with CMake's message, "tag <tag> does
not match the committed version <numeric>[-<pre-release>]".

Usage (from any folder; the files read are those of this repository):

  python3 tools/version-check.py --check
      The committed files follow the untagged label: the "version" of ui/package.json, the root
      "version" of ui/package-lock.json (top level and packages[""]) and the "version-string" of
      vcpkg.json equal it; the assemblyIdentity version of app/win/app.manifest is <numeric>.0;
      the first "## " heading of CHANGELOG.md is exactly "## <numeric> - unreleased" while a
      pre-release part is set and "## <numeric> - YYYY-MM-DD" once it is empty; and
      docs/releases/<numeric>.md does not exist while a pre-release part is set. Each problem
      is printed as "<file>: <what>"; exit status 1 when there is one (the CI lint job).
  python3 tools/version-check.py --tag <tag>
      Prints the forms for <tag> as KEY=value lines on stdout and nothing else there -
      MFBE_RELEASE_TAG, MFBE_VERSION, MFBE_VERSION_PACKAGE, MFBE_VERSION_NUMERIC,
      MFBE_UI_VERSION, MFBE_VERSION_PRERELEASE and MFBE_APPIMAGE_CHANNEL, empty values included
      -, so that a workflow step can append them to $GITHUB_ENV; --tag "" is untagged. A tag
      that does not fit prints CMake's message on stderr; exit status 1 (the app job of ci.yml
      untagged, the first step of release.yml with the run's tag).
  python3 tools/version-check.py --self-test
      Runs the embedded cases: the rows of the forms table, the refused tags, the reading of
      CMakeLists.txt, and the file, heading and release-page rules on synthetic trees.

A developer tool, never shipped; Python 3 standard library only (3.10, the CI runner's, or
newer). Exit status 2 on usage errors and, with --tag, when CMakeLists.txt has no readable
version.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Callable, Optional

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROJECT_NAME = "MaximaFictionBookEditor"
ASM_V1 = "urn:schemas-microsoft-com:asm.v1"

# The numbers of the label: three, without leading zeros (SemVer; app.manifest appends ".0").
NUMERIC_RE = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
# The pre-release part: SemVer's dot-separated identifiers (a number without a leading zero, or
# letters and digits), without "-": the package form turns the label's first "-" into "~", and
# dpkg would read a later "-" as the start of a Debian revision.
_IDENTIFIER = r"(?:0|[1-9][0-9]*|[0-9]*[A-Za-z][0-9A-Za-z]*)"
PRERELEASE_RE = re.compile(rf"{_IDENTIFIER}(?:\.{_IDENTIFIER})*")
# N of a tag v<numeric>-<pre-release>.N (cmake/MfbeVersion.cmake: "^[1-9][0-9]*$").
TAG_NUMBER_RE = re.compile(r"[1-9][0-9]*")

_PROJECT_CALL_RE = re.compile(r"^[ \t]*(?i:project)[ \t]*\(", re.M)
_PRERELEASE_CALL_RE = re.compile(
    r"^[ \t]*(?i:set)[ \t]*\([ \t]*MFBE_VERSION_PRERELEASE(?![0-9A-Za-z_])", re.M)
_PRERELEASE_VALUE_RE = re.compile(
    r'[ \t]*(?i:set)[ \t]*\([ \t]*MFBE_VERSION_PRERELEASE[ \t]+"([^"\\\n$;]*)"[ \t]*\)')
_BRACKET_COMMENT_RE = re.compile(r"#\[(=*)\[")
_SPACE_RE = re.compile(r"\s*")
_QUOTED_ARGUMENT_RE = re.compile(r'"((?:[^"\\]|\\.)*)"', re.S)
_UNQUOTED_ARGUMENT_RE = re.compile(r'[^\s()"]+')
_DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


class Unreadable(Exception):
    """CMakeLists.txt has no readable version; the message says what is missing."""


class TagMismatch(Exception):
    """A tag that does not fit the committed version; the message is CMake's."""

    def __init__(self, tag: str, numeric: str, prerelease: str) -> None:
        super().__init__(
            f"tag {tag} does not match the committed version "
            f"{committed_label(numeric, prerelease)}")
        if prerelease:
            self.expected = (f"v{numeric}-{prerelease}.N, N a whole number from 1 without a "
                             "leading zero")
        else:
            self.expected = f"v{numeric}"


@dataclass(frozen=True)
class Forms:
    """The version forms of mfbe_version_forms() for one tag (the build id, which takes the
    commit hash, is left to CMake)."""

    tag: str
    label: str
    package: str
    numeric: str
    ui: str
    prerelease: str
    channel: str

    def env_lines(self) -> list[str]:
        """The KEY=value lines of --tag, for $GITHUB_ENV; empty values included."""
        return [
            f"MFBE_RELEASE_TAG={self.tag}",
            f"MFBE_VERSION={self.label}",
            f"MFBE_VERSION_PACKAGE={self.package}",
            f"MFBE_VERSION_NUMERIC={self.numeric}",
            f"MFBE_UI_VERSION={self.ui}",
            f"MFBE_VERSION_PRERELEASE={self.prerelease}",
            f"MFBE_APPIMAGE_CHANNEL={self.channel}",
        ]


def committed_label(numeric: str, prerelease: str) -> str:
    """The untagged label: <numeric>-<pre-release>, or <numeric> without a pre-release part."""
    return f"{numeric}-{prerelease}" if prerelease else numeric


def version_forms(numeric: str, prerelease: str, tag: str) -> Forms:
    """The forms of cmake/MfbeVersion.cmake's mfbe_version_forms(); raises TagMismatch."""
    committed = committed_label(numeric, prerelease)
    label = committed
    if tag:
        if prerelease:
            # ^v<numeric>-<pre-release>\.([1-9][0-9]*)$, the committed parts compared literally.
            head = f"v{committed}."
            number = tag[len(head):]
            if not (tag.startswith(head) and TAG_NUMBER_RE.fullmatch(number)):
                raise TagMismatch(tag, numeric, prerelease)
            label = f"{committed}.{number}"
        elif tag != f"v{numeric}":
            raise TagMismatch(tag, numeric, prerelease)
    if not prerelease:
        channel = "latest"
    elif not tag:
        channel = ""
    else:
        channel = "latest-all"
    return Forms(tag=tag, label=label, package=label.replace("-", "~", 1), numeric=numeric,
                 ui=label, prerelease=prerelease, channel=channel)


def _cmake_code(text: str) -> str:
    """CMake text with its comments blanked out - line comments and bracket comments outside
    quoted arguments; line breaks kept -, so that a commented-out command is never read."""
    out: list[str] = []
    position, length = 0, len(text)
    quoted = False
    while position < length:
        char = text[position]
        if char == "\\":
            # An escape sequence (\", \#, \\ ...), in quoted and unquoted arguments alike.
            out.append(text[position:position + 2])
            position += 2
            continue
        if char == '"':
            quoted = not quoted
        elif char == "#" and not quoted:
            bracket = _BRACKET_COMMENT_RE.match(text, position)
            if bracket:
                closing = f"]{bracket.group(1)}]"
                end = text.find(closing, bracket.end())
                end = length if end < 0 else end + len(closing)
            else:
                end = text.find("\n", position)
                end = length if end < 0 else end
            out.append(re.sub(r"[^\n]", " ", text[position:end]))
            position = end
            continue
        out.append(char)
        position += 1
    return "".join(out)


def _call_arguments(code: str, position: int) -> Optional[list[str]]:
    """The arguments of the command call whose "(" ends just before position, up to its ")";
    None when the call is not closed or nests parentheses."""
    arguments: list[str] = []
    while True:
        position = _SPACE_RE.match(code, position).end()
        if position >= len(code):
            return None
        if code[position] == ")":
            return arguments
        quoted = _QUOTED_ARGUMENT_RE.match(code, position)
        if quoted:
            arguments.append(quoted.group(1))
            position = quoted.end()
            continue
        unquoted = _UNQUOTED_ARGUMENT_RE.match(code, position)
        if not unquoted:
            return None
        arguments.append(unquoted.group(0))
        position = unquoted.end()


def committed_version(cmake_text: str) -> tuple[str, str]:
    """(numeric, pre-release part) as CMakeLists.txt commits them; raises Unreadable."""
    code = _cmake_code(cmake_text)
    numeric: Optional[str] = None
    for call in _PROJECT_CALL_RE.finditer(code):
        arguments = _call_arguments(code, call.end())
        if arguments and arguments[0] == PROJECT_NAME:
            if "VERSION" in arguments[1:-1]:
                numeric = arguments[arguments.index("VERSION", 1) + 1]
            break
    if numeric is None:
        raise Unreadable(f"no VERSION in project({PROJECT_NAME} ...)")
    calls = list(_PRERELEASE_CALL_RE.finditer(code))
    if not calls:
        raise Unreadable('no set(MFBE_VERSION_PRERELEASE "...")')
    if len(calls) > 1:
        raise Unreadable(f"set(MFBE_VERSION_PRERELEASE ...) appears {len(calls)} times; the "
                         "label is read from exactly one")
    value = _PRERELEASE_VALUE_RE.match(code, calls[0].start())
    if not value:
        raise Unreadable('set(MFBE_VERSION_PRERELEASE ...) does not set one quoted value, '
                         '"<pre-release part>" or ""')
    return numeric, value.group(1)


def _is_date(text: str) -> bool:
    if not _DATE_RE.fullmatch(text):
        return False
    try:
        datetime.date(int(text[0:4]), int(text[5:7]), int(text[8:10]))
    except ValueError:
        return False
    return True


Reader = Callable[[str], Optional[str]]

# The JSON files whose version is the untagged label: (file, [(member path, its name)]).
_JSON_VERSIONS = (
    ("ui/package.json", [(("version",), '"version"')]),
    ("ui/package-lock.json", [(("version",), '"version"'),
                              (("packages", "", "version"), 'packages[""].version')]),
    ("vcpkg.json", [(("version-string",), '"version-string"')]),
)


def check(read: Reader, exists: Callable[[str], bool]) -> tuple[Optional[str], list[str]]:
    """The untagged label (None when CMakeLists.txt has none) and the problems, each
    "<file>: <what>", of the tree that read (the text of a repository path, None when it is
    missing) and exists show."""
    cmake = read("CMakeLists.txt")
    if cmake is None:
        return None, ["CMakeLists.txt: missing"]
    try:
        numeric, prerelease = committed_version(cmake)
    except Unreadable as error:
        return None, [f"CMakeLists.txt: {error}"]
    problems: list[str] = []
    if not NUMERIC_RE.fullmatch(numeric):
        problems.append(f'CMakeLists.txt: VERSION "{numeric}" of project({PROJECT_NAME} ...) is '
                        "not three numbers without leading zeros, <major>.<minor>.<patch>")
    if prerelease and not PRERELEASE_RE.fullmatch(prerelease):
        problems.append(f'CMakeLists.txt: MFBE_VERSION_PRERELEASE "{prerelease}" is not a '
                        "pre-release part: identifiers of letters and digits joined by dots, "
                        'numbers without a leading zero, no "-"')
    label = committed_label(numeric, prerelease)

    for path, members in _JSON_VERSIONS:
        text = read(path)
        if text is None:
            problems.append(f"{path}: missing")
            continue
        try:
            data = json.loads(text)
        except ValueError as error:
            problems.append(f"{path}: not valid JSON ({error})")
            continue
        for keys, name in members:
            value = data
            for key in keys:
                value = value.get(key) if isinstance(value, dict) else None
            if value is None:
                problems.append(f'{path}: no {name}; expected the version label "{label}"')
            elif value != label:
                problems.append(f'{path}: {name} is {json.dumps(value)}, expected the version '
                                f'label "{label}"')

    path = "app/win/app.manifest"
    text = read(path)
    expected_identity = f"{numeric}.0"
    if text is None:
        problems.append(f"{path}: missing")
    else:
        try:
            root = ET.fromstring(text)
        except ET.ParseError as error:
            problems.append(f"{path}: not well-formed XML ({error})")
        else:
            # The assembly's own identity, a child of the root - not those of its dependencies.
            identity = root.find(f"{{{ASM_V1}}}assemblyIdentity")
            version = identity.get("version") if identity is not None else None
            if root.tag != f"{{{ASM_V1}}}assembly" or identity is None:
                problems.append(f"{path}: no assemblyIdentity of the assembly; expected the "
                                f'version "{expected_identity}"')
            elif version != expected_identity:
                problems.append(f"{path}: the assemblyIdentity version is "
                                f'{json.dumps(version)}, expected "{expected_identity}" (the '
                                "numbers of the label and .0)")

    path = "CHANGELOG.md"
    text = read(path)
    if text is None:
        problems.append(f"{path}: missing")
    else:
        heading = next((line for line in text.splitlines() if line.startswith("## ")), None)
        if heading is None:
            problems.append(f'{path}: no "## " heading')
        elif prerelease:
            expected = f"## {numeric} - unreleased"
            if heading != expected:
                problems.append(f'{path}: the first heading is "{heading}", expected exactly '
                                f'"{expected}" while the pre-release part "{prerelease}" is set')
        else:
            prefix = f"## {numeric} - "
            if not (heading.startswith(prefix) and _is_date(heading[len(prefix):])):
                problems.append(f'{path}: the first heading is "{heading}", expected '
                                f'"{prefix}YYYY-MM-DD", the release date of {numeric}')

    path = f"docs/releases/{numeric}.md"
    if prerelease and exists(path):
        problems.append(f'{path}: exists while the pre-release part "{prerelease}" is set; the '
                        f"release page comes with the final {numeric}")
    return label, problems


def _repository_path(path: str) -> str:
    return os.path.join(ROOT, *path.split("/"))


def _read_repository_file(path: str) -> Optional[str]:
    try:
        with open(_repository_path(path), encoding="utf-8-sig", errors="replace") as handle:
            return handle.read()
    except FileNotFoundError:
        return None


def run_check() -> int:
    label, problems = check(_read_repository_file,
                            lambda path: os.path.exists(_repository_path(path)))
    for problem in problems:
        print(problem)
    if problems:
        print(f"version-check: {len(problems)} problem(s)")
        return 1
    print(f"version-check: OK - every version-bearing file follows the label {label}")
    return 0


def run_tag(tag: str) -> int:
    try:
        with open(_repository_path("CMakeLists.txt"), encoding="utf-8-sig") as handle:
            numeric, prerelease = committed_version(handle.read())
    except (OSError, UnicodeDecodeError, Unreadable) as error:
        print(f"version-check: CMakeLists.txt: {error}", file=sys.stderr)
        return 2
    try:
        forms = version_forms(numeric, prerelease, tag)
    except TagMismatch as error:
        print(error, file=sys.stderr)
        print(f"(the tag of this commit is {error.expected}; CMakeLists.txt commits "
              f"{committed_label(numeric, prerelease)})", file=sys.stderr)
        return 1
    sys.stdout.write("".join(f"{line}\n" for line in forms.env_lines()))
    return 0


# --- self-test -------------------------------------------------------------------------------

# The forms table of contracts/installer.md, as tests/cmake/version_forms.cmake checks CMake:
# (case, pre-release part, tag, label, package form, numeric form, UI version, channel).
_FORMS_TABLE = (
    ("untagged: an empty tag", "rc", "",
     "0.0.6-rc", "0.0.6~rc", "0.0.6", "0.0.6-rc", ""),
    ("tag v0.0.6-rc.1", "rc", "v0.0.6-rc.1",
     "0.0.6-rc.1", "0.0.6~rc.1", "0.0.6", "0.0.6-rc.1", "latest-all"),
    ("tag v0.0.6-rc.12", "rc", "v0.0.6-rc.12",
     "0.0.6-rc.12", "0.0.6~rc.12", "0.0.6", "0.0.6-rc.12", "latest-all"),
    ("final: tag v0.0.6, empty pre-release part", "", "v0.0.6",
     "0.0.6", "0.0.6", "0.0.6", "0.0.6", "latest"),
    ("final: no tag, empty pre-release part", "", "",
     "0.0.6", "0.0.6", "0.0.6", "0.0.6", "latest"),
)
# (pre-release part, tag): the six tags refused while the label is rc, v0.0.6-rc.1 without a
# pre-release part, and a few more shapes.
_REFUSED_TAGS = (
    ("rc", "v0.0.6"), ("rc", "v0.0.5"), ("rc", "v0.0.6-rc"), ("rc", "v0.0.6-beta.1"),
    ("rc", "v0.0.6-rc.0"), ("rc", "v0.0.6-rc.01"), ("", "v0.0.6-rc.1"),
    ("rc", "0.0.6-rc.1"), ("rc", "v0.0.6-rc.1.2"), ("rc", "v0.0.6-rc.1+build"), ("", "v0.0.6.0"),
)


def _synthetic_tree(numeric: str = "0.0.6", prerelease: str = "rc", *,
                    heading: Optional[str] = None, set_line: Optional[str] = None
                    ) -> dict[str, str]:
    """A consistent tree for the label <numeric>[-<pre-release>]: its CMakeLists.txt has a
    commented-out project() and set(), and quotes holding ")" and "#"."""
    label = committed_label(numeric, prerelease)
    if heading is None:
        heading = f"## {numeric} - unreleased" if prerelease else f"## {numeric} - 2026-11-02"
    if set_line is None:
        set_line = f'set(MFBE_VERSION_PRERELEASE "{prerelease}")'
    cmake = "\n".join([
        "cmake_minimum_required(VERSION 3.30)",
        "# project(MaximaFictionBookEditor VERSION 9.9.9) - a comment is not read",
        "#[[ set(MFBE_VERSION_PRERELEASE \"beta\") - nor a bracket comment ]]",
        "project(MaximaFictionBookEditor",
        f"  VERSION {numeric}",
        '  DESCRIPTION "Maxima Fiction Book Editor (a test) - # is no comment in quotes"',
        "  LANGUAGES C CXX)",
        "# set(MFBE_VERSION_PRERELEASE \"\") - the final, on the requester's word",
        set_line,
        "",
    ])
    lock = {"name": "mfbe-ui", "version": label, "lockfileVersion": 3,
            "packages": {"": {"name": "mfbe-ui", "version": label}}}
    manifest = "\n".join([
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        f'<assembly xmlns="{ASM_V1}" manifestVersion="1.0">',
        '  <assemblyIdentity type="win32" name="QuarkZimmerman.MaximaFictionBookEditor"'
        f' version="{numeric}.0" processorArchitecture="*"/>',
        "  <dependency><dependentAssembly>",
        '    <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls"'
        ' version="6.0.0.0"/>',
        "  </dependentAssembly></dependency>",
        "</assembly>",
        "",
    ])
    changelog = "\n".join([
        "# Changelog", "", "All notable changes.", "", heading, "", "### Changed", "",
        "- Something.", "", "## 0.0.5 - unreleased", "", "### Added", "", "- More.", "",
    ])
    return {
        "CMakeLists.txt": cmake,
        "ui/package.json": json.dumps({"name": "mfbe-ui", "version": label}, indent=2),
        "ui/package-lock.json": json.dumps(lock, indent=2),
        "vcpkg.json": json.dumps({"name": "maxima-fiction-book-editor",
                                  "version-string": label}, indent=2),
        "app/win/app.manifest": manifest,
        "CHANGELOG.md": changelog,
    }


def _check_tree(tree: dict[str, str]) -> tuple[Optional[str], list[str]]:
    return check(tree.get, lambda path: path in tree)


def self_test() -> int:
    failures: list[str] = []
    count = 0

    def expect(case: str, ok: bool, detail: object = "") -> None:
        nonlocal count
        count += 1
        if not ok:
            failures.append(f"{case}: {detail}" if detail != "" else case)

    # The forms table.
    for case, prerelease, tag, *expected in _FORMS_TABLE:
        forms = version_forms("0.0.6", prerelease, tag)
        got = [forms.label, forms.package, forms.numeric, forms.ui, forms.channel]
        expect(f"forms, {case}", got == expected, f"{got} != {expected}")
    package = version_forms("0.0.6", "alpha-1", "v0.0.6-alpha-1.2").package
    expect("the package form turns the first \"-\" only into \"~\"",
           package == "0.0.6~alpha-1.2", package)
    expect("--tag \"\" lines", version_forms("0.0.6", "rc", "").env_lines() == [
        "MFBE_RELEASE_TAG=", "MFBE_VERSION=0.0.6-rc", "MFBE_VERSION_PACKAGE=0.0.6~rc",
        "MFBE_VERSION_NUMERIC=0.0.6", "MFBE_UI_VERSION=0.0.6-rc", "MFBE_VERSION_PRERELEASE=rc",
        "MFBE_APPIMAGE_CHANNEL="], version_forms("0.0.6", "rc", "").env_lines())
    expect("--tag v0.0.6-rc.3 lines", version_forms("0.0.6", "rc", "v0.0.6-rc.3").env_lines() == [
        "MFBE_RELEASE_TAG=v0.0.6-rc.3", "MFBE_VERSION=0.0.6-rc.3",
        "MFBE_VERSION_PACKAGE=0.0.6~rc.3", "MFBE_VERSION_NUMERIC=0.0.6",
        "MFBE_UI_VERSION=0.0.6-rc.3", "MFBE_VERSION_PRERELEASE=rc",
        "MFBE_APPIMAGE_CHANNEL=latest-all"], version_forms("0.0.6", "rc", "v0.0.6-rc.3"))

    # The refused tags, with CMake's message.
    for prerelease, tag in _REFUSED_TAGS:
        committed = committed_label("0.0.6", prerelease)
        try:
            forms = version_forms("0.0.6", prerelease, tag)
        except TagMismatch as error:
            message = f"tag {tag} does not match the committed version {committed}"
            expect(f"refused with \"{prerelease}\": {tag}", str(error) == message, str(error))
        else:
            expect(f"refused with \"{prerelease}\": {tag}", False, f"accepted as {forms.label}")

    # Reading CMakeLists.txt.
    for case, text, version in (
        ("past comments and quotes", _synthetic_tree()["CMakeLists.txt"], ("0.0.6", "rc")),
        ("of a final", _synthetic_tree(prerelease="")["CMakeLists.txt"], ("0.0.6", "")),
        ("with an escaped quote and the calls in other forms",
         'message("a \\" #[[ is no comment") # project(MaximaFictionBookEditor VERSION 9.9.9)\n'
         'PROJECT( MaximaFictionBookEditor DESCRIPTION "x)" VERSION "1.2.3" )\n'
         '  SET(MFBE_VERSION_PRERELEASE "beta.2")  # the pre-release part\n'
         'message("]]")\n',
         ("1.2.3", "beta.2")),
    ):
        try:
            got = committed_version(text)
        except Unreadable as error:
            got = f"Unreadable: {error}"
        expect(f"CMakeLists.txt read {case}", got == version, got)
    for case, text in (
        ("no project()", 'set(MFBE_VERSION_PRERELEASE "rc")\n'),
        ("project() without VERSION",
         'project(MaximaFictionBookEditor LANGUAGES C)\nset(MFBE_VERSION_PRERELEASE "rc")\n'),
        ("no set()", "project(MaximaFictionBookEditor VERSION 0.0.6)\n"),
        ("two set()", "project(MaximaFictionBookEditor VERSION 0.0.6)\n"
                      'set(MFBE_VERSION_PRERELEASE "rc")\nset(MFBE_VERSION_PRERELEASE "")\n'),
        ("an unquoted set()",
         "project(MaximaFictionBookEditor VERSION 0.0.6)\nset(MFBE_VERSION_PRERELEASE rc)\n"),
        ("a cached set()", "project(MaximaFictionBookEditor VERSION 0.0.6)\n"
                           'set(MFBE_VERSION_PRERELEASE "rc" CACHE STRING "")\n'),
    ):
        try:
            got = committed_version(text)
        except Unreadable:
            expect(f"CMakeLists.txt unreadable: {case}", True)
        else:
            expect(f"CMakeLists.txt unreadable: {case}", False, f"read as {got}")

    # --check on synthetic trees: (case, tree, the files with a problem).
    def changed(tree: dict[str, str], path: str, old: str, new: str) -> dict[str, str]:
        assert old in tree[path], (path, old)
        return {**tree, path: tree[path].replace(old, new)}

    rc = _synthetic_tree()
    final = _synthetic_tree(prerelease="")
    stale = '"version": "0.0.5"'
    dependency = ('  <dependency><dependentAssembly><assemblyIdentity type="win32"'
                  ' name="Microsoft.Windows.Common-Controls" version="6.0.0.0"/>'
                  "</dependentAssembly></dependency>")
    own_identity = ('  <assemblyIdentity type="win32" name="QuarkZimmerman.MaximaFictionBookEditor"'
                    ' version="0.0.6.0"/>')

    def manifest(*children: str) -> str:
        return "\n".join([f'<assembly xmlns="{ASM_V1}" manifestVersion="1.0">', *children,
                          "</assembly>", ""])

    tree_cases = (
        ("consistent, pre-release rc", rc, []),
        ("consistent, final", final, []),
        ("final with its release page", {**final, "docs/releases/0.0.6.md": "# 0.0.6\n"}, []),
        ("ui/package.json behind", changed(rc, "ui/package.json", '"version": "0.0.6-rc"', stale),
         ["ui/package.json"]),
        ("ui/package-lock.json behind at the top",
         {**rc, "ui/package-lock.json": rc["ui/package-lock.json"].replace(
             '"version": "0.0.6-rc"', stale, 1)}, ["ui/package-lock.json"]),
        ("ui/package-lock.json behind in packages[\"\"]",
         {**rc, "ui/package-lock.json": json.dumps(
             {"name": "mfbe-ui", "version": "0.0.6-rc", "lockfileVersion": 3,
              "packages": {"": {"name": "mfbe-ui", "version": "0.0.6"}}})},
         ["ui/package-lock.json"]),
        ("vcpkg.json behind", changed(rc, "vcpkg.json", "0.0.6-rc", "0.0.5"), ["vcpkg.json"]),
        ("ui/package.json without a version",
         {**rc, "ui/package.json": '{"name": "mfbe-ui"}'}, ["ui/package.json"]),
        ("vcpkg.json not JSON", {**rc, "vcpkg.json": "{"}, ["vcpkg.json"]),
        ("app.manifest behind", changed(rc, "app/win/app.manifest", 'version="0.0.6.0"',
                                        'version="0.0.5.0"'), ["app/win/app.manifest"]),
        ("app.manifest with three numbers", changed(rc, "app/win/app.manifest",
                                                    'version="0.0.6.0"', 'version="0.0.6"'),
         ["app/win/app.manifest"]),
        ("app.manifest with the label", changed(rc, "app/win/app.manifest",
                                                'version="0.0.6.0"', 'version="0.0.6-rc"'),
         ["app/win/app.manifest"]),
        ("app.manifest with its dependency first",
         {**rc, "app/win/app.manifest": manifest(dependency, own_identity)}, []),
        ("app.manifest without an identity of its own",
         {**rc, "app/win/app.manifest": manifest(dependency)}, ["app/win/app.manifest"]),
        ("app.manifest not XML", {**rc, "app/win/app.manifest": "<assembly>"},
         ["app/win/app.manifest"]),
        ("a release date while rc is set", _synthetic_tree(heading="## 0.0.6 - 2026-11-02"),
         ["CHANGELOG.md"]),
        ("the 0.0.5 heading on top while rc is set", _synthetic_tree(
            heading="## 0.0.5 - unreleased"), ["CHANGELOG.md"]),
        ("a heading that is not exact", _synthetic_tree(heading="## 0.0.6 - Unreleased"),
         ["CHANGELOG.md"]),
        ("a heading with a trailing space", _synthetic_tree(heading="## 0.0.6 - unreleased "),
         ["CHANGELOG.md"]),
        ("a changelog without a heading", {**rc, "CHANGELOG.md": "# Changelog\n\n### Added\n"},
         ["CHANGELOG.md"]),
        ("the release page while rc is set", {**rc, "docs/releases/0.0.6.md": "# 0.0.6\n"},
         ["docs/releases/0.0.6.md"]),
        ("another release page while rc is set", {**rc, "docs/releases/0.0.5.md": "# 0.0.5\n"},
         []),
        ("a final still unreleased", _synthetic_tree(prerelease="",
                                                     heading="## 0.0.6 - unreleased"),
         ["CHANGELOG.md"]),
        ("a final dated on no day", _synthetic_tree(prerelease="",
                                                    heading="## 0.0.6 - 2026-02-30"),
         ["CHANGELOG.md"]),
        ("a final dated in another form", _synthetic_tree(prerelease="",
                                                          heading="## 0.0.6 - 2. 11. 2026"),
         ["CHANGELOG.md"]),
        ("a final dated under another version", _synthetic_tree(
            prerelease="", heading="## 0.0.5 - 2026-11-02"), ["CHANGELOG.md"]),
        ("four numbers in VERSION", _synthetic_tree(numeric="0.0.6.1"), ["CMakeLists.txt"]),
        ("a leading zero in VERSION", _synthetic_tree(numeric="0.0.06"), ["CMakeLists.txt"]),
        ("a pre-release part with a dash", _synthetic_tree(prerelease="rc-1"),
         ["CMakeLists.txt"]),
        ("a pre-release part with a leading zero", _synthetic_tree(prerelease="rc.01"),
         ["CMakeLists.txt"]),
        ("a pre-release part rc.1, the files follow", _synthetic_tree(prerelease="rc.1"), []),
        ("CMakeLists.txt with two set()", _synthetic_tree(
            set_line='set(MFBE_VERSION_PRERELEASE "rc")\nset(MFBE_VERSION_PRERELEASE "")'),
         ["CMakeLists.txt"]),
        ("no CMakeLists.txt", {k: v for k, v in rc.items() if k != "CMakeLists.txt"},
         ["CMakeLists.txt"]),
        ("no CHANGELOG.md", {k: v for k, v in rc.items() if k != "CHANGELOG.md"},
         ["CHANGELOG.md"]),
    )
    for case, tree, expected_files in tree_cases:
        _, problems = _check_tree(tree)
        files = sorted(problem.split(": ", 1)[0] for problem in problems)
        expect(f"--check, {case}", files == sorted(expected_files), problems)
    for case, tree, expected_label in (("rc", rc, "0.0.6-rc"), ("final", final, "0.0.6"),
                                       ("rc.1", _synthetic_tree(prerelease="rc.1"), "0.0.6-rc.1")):
        label, _ = _check_tree(tree)
        expect(f"--check reads the label of the tree, {case}", label == expected_label, label)

    for failure in failures:
        print(f"FAILED: {failure}")
    if failures:
        print(f"version-check --self-test: {len(failures)} of {count} cases failed")
        return 1
    print(f"version-check --self-test: all {count} cases passed")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true",
                      help="check the committed version strings against the label")
    mode.add_argument("--tag", metavar="TAG",
                      help='print the version forms for TAG as KEY=value lines ("" = untagged)')
    mode.add_argument("--self-test", action="store_true", help="run the embedded cases")
    args = parser.parse_args(argv)
    # KEY=value lines end in "\n" on every system (a workflow step appends them to $GITHUB_ENV).
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(newline="\n", errors="backslashreplace")
    if args.self_test:
        return self_test()
    if args.check:
        return run_check()
    return run_tag(args.tag)


if __name__ == "__main__":
    sys.exit(main())
