// "Kolekia ile aç" ile gelen dosyaları içe aktarma ekranına yönlendirir
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    // iPhone file://, Android content:// adresiyle gönderir
    if (path && (path.startsWith('file:') || path.startsWith('content:'))) {
      return `/import?uri=${encodeURIComponent(path)}`;
    }
    return path;
  } catch {
    return '/';
  }
}
