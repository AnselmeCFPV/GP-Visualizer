import type { TrackWorld } from '@prenois/track-viewer';
import { RIDER_LIVERY_COLORS } from '@prenois/track-viewer';

interface ApiRiderState {
  id: string;
  distanceM: number;
  speedKmh: number;
  lateralM: number;
  lateralSmooth: number;
  phase: number;
}

const RIDER_COUNTRIES = ['FR', 'IT', 'ES', 'GB', 'DE', 'JP', 'US', 'BR', 'AU', 'NL', 'BE', 'CH'];

export const DEMO_RIDER_COUNT = 30;

/** Simulateur API temps réel pour la démo (remplacé plus tard par @prenois/session-data). */
export function startApiSimulation(world: TrackWorld, riderCount = DEMO_RIDER_COUNT): void {
  const trackLength = world.getTrackLength();
  const riders: ApiRiderState[] = [];

  for (let i = 0; i < riderCount; i++) {
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
      distanceM: (trackLength * i) / riderCount,
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
