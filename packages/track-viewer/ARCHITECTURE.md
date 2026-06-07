# @prenois/track-viewer — Architecture

## Principe

**Vous fournissez** : bordures du circuit (`TrackBorders`) + mises à jour pilotes (`RiderUpdate`).

**La bibliothèque** : monde 3D partagé, N pilotes, M fenêtres de rendu indépendantes.

Le chargement KML, profils d'élévation et données CSV sont gérés par `@prenois/circuit` et `@prenois/session-data`.

## Intégration

```typescript
import { applyLapmetaProfileLocal, loadPrenoisCircuit } from '@prenois/circuit';
import { TrackWorld, TrackViewport } from '@prenois/track-viewer';

const borders = await loadPrenoisCircuit();

const world = await TrackWorld.create({
  borders,
  localElevationProfile: applyLapmetaProfileLocal,
});

world.registerRider({ id: 'rider-1', label: 'Pilote 1', color: 'blue-sky' });

const viewport = TrackViewport.create({
  world,
  container: document.getElementById('main')!,
  cameraViewId: 'follow',
  followRiderId: 'rider-1',
});

world.pushRiderUpdate('rider-1', { lon, lat, speedKmh: 165, leanDeg: 32 });
```

## Couches internes

| Couche | Rôle |
|--------|------|
| `TrackWorld` | Scène, circuit, pilotes, boucle de rendu, son |
| `TrackViewport` | Canvas WebGL, caméra, contrôles |
| `TrackViewer` | `TrackWorld` + un `TrackViewport` (raccourci mono-fenêtre) |
| `RiderPlayback` | Lissage d'affichage (pas correction des données source) |

## Monorepo

```
packages/track-viewer   ← ce package (rendu 3D uniquement)
packages/circuit        ← KML Prenois, profil LapMeta
packages/session-data   ← CSV pilotes, IMU, correction GPS (à venir)
apps/prenois            ← application (UI + orchestration)
```
