import { applyLapmetaProfileLocal, loadPrenoisCircuit } from '@prenois/circuit';
import { TrackWorld, TrackViewport } from '@prenois/track-viewer';
import { DEMO_RIDER_COUNT, startApiSimulation } from './simulation/apiSimulation';
import { bindAudioResume, bindCameraHotkeys } from './ui/keyboard';
import { mountHud } from './ui/hud';

async function init(): Promise<void> {
  const borders = await loadPrenoisCircuit();

  const world = await TrackWorld.create({
    borders,
    localElevationProfile: applyLapmetaProfileLocal,
    riderUpdateIntervalMs: 100,
  });

  startApiSimulation(world, DEMO_RIDER_COUNT);

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
      followRiderId: `rider-${DEMO_RIDER_COUNT}`,
    }),
    TrackViewport.create({
      world,
      container: document.getElementById('view-track')!,
      cameraViewId: 'trackOrbit',
      followRiderId: 'rider-1',
    }),
  ];

  bindAudioResume(() => {
    void world.resumeAudio();
  });
  bindCameraHotkeys(viewports);
  mountHud(world, document.getElementById('hud'));

  window.addEventListener('beforeunload', () => {
    world.dispose();
  });
}

init();
