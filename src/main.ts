import { TrackWorld, TrackViewport } from './track-viewer';

async function init(): Promise<void> {
  const hud = document.getElementById('hud');

  const world = await TrackWorld.create({
    startDemoSimulator: true,
    demoRiderCount: 4,
    demoSpacingM: 8,
    demoSpeedKmh: 175,
    riderUpdateIntervalMs: 100,
  });

  const viewports = [
    TrackViewport.create({
      world,
      container: document.getElementById('view-leader')!,
      cameraViewId: 'follow',
      followRiderId: 'rider-1',
    }),
    TrackViewport.create({
      world,
      container: document.getElementById('view-tv')!,
      cameraViewId: 'broadcast',
      followRiderId: 'rider-1',
    }),
    TrackViewport.create({
      world,
      container: document.getElementById('view-p4')!,
      cameraViewId: 'firstPerson',
      followRiderId: 'rider-4',
    }),
    TrackViewport.create({
      world,
      container: document.getElementById('view-track')!,
      cameraViewId: 'trackOrbit',
      followRiderId: 'rider-1',
    }),
  ];

  const resumeAudio = (): void => {
    void world.resumeAudio();
    window.removeEventListener('click', resumeAudio);
    window.removeEventListener('keydown', resumeAudio);
  };
  window.addEventListener('click', resumeAudio);
  window.addEventListener('keydown', resumeAudio);

  function updateHud(): void {
    if (!hud) return;
    const riders = world.getAllRiderTelemetry();
    const lines = riders
      .map(
        (r) =>
          `<span class="rider-line">${r.label} : <strong>${r.speedKmh.toFixed(0)}</strong> km/h · ${r.leanDeg.toFixed(0)}°</span>`,
      )
      .join('<br />');

    hud.innerHTML = `
      <strong>Circuit de Prenois</strong> · 4 pilotes<br />
      ${lines}
      <br />
      <kbd>1</kbd>–<kbd>4</kbd> focus fenêtre active · clic pour le son
    `;
  }

  window.addEventListener('keydown', (e) => {
    const idx = Number(e.key) - 1;
    if (idx >= 0 && idx < viewports.length) {
      const vp = viewports[idx]!;
      vp.cycleCameraMode();
    }
  });

  setInterval(updateHud, 100);
  updateHud();

  window.addEventListener('beforeunload', () => world.dispose());
}

init();
