# PRENOIS — Monorepo

Visualisation circuit moto + application d'analyse de sessions enregistrées.

## Structure

```
packages/
  geo/              Types géographiques partagés (GeoPoint, TrackBorders)
  circuit/          Circuit Dijon-Prenois (KML, profil LapMeta)
  session-data/     Données enregistrées : CSV pilotes, IMU, correction GPS (à venir)
  track-viewer/     Module de visualisation 3D (Three.js)

apps/
  prenois/          Application (UI, orchestration, démo simulateur API)

public/             Assets statiques (modèles 3D, KML, sons)
```

## Scripts

```bash
npm install
npm run dev      # Lance apps/prenois
npm run build
```

## Séparation des responsabilités

| Package | Rôle |
|---------|------|
| `@prenois/track-viewer` | Rendu 3D, caméras, `pushRiderUpdate` |
| `@prenois/circuit` | Charger le tracé Prenois, enrichir l'élévation |
| `@prenois/session-data` | Base de données session (CSV, IMU, interpolation) |
| `@prenois/app` | Interface utilisateur + branchement visu / données |
