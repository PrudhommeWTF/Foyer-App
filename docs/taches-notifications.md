# Rappels et notifications des tâches : note d'analyse

Tranche 3 du chantier Tâches. Rien de ce qui est décrit ici n'est codé : c'est
la base de la décision. Le brief est clair sur l'enjeu : une tâche non
rappelée est une tâche oubliée, et c'est exactement ce qui ferait rester le
foyer sur FamilyWall. Cette note dit donc ce qui marche vraiment, ce qui ne
marche qu'une fois sur trois, et ce que je recommande.

## 1. Ce que ça doit faire, et rien d'autre

Le volume est décidé avant le canal. Par défaut, deux choses seulement :

| Quoi | Quand | À qui |
|---|---|---|
| **Rappel d'échéance** | À l'heure choisie sur la tâche (« à l'heure », « 1 h avant », « la veille à 18 h », « le matin même à 9 h »). **Aucun rappel par défaut** : c'est un réglage par tâche, comme chez FamilyWall. | Les membres affectés. Une tâche sans responsable rappelle **tous les comptes du foyer** : c'est une tâche de la maison, et c'est le premier qui passe. |
| **Tâche qui m'est affectée** | Tout de suite, quand quelqu'un d'autre m'affecte une tâche (création ou modification). Pas quand je m'affecte moi-même. | Le membre affecté. |

Pas de notification à chaque ajout de chacun, pas de résumé quotidien, pas de
« Marie a coché ». Une série récurrente rappelle son occurrence courante,
c'est tout : la suivante aura son propre rappel quand elle sera là.

Une tâche datée **sans heure** est rappelée à **9 h** le jour dit (ou la
veille à 18 h si c'est ce réglage). L'heure est fixe, comme le fuseau et la
locale de l'application.

## 2. Ce que Foyer sait faire aujourd'hui

Un centre de notifications **dans l'application** (la cloche), calculé à
l'affichage : tâches du jour, en retard, anniversaires, échéances de contrat.
Il ne prévient que si l'application est ouverte, et il n'a aucune notion
d'heure. Il n'existe **ni tâche planifiée côté serveur, ni service worker, ni
manifeste de web app**, et le backend ne fait aucune requête sortante hors
vacances scolaires et mise à jour.

## 3. Le socle commun, quel que soit le canal

Quel que soit le canal retenu, il faut la même chose côté serveur. Ce socle
n'est pas le point difficile, et il ne dépend pas de l'arbitrage.

- **Sur la tâche** : un champ `remind` (minutes avant l'échéance, ou un mot
  clé pour « la veille 18 h » et « le matin 9 h »). Réglé dans la barre
  d'action du composeur, panneau « Date », à côté de l'heure.
- **Un planificateur** dans le backend : toutes les minutes, il lit le
  document, calcule les rappels dus dans la minute (échéance, heure,
  `remind`, fuseau Europe/Paris) et les émet. Léger : quelques dizaines de
  tâches, une lecture SQLite par minute.
- **Une mémoire des envois**, table `hh_notif_sent` (clé, date, canal,
  résultat). La clé porte la tâche **et** son échéance et son réglage : une
  tâche reportée est rappelée à nouveau, une série avancée aussi, mais un
  redémarrage du service au milieu de la minute ne renvoie rien deux fois.
  Une tâche faite ou supprimée n'est plus rappelée.
- **L'affectation** est émise au moment où l'opération est appliquée
  (`tasks/repo.ts`), pas par le planificateur : c'est immédiat, et la clé est
  l'identifiant de l'opération.
- **Journalisation** : chaque envoi et chaque échec fait une ligne
  `[foyer] Notifications : …` avec la tâche, le membre, le canal et l'erreur
  telle quelle. Un écran Paramètres dit l'état du canal, la date du dernier
  envoi réussi, la dernière erreur, et propose **« Envoyer un test »** par
  membre.
- **Le centre in-app** reçoit les mêmes rappels : quand le canal externe
  est coupé, on les voit au moins en ouvrant l'application.
- **Rien ne sort** tant qu'aucun canal n'est configuré. Le canal se coupe en
  retirant sa variable d'environnement.

## 4. Les options

### A. Web Push (VAPID) depuis le backend

Le navigateur s'abonne auprès du service push de son éditeur (Apple pour
Safari, Google pour Chrome), donne l'adresse d'abonnement à Foyer, et le
backend y envoie les messages signés avec une clé VAPID. C'est le standard,
et c'est ce que FamilyWall obtient avec une application native.

**Ce qui marche vraiment sur iPhone.** Depuis iOS 16.4, oui, mais à trois
conditions cumulatives, qui ne sont pas des détails :

1. l'application doit être **ajoutée à l'écran d'accueil** (Safari, Partager,
   « Sur l'écran d'accueil »). Dans un onglet Safari, pas de push, jamais ;
2. l'autorisation doit être demandée **sur un geste de l'utilisateur** (un
   bouton), et acceptée ;
3. **supprimer l'icône révoque l'autorisation** et l'abonnement. Il faut
   refaire la manipulation, et personne ne le sait tant qu'un rappel n'a pas
   manqué.

Et une règle d'Apple à connaître : si le service worker reçoit un message et
**n'affiche pas** de notification, iOS considère que c'est un push silencieux
et **annule l'abonnement**. Un bug de notre côté, une seule fois, et le
téléphone ne reçoit plus rien, sans le dire. Apple a introduit avec iOS 18.4
un « Declarative Web Push » qui allège ce point, mais seulement sur les
appareils à jour.

**Ce que ça coûte chez nous.** Une dépendance `web-push` (pure JavaScript,
légère), un service worker et un manifeste dans le frontend (ce que la
tranche PWA prévoyait de toute façon), une table d'abonnements par membre et
par appareil, la gestion des abonnements morts (le service push répond 410,
il faut les retirer), et un écran pour s'abonner, se désabonner, et vérifier.
HTTPS obligatoire : c'est déjà le cas derrière le reverse-proxy.

**Fiabilité honnête.** Bonne sur Android. Correcte sur iPhone **installé** et
à jour, mais chaque téléphone est un abonnement à entretenir, et les pannes
sont muettes : quand un rappel n'arrive pas, ni vous ni moi ne pouvons voir
pourquoi, Apple ne rend aucun compte. C'est précisément le mode de panne que
le brief refuse.

### B. Canal sortant vers Home Assistant (webhook) : recommandé

Le backend fait un `POST` JSON vers une adresse configurée. Home Assistant
expose des **webhooks** (`/api/webhook/<identifiant>`) qui déclenchent une
automation ; l'automation lit le JSON (`trigger.json`) et appelle
`notify.mobile_app_<téléphone>` : la notification part par l'application
compagnon, native, qui marche déjà sur vos téléphones.

```yaml
# Home Assistant, automations.yaml : un webhook, une notification par membre
- alias: "Foyer : tâches"
  trigger:
    - platform: webhook
      webhook_id: foyer-taches-<un-identifiant-long-et-aleatoire>
      allowed_methods: [POST]
      local_only: true            # false si Foyer et HA ne sont pas sur le même réseau
  action:
    - choose:
        - conditions: "{{ trigger.json.member == 'me' }}"
          sequence:
            - service: notify.mobile_app_iphone_de_thomas
              data:
                title: "{{ trigger.json.title }}"
                message: "{{ trigger.json.body }}"
                data: { url: "{{ trigger.json.url }}" }
        - conditions: "{{ trigger.json.member == 'm1' }}"
          sequence:
            - service: notify.mobile_app_iphone_de_marie
              data:
                title: "{{ trigger.json.title }}"
                message: "{{ trigger.json.body }}"
                data: { url: "{{ trigger.json.url }}" }
```

Côté Foyer, deux variables et rien d'autre :

```bash
FOYER_NOTIFY_URL=http://homeassistant.local:8123/api/webhook/foyer-taches-<identifiant>
FOYER_NOTIFY_TOKEN=            # facultatif : envoyé en Authorization: Bearer, pour ntfy, Gotify, n8n…
```

Et ce qui part, à chaque rappel ou affectation, en un seul appel par membre :

```json
{
  "kind": "reminder",                     // ou "assigned"
  "member": "m1", "memberName": "Marie",
  "title": "Rappel : Rappeler le plombier",
  "body": "Aujourd’hui à 18:00 · Maison",
  "url": "https://foyer.exemple.fr/#taches",
  "taskId": "t2", "due": "2026-09-05", "time": "18:00"
}
```

**Pourquoi c'est l'option fiable.** La livraison sur le téléphone est faite
par une application native déjà installée, par le mécanisme d'Apple que HA
maîtrise. Quand un rappel n'arrive pas, tout se lit : le journal de Foyer
dit si le `POST` est parti et ce que HA a répondu, le journal de HA dit si
l'automation a tourné, et l'application compagnon a son propre diagnostic.
Chaque maillon est une chose que vous savez déjà exploiter.

**Pourquoi c'est l'option légère.** Aucune dépendance nouvelle (le `fetch`
de Node suffit), aucun service worker, aucun abonnement par appareil à
entretenir : ajouter un téléphone est une ligne dans l'automation, pas une
manipulation sur le téléphone. Le mappage membre → téléphone vit dans HA,
là où les téléphones sont déjà connus.

**Ses limites, franchement.**

- Home Assistant doit être joignable depuis le conteneur Foyer. Sur le même
  réseau, `local_only: true` suffit et rien ne transite dehors. Sinon, il
  faut exposer le webhook en HTTPS et l'identifiant est le seul secret : un
  identifiant long et aléatoire, comme un jeton.
- Si HA est arrêté au moment du rappel, le rappel est **perdu pour le
  téléphone** (trois tentatives espacées, puis abandon avec une ligne de
  journal et une entrée dans le centre in-app). Foyer ne fait pas de file
  de réexpédition sur des heures : un rappel de 18 h reçu à 23 h ne sert
  plus à rien, et une file qui déverse au réveil est pire que rien.
- Le format est le nôtre. Il est générique (JSON, un jeton facultatif) pour
  servir aussi ntfy, Gotify ou n8n, mais ce n'est pas un standard.

### C. Courriel ou SMS

Non retenu : un courriel n'est pas une notification sur un téléphone, et ça
ajoute une dépendance SMTP et un compte d'envoi à entretenir. Si un jour un
membre n'a ni compagnon HA ni web app installée, ce sera la question.

### D. Les deux, B d'abord

Le socle de la section 3 est le même pour A et B : le planificateur émet un
événement « rappel pour tel membre », et un canal le livre. Faire B
maintenant ne ferme pas A : le web push viendrait comme second canal, avec
la tranche PWA, pour un membre sans application compagnon. C'est l'ordre que
je recommande.

## 5. Ce que vous verrez à l'écran

- **Dans le composeur**, panneau « Date » : à côté de l'heure, un réglage
  « Rappel » (Aucun, À l'heure, 1 h avant, La veille à 18 h, Le matin à 9 h).
  Sans date, pas de rappel possible, et le réglage le dit.
- **Sur la ligne** de la tâche, une petite cloche quand un rappel est réglé.
- **Dans Paramètres, section Notifications** : l'état du canal (« Home
  Assistant, configuré » ou « aucun canal : les rappels restent dans
  l'application »), la date du dernier envoi réussi, la dernière erreur en
  clair, et « Envoyer un test » par membre, qui envoie une vraie notification
  et affiche la réponse.
- **Dans la cloche**, les rappels émis, qu'ils soient partis ou non.

## 6. Ce qui sort, et comment le couper

Sans `FOYER_NOTIFY_URL`, aucune requête ne part, jamais. Avec, ce qui part
est le JSON ci-dessus : l'intitulé de la tâche, l'échéance, le membre, une
adresse pour ouvrir l'application. Pas de note, pas de liste, pas de
document. Délai de 5 s par appel, trois tentatives à 30 s, puis abandon
journalisé. Retirer la variable et redémarrer coupe tout.

## 7. Exploitation

```bash
# LXC : /etc/foyer/foyer.env, puis systemctl restart foyer
# Docker : docker-compose.yml, environment, puis docker compose up -d

# Tester le webhook HA sans passer par Foyer (même JSON que Foyer enverra)
curl -s -X POST "$FOYER_NOTIFY_URL" -H 'Content-Type: application/json' \
  -d '{"kind":"test","member":"me","memberName":"Thomas","title":"Test Foyer","body":"Si vous lisez ceci, le canal marche.","url":"https://foyer.exemple.fr/"}'

# Ce que Foyer a envoyé, et ce qu'on lui a répondu
journalctl -u foyer | grep 'Notifications'
sqlite3 /var/lib/foyer/foyer.db "SELECT * FROM hh_notif_sent ORDER BY sent_at DESC LIMIT 20;"
```

## 8. Ce que j'attends de vous

1. **Le canal.** Home Assistant par webhook, comme recommandé (B), le web
   push restant possible plus tard comme second canal (D) ?
2. **Le rappel par défaut.** Aucun, réglé tâche par tâche (recommandé), ou
   « le matin à 9 h » pour toute tâche datée ?
3. **Les tâches sans responsable.** Rappel à tous les comptes du foyer
   (recommandé), ou à personne ?
4. **L'affectation.** Notifier tout de suite quand quelqu'un d'autre m'affecte
   une tâche (recommandé), ou seulement les rappels ?
5. **Le réseau.** Foyer et Home Assistant sont-ils sur le même réseau (webhook
   en `local_only`), ou faut-il passer par une adresse publique ?

Dès vos réponses, l'implémentation suit : socle, canal, écran Paramètres,
tests du planificateur (heures, fuseau, report, série, redémarrage) et de
l'idempotence des envois, documentation dans `docs/taches.md` et le README.
