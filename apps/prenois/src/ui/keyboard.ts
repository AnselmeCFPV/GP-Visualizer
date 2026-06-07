import type { TrackViewport } from '@prenois/track-viewer';

export function bindCameraHotkeys(viewports: TrackViewport[]): void {
  window.addEventListener('keydown', (e) => {
    const idx = Number(e.key) - 1;
    if (idx >= 0 && idx < viewports.length) {
      viewports[idx]!.cycleCameraMode();
    }
  });
}

export function bindAudioResume(onResume: () => void): void {
  const resume = (): void => {
    onResume();
    window.removeEventListener('click', resume);
    window.removeEventListener('keydown', resume);
  };
  window.addEventListener('click', resume);
  window.addEventListener('keydown', resume);
}
