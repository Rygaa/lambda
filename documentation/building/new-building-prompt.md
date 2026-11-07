# Prompt pour un nouveau bâtiment

Copie le texte ci-dessous dans un nouveau chat, remplace `[NOM DU BÂTIMENT]`, et joins l'image de référence.

```text
Tu travailles sur Projet Lambda (dépôt Bitbucket rygaadev/project-lambda). Je te donne une image de référence : construis le plan de formes du bâtiment [NOM DU BÂTIMENT] en suivant exactement le guide des bâtiments.

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
- documentation/building/example/ : les deux exemples (chichi-house et buu-house). Regarde le JSON, l'image de référence, le rendu et les images de comparaison. example/build-buu-house.py montre comment la maison de Buu est construite à partir de ses mesures.
- Sur la branche gpt : packages/asset-format/src/schema.ts et geometry.ts (le sens de chaque champ et la forme de chaque type).

3. LES POINTS LES PLUS IMPORTANTS DU GUIDE
- Seulement la forme globale. Portes, fenêtres, enseignes, trous, marches et détails seront des textures plus tard : pas de formes pour eux.
- Dans attempt_1, portes, fenêtres et trous sont des `details` en couleurs de palette : suis la section 10 du guide.
- Suivre l'image exactement. Mesure au lieu de deviner : prends une partie comme échelle, puis mesure la longueur, la hauteur, la profondeur et l'endroit où chaque partie est la plus haute.
- Les pièces restent droites, dans l'axe du corps, sauf si l'image montre clairement un angle. N'ajoute rien que l'image n'a pas.
- Une coupe est une face plate et pleine : rien ne sort, pas de vide.
- Formes simples, 30 au maximum, couleurs unies de jour, aucune face null.

4. VÉRIFIER EN DESSINANT (obligatoire)
L'outil de rendu est dans documentation/building/tools/preview/ (lis son README.md). Prépare-le une fois :
  ./documentation/building/tools/preview/setup.sh
Puis :
- node documentation/building/tools/preview/render.cjs view plan.json side.png --from=... --target=...
  (vue depuis le même angle que l'image de référence)
- node documentation/building/tools/preview/render.cjs compare reference.png side.png compare.png
  (les deux côte à côte)
- Compare la longueur, la hauteur, la profondeur, la silhouette de chaque partie et l'endroit où elle est la plus haute. Corrige ce qui diffère et recommence jusqu'à ce que ça corresponde.
- Puis vérifie la vue du jeu (render.cjs game) et les autres côtés (render.cjs turns) : rien ne flotte, rien ne traverse.

5. À ME RENDRE
- Le plan JSON (description, layout, shapes, textures), au même format que les exemples.
- Le rendu dans la vue du jeu.
- Les images de comparaison avec la référence : au même angle, et dans la vue du jeu.
- Une liste courte de ce que tu as fait et des choix que tu as faits seul.
Quand je valide, mets le bâtiment dans documentation/building/example/ (le plan, la référence, le rendu, les comparaisons) et pousse sur la branche claude/building-docs.
```
