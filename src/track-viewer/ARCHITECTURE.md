# PRENOIS Track Viewer — Architecture

## Principe

**Vous fournissez** à chaque intervalle : identifiant pilote, position GPS, vitesse, inclinaison.

**La bibliothèque** : monde 3D partagé, N pilotes, M fenêtres de rendu indépendantes.

## Intégration multi-vues

```typescript
import { TrackWorld, TrackViewport } from './track-viewer';

const world = await TrackWorld.create({ startDemoSimulator: true, demoRiderCount: 4 });

const main = TrackViewport.create({
  world,
  container: document.getElementById('main')!,
  cameraViewId: 'follow',
  followRiderId: 'rider-1',
});

const onboard = TrackViewport.create({
  world,
  container: document.getElementById('onboard')!,
  cameraViewId: 'firstPerson',
  followRiderId: 'rider-2',
});

// Télémétrie temps réel par pilote
world.pushRiderUpdate('rider-1', { lon, lat, speedKmh: 165, leanDeg: 32 });
world.pushRiderUpdate('rider-2', { lon, lat, speedKmh: 160, leanDeg: 28 });
```

## Mono-fenêtre (raccourci)

```typescript
import { TrackViewer } from './track-viewer';

const viewer = await TrackViewer.create({ container });
viewer.pushRiderUpdate('rider-1', { lon, lat, speedKmh: 165, leanDeg: 32 });
```

## Couches

| Couche | Rôle |
|--------|------|
| `TrackWorld` | Scène, circuit, pilotes, boucle de simulation, son |
| `TrackViewport` | Canvas WebGL, caméra, contrôles, rendu |
| `TrackViewer` | `TrackWorld` + un `TrackViewport` |

## Démo multi-pilotes

`startDemoSimulator({ riderCount: 4, spacingM: 8 })` — 4 motos espacées de 8 m sur la piste.
