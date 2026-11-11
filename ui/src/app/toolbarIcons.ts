/** The URL of a toolbar icon in the built interface (`public/icons/toolbar16`, `toolbar24`). */
export function iconUrl(icon: string, size: 16 | 24 = 24): string {
  return `${import.meta.env.BASE_URL}icons/toolbar${size}/${icon}.png`;
}
