export function audioAssetUrl(relativePath: string) {
  return `${import.meta.env.BASE_URL}assets/audio/${relativePath}`;
}
