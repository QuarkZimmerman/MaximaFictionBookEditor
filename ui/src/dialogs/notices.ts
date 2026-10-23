/**
 * The notices the About dialog bundles at build time (`?raw` imports of `CONTRIBUTORS.txt` and
 * `resources/certs/cacert.NOTICE.txt`), as the dialog shows them.
 */

/**
 * A bundled notice as the dialog shows it: LF line ends on every platform - a Windows checkout
 * gives the files CRLF, which a `<pre>` would keep character for character - and without the
 * final newline.
 */
export function noticeText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\n$/, '');
}
