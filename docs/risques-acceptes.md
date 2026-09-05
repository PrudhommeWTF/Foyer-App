# Ce qui reste risqué

Écrit après les trois tranches de correction de l'audit. Une liste honnête de
risques assumés vaut mieux qu'un faux sentiment de sécurité : ce document existe
pour que vous sachiez exactement ce que vous acceptez en ouvrant le domaine.

Rien de ce qui suit n'est un oubli. Chaque ligne est un compromis, avec ce qu'il
faudrait faire pour le lever.

---

## 1. Les risques qui subsistent, par ordre de gravité

### La réutilisation d'un mot de passe, sur un compte sans second facteur

**Le risque.** Si l'un de vous utilise ailleurs le mot de passe du foyer, et que
cet ailleurs fuite, un attaquant entre avec des identifiants valides. Aucune des
protections de temporisation ne voit passer une connexion réussie du premier
coup : ni le verrou par compte, ni l'égalisation du temps de réponse, ni
fail2ban. Le journal dira « Connexion réussie » depuis une adresse inconnue, et
c'est tout.

**Ce qui a été fait.** Le second facteur (TOTP) existe désormais, et c'est
exactement le scénario qu'il couvre : le mot de passe seul ne suffit plus.

**Ce qui reste.** Il est **facultatif**, compte par compte. Un compte qui ne l'a
pas posé reste exposé à ce scénario, exactement comme avant. Le rendre
obligatoire pour tout le monde a été écarté : un enrôlement raté ou un téléphone
perdu fermerait un compte, et une protection qu'on subit finit par être
contournée ou retirée.

**Ce que vous devez faire.** Le poser sur **chaque compte adulte**, en
commençant par les administrateurs, et vérifier de temps en temps où en est le
foyer :

```sh
sqlite3 /var/lib/foyer/foyer.db \
  "SELECT email, CASE WHEN totp_secret IS NULL THEN 'NON' ELSE 'oui' END AS second_facteur FROM users;"
```

L'écran Famille le dit aussi, d'un coup d'oeil : un badge « 2FA » sur les
membres qui l'ont posé.

**En complément, toujours.** Un mot de passe unique par personne, et une
relecture du journal des connexions de temps en temps :

```sh
journalctl -u foyer --since "7 days ago" | grep "Connexion réussie" \
  | grep -oE "depuis [0-9a-f.:]+" | sort | uniq -c | sort -rn
```

### Le second facteur peut être retiré par un administrateur

**Le risque.** Un téléphone se perd, se casse, se réinitialise, et les codes de
secours partent avec le papier sur lequel ils étaient notés. Il faut donc une
sortie : un administrateur peut retirer le second facteur d'un membre. Cela veut
dire, mécaniquement, qu'un **compte administrateur compromis peut retirer le
second facteur de toute la famille**, puis se connecter avec les mots de passe
qu'il aurait par ailleurs.

**Pourquoi il reste.** Sans cette sortie, un accident de téléphone fermerait un
compte définitivement. Le compromis est assumé.

**Ce qui l'atténue.** Le geste redemande le mot de passe de l'administrateur,
n'est pas silencieux (il est journalisé, avec l'adresse), et ne donne pas accès
au compte : il retire une protection, il ne fournit pas le mot de passe.

```sh
journalctl -u foyer --since "30 days ago" | grep "Second facteur"
```

### Le secret du second facteur est rangé en clair dans la base

**Le risque.** Si la base fuite, les secrets TOTP fuitent avec, et le second
facteur ne protège plus rien pour les comptes concernés.

**Pourquoi c'est assumé.** Le chiffrer avec une clé rangée sur la même machine
ne protégerait de rien : qui lit la base lit la clé. Ce serait de la sécurité par
l'obscurité présentée comme une protection, exactement ce que cet audit refuse
d'écrire. Et surtout, une base qui fuite a déjà livré ce qui compte vraiment,
l'agenda des enfants, l'adresse et les finances, tous en clair : protéger la
connexion à une application dont on a déjà les données n'est plus le sujet.

**Ce qui le lèverait vraiment.** Le chiffrement du volume au niveau de l'hôte
Proxmox (LUKS), qui protège la base **et** tout le reste au repos.

### Un compte administrateur compromis donne root sur la machine

**Le risque.** L'auto-mise à jour est restée activée, à votre demande. Le
mécanisme est bien conçu (le service ne détient aucun droit supplémentaire : il
dépose un fichier, une unité systemd root fait le travail), mais la chaîne
« compte administrateur volé » vers « exécution de code en root sur le
conteneur » existe.

**Ce qui a été fait.** La mise à jour redemande le mot de passe, ce qui ferme le
cas du jeton dérobé sur un téléphone déverrouillé. Le lancement et les refus
sont journalisés.

**Ce qui reste.** Quelqu'un qui connaît le mot de passe d'un administrateur peut
toujours déclencher une mise à jour, donc faire télécharger et exécuter du code
depuis le dépôt GitHub configuré.

**Ce qui le lèverait.** `SELF_UPDATE=false` dans `/etc/foyer/foyer.env`, et une
mise à jour manuelle par `deploy/lxc/update.sh`. Une commande, à votre main.
Ou, plus fin, la restriction par IP des chemins `/api/system/` à votre réseau
(section 7.2 du rapport d'audit) : un mot de passe volé ne donne alors plus
l'administration depuis l'extérieur.

### Le jeton du flux ICS

**Le risque.** Le calendrier partagé est servi **sans authentification**, le
jeton dans l'URL faisant office de secret. C'est une nécessité : Google Agenda
et Apple Calendrier ne savent pas porter d'en-tête d'autorisation. Ce jeton
donne accès à tout le calendrier du foyer, horaires des enfants compris.

**Pourquoi il reste.** Le supprimer voudrait dire renoncer au calendrier
partagé, qui est une fonctionnalité utilisée.

**Ce qui a été fait.** Le jeton fait 144 bits : il n'est pas devinable. Sa
lecture et sa création sont réservées à un administrateur, le flux a une
limitation de débit, et il se renouvelle d'un bouton.

**Ce qui reste.** Un jeton qui fuite (capture d'écran, historique de navigateur,
partage d'un lien d'agenda à quelqu'un qui le rediffuse) donne un accès
permanent et silencieux, jusqu'à ce que vous le renouveliez. Rien ne vous
préviendra.

**Ce qui le lèverait.** Le renouveler périodiquement, ce qui oblige chacun à
réabonner son agenda. Ou couper le partage.

```sh
# Renouveler : l'ancien lien cesse immédiatement de fonctionner
# Paramètres > Calendriers > bouton de régénération (administrateur)
```

### Le jeton de session est lisible par un script dans la page

**Le risque.** Le jeton vit dans `localStorage`, donc tout script s'exécutant
dans la page pourrait le lire.

**Pourquoi il reste.** Le passage à un cookie `httpOnly` demanderait une
protection CSRF sur toute l'API, casserait l'abonnement ICS et le service
worker, et reviendrait à la refonte de l'authentification que vous ne vouliez
pas. Le rapport d'audit détaille le calcul (constat M11).

**Pourquoi c'est acceptable.** Il faudrait d'abord qu'un script étranger
s'exécute dans la page, ce qui suppose de franchir : une politique de sécurité
de contenu sans `unsafe-inline` ni `unsafe-eval` sur les scripts, l'échappement
par défaut d'Angular, et l'absence totale d'`innerHTML` et de
`bypassSecurityTrust` dans tout le code. La surface est réellement fermée.

**Ce qui a été fait à la place.** Session ramenée à 7 jours, renouvellement
silencieux du jeton à mi-vie, déconnexion après 12 h d'inactivité.

### La disponibilité n'est pas garantie

**Le risque.** Un compte authentifié peut encore consommer beaucoup : un import
de relevé de 25 Mo, un document de 4 Mo, des lots de 500 opérations. Rien de
tout cela ne tue le service, mais rien ne l'empêche d'être lent.

**Pourquoi c'est acceptable.** Votre modèle de menace place la confidentialité
avant la disponibilité, et vous avez des sauvegardes. Un foyer indisponible une
heure est un désagrément, pas une fuite.

**Ce qui a été fait.** La bombe zip est bornée à 64 Mo par entrée, `MemoryMax=1G`
fait redémarrer le service plutôt que d'emporter l'hôte, et bcrypt est passé en
asynchrone pour que la route de connexion ne fige plus l'application.

### La temporisation vit en mémoire

**Le risque.** Les compteurs de tentatives de connexion sont en mémoire : un
redémarrage du service les remet à zéro. Quelqu'un qui saurait provoquer des
redémarrages pourrait effacer son ardoise.

**Pourquoi c'est acceptable.** Provoquer un redémarrage demande déjà un accès
qu'un attaquant extérieur n'a pas, et fail2ban prend le relais côté proxy à
partir des journaux, lui persistant.

### La sortie réseau reste possible vers Internet

**Le risque.** L'import de recette va chercher une page à une adresse que vous
collez. Les adresses privées sont refusées, la connexion est ouverte sur
l'adresse déjà validée (plus de réidentification DNS possible), la taille et la
durée sont bornées. Mais le serveur peut toujours joindre **Internet**.

**Pourquoi c'est acceptable.** C'est la fonctionnalité elle-même.

**Ce qui le lèverait.** Le réglage « Importer une recette depuis une adresse
web » coupe cette sortie entièrement, depuis l'application.

### Le contenu n'est pas chiffré au repos

**Le risque.** La base et les documents scannés sont en clair sur le disque du
conteneur. Quelqu'un qui obtient le disque ou une image du conteneur lit tout.

**Pourquoi c'est acceptable.** L'accès physique est hors de votre périmètre, et
le chiffrement applicatif d'une base SQLite lue à chaque requête coûterait cher
pour un gain limité : la clé devrait vivre sur la même machine.

**Ce qui a été fait.** Les fichiers sont en 0600 et le répertoire en 0700, avec
`UMask=0077` sur le service : un autre compte local du conteneur ne lit plus
rien. Les **sauvegardes**, elles, sont chiffrées, et c'est là que ça comptait le
plus, puisqu'elles voyagent.

**Ce qui le lèverait.** Un chiffrement du volume au niveau du système (LUKS sur
l'hôte Proxmox), qui protège le disque au repos sans rien changer à
l'application.

---

## 2. Ce que l'audit n'a pas couvert

Dit franchement, pour que vous sachiez où sont les angles morts.

- **La revue ligne à ligne de tout le code métier.** L'audit a couvert la
  surface d'attaque : routes, authentification, autorisations, entrées,
  déploiement. Les 15 000 lignes de logique du store frontend n'ont pas été
  relues à la recherche de bugs métier, qui ne sont pas des failles.
- **Le conteneur Docker durci n'a pas été lancé.** Aucun démon Docker n'était
  disponible dans l'environnement d'audit. Le `Dockerfile` et le
  `docker-compose.yml` sont corrects par lecture, et le piège de l'ordre
  `chown`/`VOLUME` a été traité, mais **la première construction est à
  vérifier** : si le service ne démarre pas avec un `EACCES` sur `/data`, c'est
  là qu'il faut regarder. Si vous déployez en LXC, ce point ne vous concerne pas.
- **La configuration NGINX Proxy Manager n'a pas été appliquée.** Elle est
  écrite en section 7.2 du rapport, elle n'a pas été mise en oeuvre ni
  éprouvée depuis l'extérieur. La checklist de mise en ligne est faite pour ça.
- **Aucun test de charge.** Personne n'a mesuré ce que fait le service sous mille
  requêtes par seconde.
- **Les dépendances au-delà des avis publiés.** `npm audit` ne connaît que ce
  qui est déclaré. Une bibliothèque compromise dont personne n'a encore parlé
  passerait.

---

## 3. Ce sur quoi vous pouvez vous appuyer

Pour équilibrer, et parce que c'est vrai : l'audit a trouvé une faille critique
et neuf constats élevés, tous corrigés, mais il a aussi trouvé un socle sain.

- **Aucune injection SQL possible** : tout est en requêtes préparées, y compris
  les filtres dynamiques.
- **Le parseur XML est immunisé par construction** contre XXE et l'expansion
  d'entités, sur les imports CAMT.053 et OFX.
- **Aucun `innerHTML` ni `bypassSecurityTrust`** dans tout le frontend, sous une
  politique de sécurité de contenu réellement stricte.
- **Les fichiers sont adressés par empreinte** : ni devinables, ni traversables,
  et le nom donné par l'utilisateur n'atteint jamais le système de fichiers.
- **Aucun secret dans l'historique Git**, vérifié sur l'ensemble des commits, et
  la CI le vérifie désormais à chaque construction.
- **La révocation fonctionne** : changer un mot de passe coupe les sessions d'un
  compte, changer le secret JWT les coupe toutes.
- **Aucune télémétrie, aucun service tiers.** Depuis que les polices sont
  servies par le foyer, la page ne fait plus **aucune** requête vers
  l'extérieur. Le second facteur lui-même ne parle à personne : le calcul est
  local des deux côtés, il n'y a ni SMS, ni service d'authentification.
- **Le calcul du second facteur est éprouvé contre les vecteurs de la
  RFC 6238**, c'est-à-dire contre la même référence que les applications de
  téléphone. Ce n'est pas « ça marche chez moi ».

---

## 4. Ce qu'il faudrait faire ensuite, par ordre d'utilité

1. **Poser le second facteur sur chaque compte adulte.** Le mécanisme existe ;
   ce qui reste est un geste, pas un chantier. Tant qu'il n'est posé nulle part,
   il ne protège personne.
2. **La restriction par IP** de `/api/system/` et `/api/settings/` à votre
   réseau. Une configuration NGINX, pas une ligne de code.
3. **Le chiffrement du volume** au niveau de l'hôte Proxmox.
4. **Un second audit après six mois** d'exposition réelle, avec les journaux
   sous les yeux : ils diront ce que les robots cherchent vraiment chez vous.
