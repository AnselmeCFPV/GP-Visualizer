import { RIDER_LIVERY_COLORS, TrackWorld, TrackViewport } from './track-viewer';

interface ApiRiderState {
  id: string;
  distanceM: number;
  speedKmh: number;
  lateralM: number;
  lateralSmooth: number;
  phase: number;
}

const RIDER_COUNT = 300;
const HUD_VISIBLE_RIDERS = 12;
const RIDER_COUNTRIES = ['FR', 'IT', 'ES', 'GB', 'DE', 'JP', 'US', 'BR', 'AU', 'NL', 'BE', 'CH'];

function startApiSimulation(world: TrackWorld): void {
  const trackLength = world.getTrackLength();
  const riders: ApiRiderState[] = [];

  for (let i = 0; i < RIDER_COUNT; i++) {
    const id = `rider-${i + 1}`;
    const color = RIDER_LIVERY_COLORS[i % RIDER_LIVERY_COLORS.length]!;
    world.registerRider({
      id,
      label: `Pilote ${i + 1}`,
      country: RIDER_COUNTRIES[i % RIDER_COUNTRIES.length],
      color,
    });

    const lateralM = ((i % 7) - 3) * 0.65;
    riders.push({
      id,
      distanceM: (trackLength * i) / RIDER_COUNT,
      speedKmh: 140 + (i % 9) * 4,
      lateralM,
      lateralSmooth: lateralM,
      phase: i * 0.73,
    });
  }

  world.onBeforeUpdate((now, dt) => {
    for (const rider of riders) {
      const speedWave = Math.sin(now * 0.0007 + rider.phase) * 8;
      const speedKmh = rider.speedKmh + speedWave;
      rider.distanceM += (speedKmh / 3.6) * dt;

      const lateralTarget =
        rider.lateralM +
        Math.sin(now * 0.0013 + rider.phase) * 1.15 +
        Math.sin(now * 0.00037 + rider.phase * 1.9) * 0.65;
      const lateralAlpha = 1 - Math.exp(-dt * 5);
      rider.lateralSmooth += (lateralTarget - rider.lateralSmooth) * lateralAlpha;

      const update = world.sampleRiderKinematics(rider.distanceM, {
        speedKmh,
        lateralOffsetM: Math.max(-3.6, Math.min(3.6, rider.lateralSmooth)),
        timestamp: now,
      });
      world.pushRiderUpdate(rider.id, update);
    }
  });
}

async function init(): Promise<void> {
  const hud = document.getElementById('hud');

  const world = await TrackWorld.create({
    riderUpdateIntervalMs: 100,
  });
  startApiSimulation(world);

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
      cameraViewId: 'rear-bike',
      followRiderId: 'rider-1',
    }),
    TrackViewport.create({
      world,
      container: document.getElementById('view-p4')!,
      cameraViewId: 'firstPerson',
      followRiderId: `rider-${RIDER_COUNT}`,
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

  window.addEventListener('keydown', (e) => {
    const idx = Number(e.key) - 1;
    if (idx >= 0 && idx < viewports.length) {
      const vp = viewports[idx]!;
      vp.cycleCameraMode();
    }
  });

  setInterval(updateHud, 100);
  updateHud();

  window.addEventListener('beforeunload', () => {
    world.dispose();
  });
}

init();
