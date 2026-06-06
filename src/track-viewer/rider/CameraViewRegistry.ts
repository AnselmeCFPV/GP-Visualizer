import type {
  CameraBuiltinViewSpec,
  CameraMode,
  CameraOrbitViewSpec,
  CameraViewDefinition,
  LocalPoint,
} from '../types';

const BUILTIN_LABELS: Record<CameraMode, string> = {
  free: 'Libre',
  orbit: 'Orbite pilote',
  follow: 'Spectateur',
  firstPerson: '1ère personne',
};

function builtin(mode: CameraMode): CameraViewDefinition {
  return {
    id: mode,
    label: BUILTIN_LABELS[mode],
    spec: { type: 'builtin', mode } satisfies CameraBuiltinViewSpec,
  };
}

export class CameraViewRegistry {
  private readonly views = new Map<string, CameraViewDefinition>();

  constructor() {
    this.registerDefaults();
  }

  register(def: CameraViewDefinition): void {
    this.views.set(def.id, def);
  }

  unregister(id: string): void {
    if (id in BUILTIN_LABELS) return;
    this.views.delete(id);
  }

  get(id: string): CameraViewDefinition | undefined {
    return this.views.get(id);
  }

  list(): CameraViewDefinition[] {
    return [...this.views.values()];
  }

  private registerDefaults(): void {
    const modes: CameraMode[] = ['free', 'orbit', 'follow', 'firstPerson'];
    for (const mode of modes) {
      this.register(builtin(mode));
    }

    this.register({
      id: 'trackOrbit',
      label: 'Circuit — orbite lente',
      spec: {
        type: 'orbit',
        anchor: 'trackCenter',
        radius: 340,
        azimuthDeg: 0,
        elevationDeg: 58,
        spinSpeedDegPerSec: 3.5,
      } satisfies CameraOrbitViewSpec,
    });

    this.register({
      id: 'broadcast',
      label: 'TV — orbite pilote',
      spec: {
        type: 'orbit',
        anchor: 'rider',
        radius: 42,
        azimuthDeg: 35,
        elevationDeg: 28,
        spinSpeedDegPerSec: 10,
      } satisfies CameraOrbitViewSpec,
    });

    this.register({
      id: 'helicopter',
      label: 'Hélicoptère pilote',
      spec: {
        type: 'orbit',
        anchor: 'rider',
        radius: 32,
        azimuthDeg: 210,
        elevationDeg: 52,
      } satisfies CameraOrbitViewSpec,
    });

    this.register({
      id: 'paddock',
      label: 'Paddock (fixe)',
      spec: {
        type: 'fixed',
        position: { x: 0, y: 0, z: 0 },
        lookAt: 'trackCenter',
      },
    });
  }
}

/** Recalcule la position d'une vue fixe relative au centre piste */
export function resolveFixedViewPosition(
  position: LocalPoint,
  trackCenter: LocalPoint,
): LocalPoint {
  if (position.x !== 0 || position.y !== 0 || position.z !== 0) {
    return position;
  }
  return {
    x: trackCenter.x + 95,
    y: trackCenter.y + 38,
    z: trackCenter.z + 120,
  };
}
