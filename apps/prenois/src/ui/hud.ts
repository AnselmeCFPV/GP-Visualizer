import type { TrackWorld } from '@prenois/track-viewer';

const HUD_VISIBLE_RIDERS = 12;

export function mountHud(world: TrackWorld, hudEl: HTMLElement | null): void {
  if (!hudEl) return;
  const hud = hudEl;

  function updateHud(): void {
    const riders = world.getAllRiderTelemetry();
    const lines = riders
      .slice(0, HUD_VISIBLE_RIDERS)
      .map(
        (r) =>
          `<span class="rider-line">${r.label} : <strong>${r.speedKmh.toFixed(0)}</strong> km/h · ${r.leanDeg.toFixed(0)}°</span>`,
      )
      .join('<br />');
    const hiddenCount = Math.max(0, riders.length - HUD_VISIBLE_RIDERS);

    hud.innerHTML = `
      <strong>Circuit de Prenois</strong> · ${riders.length} pilotes API<br />
      ${lines}
      ${hiddenCount > 0 ? `<br /><span class="rider-line">+ ${hiddenCount} autres pilotes</span>` : ''}
      <br />
      <kbd>1</kbd>–<kbd>4</kbd> changer caméra · clic pour le son
    `;
  }

  setInterval(updateHud, 100);
  updateHud();
}
