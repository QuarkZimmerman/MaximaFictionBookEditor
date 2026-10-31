/**
 * The left column of a menu item (feature 007, User Story 8; data-model §6, plan DP-6): the
 * check mark of a checkable item, else the item's icon - a 16 × 16 image, drawn on high-density
 * screens as the Scripts toolbar draws its icons (`layout.css`) -, else nothing. Every item has
 * the column, so the names of one menu level stay aligned with and without an icon; an image
 * that cannot be loaded is removed and leaves the empty column, without an error. `MenuBar` and
 * `PopupMenu` both draw their items' columns with it, so any menu can carry icons the same way.
 */

import { useState } from 'react';

import type { MenuIcon } from './menus';

export function MenuItemSlot({
  checked,
  checkable,
  icon,
}: {
  checked: boolean;
  /** A checkable item shows its check mark (or nothing) and never an icon. */
  checkable: boolean;
  icon?: MenuIcon;
}) {
  let content = null;
  if (checked) content = '✓';
  else if (!checkable && icon) content = <MenuIconImage key={icon.url} url={icon.url} />;
  return (
    <span className="mfbe-menu-check" aria-hidden="true">
      {content}
    </span>
  );
}

function MenuIconImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className="mfbe-menu-icon"
      src={url}
      width={16}
      height={16}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
