# Prompt : la capsule de Raditz

Copie le texte ci-dessous dans un nouveau chat et joins l'image de référence.

```text
Tu travailles sur Projet Lambda (dépôt Bitbucket rygaadev/project-lambda). Je te donne une image de référence : construis le plan de formes de la capsule spatiale de Raditz (nom : raditz-pod) en suivant exactement le guide des bâtiments.

RÈGLES
- Si tu n'es pas sûr de quelque chose, demande-moi. Ne suppose rien.
- Réponds-moi en français.
- Ne commite et ne pousse rien avant que je valide le résultat.

1. CLONER
Le token est dans $BITBUCKET_TOKEN, avec le nom d'utilisateur x-token-auth. Ne le mets ni dans l'URL ni dans la config git : passe-le à chaque commande.
  H='!f() { echo username=x-token-auth; echo "password=$BITBUCKET_TOKEN"; }; f'
  git -c credential.helper="$H" clone https://bitbucket.org/rygaadev/project-lambda.git
  cd project-lambda
  git -c credential.helper="$H" fetch origin claude/building-docs gpt
  git checkout claude/building-docs

2. LIRE AVANT DE CONSTRUIRE
- documentation/building/README.md : le guide. Suis-le à la lettre.
- documentation/building/example/ : les exemples. Le plus proche est capsule-ship (le vaisseau Capsule Corp) : c'est aussi une sphère. Regarde capsule-ship.json, build-capsule-ship.py (construit à partir de mesures), capsule-reference.png, le rendu et les comparaisons.
- Sur la branche gpt : packages/asset-format/src/schema.ts et geometry.ts (le sens de chaque champ et la forme de chaque type ; un dome a 14 côtés et 5 bandes).

3. CE QUE MONTRE L'IMAGE (à vérifier toi-même en mesurant)
- Une sphère gris-blanc posée dans un cratère, avec un hublot rond : une vitre rose-magenta dans un épais cadre noir.
- Les lignes de jointure de la coque, le hublot et les taches sont des textures plus tard : pas de formes pour eux, sauf si le cadre du hublot sort vraiment de la sphère sur l'image (demande-moi).
- Le cratère et le sol ne font pas partie du bâtiment : demande-moi avant de les modéliser.
- On ne voit pas le dessous de la sphère : demande-moi comment elle tient au sol (posée, enfoncée de combien, avec des pieds ou non).
- Demande-moi aussi la taille réelle de la sphère (le diamètre en mètres) avant de mesurer.

4. LES POINTS LES PLUS IMPORTANTS DU GUIDE
- Seulement la forme globale. Mesure au lieu de deviner : prends une partie comme échelle.
- N'ajoute rien que l'image n'a pas. Formes simples, 30 au maximum, couleurs unies de jour, aucune face null.
- Une sphère, c'est deux dômes (le haut, et le bas avec tilt 180). Si une partie de la sphère a une autre couleur, ne pose pas une forme en plus qui dépasse : regarde comment le vaisseau Capsule Corp fait sa calotte noire et sa bande (des copies de la demi-coque, un peu plus étroites et plus hautes, qui ne ressortent que là où il faut), pour que la couleur suive exactement la sphère.

5. VÉRIFIER EN DESSINANT (obligatoire)
L'outil de rendu est dans documentation/building/tools/preview/ (lis son README.md). Prépare-le une fois :
  ./documentation/building/tools/preview/setup.sh
Puis :
- node documentation/building/tools/preview/render.cjs view plan.json side.png --from=... --target=...
  (vue depuis le même angle que l'image de référence)
- node documentation/building/tools/preview/render.cjs compare reference.png side.png compare.png
- Compare la silhouette, la taille et la position de chaque partie. Corrige et recommence jusqu'à ce que ça corresponde.
- Puis vérifie la vue du jeu (render.cjs game) et les autres côtés (render.cjs turns) : rien ne flotte, rien ne traverse.

6. TEXTURES (seulement quand je te le demande)
documentation/building/textured/README.md explique comment les textures des 3 autres bâtiments ont été faites (Infer + painter.py). Garde-les simples et réutilise les mêmes : par exemple la vitre partagée (glass) pour le hublot. Je te donnerai la clé Infer à ce moment-là.

7. À ME RENDRE
- Le plan JSON (description, layout, shapes, textures), au même format que les exemples, et son script de construction.
- Le rendu dans la vue du jeu.
- Les images de comparaison avec la référence : au même angle, et dans la vue du jeu.
- Une liste courte de ce que tu as fait et des choix que tu as faits seul.
Quand je valide, mets la capsule dans documentation/building/example/ (le plan, le script, la référence en raditz-pod-reference.png, le rendu, les comparaisons) et pousse sur la branche claude/building-docs.
```
