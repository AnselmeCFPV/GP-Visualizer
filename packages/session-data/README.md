# @prenois/session-data

Base de données **enregistrée** d'une session : CSV pilotes, traces GPS corrigées, IMU.

Ce package ne gère pas le temps réel. Il charge, nettoie, interpole et expose les données
que l'application PRENOIS consomme ensuite (visu, analyse, export).

## Implémenté

- `load/pilotCsv.ts` — parse les CSV pilote (en-tête `Index;Date;Hour;…`)
- `filter/gpsTrace.ts` — filtre vitesse > 30 km/h et proximité circuit (< 3 km)
- `correct/satelliteReference.ts` — référence = moyenne pondérée (nb satellites) des meilleures traces
- `correct/traceCurve.ts` — projection continue (s, latéral) + lissage gaussien le long de l'arc
- `correct/gpsTrack.ts` — recalage session de toutes les traces sur la référence + bordures

## À venir

- `correct/` — correction des traces GPS (outliers, snap circuit, etc.)
- `interpolate/` — interpolation temporelle (état pilote à l'instant t)
- `SessionStore` — API de lecture unifiée

## Consommateurs

- `apps/prenois` — lecture session, envoi `RiderUpdate` vers `@prenois/track-viewer`
