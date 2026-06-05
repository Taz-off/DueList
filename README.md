# DueList - Version HTML / GitHub

Ce dossier contient uniquement la version web statique de DueList.

## Pour mettre sur GitHub

1. Cree un nouveau depot GitHub.
2. Envoie tout le contenu de ce dossier a la racine du depot.
3. Dans GitHub, va dans `Settings` > `Pages`.
4. Choisis `Deploy from a branch`.
5. Selectionne la branche `main` et le dossier `/root`.
6. GitHub donnera une URL publique pour ouvrir l'application.

## Fichiers importants

- `index.html` : page principale.
- `src/` : code JavaScript et CSS de l'application.
- `public/` : logos et icones.
- `manifest.webmanifest` et `sw.js` : installation PWA / mode hors ligne.

Il ne faut pas mettre `node_modules`, `dist-electron` ou les fichiers `.exe` dans ce depot web.
