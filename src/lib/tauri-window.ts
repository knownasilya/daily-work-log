export async function applyAlwaysOnTop(enabled: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setAlwaysOnTop(enabled);
  } catch {
    /* not in Tauri or permission denied */
  }
}
