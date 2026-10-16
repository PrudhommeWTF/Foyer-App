// État lu des notifications : la fusion qui survit à un rejeu.
//
// Les identifiants lus sont rangés sur la fiche du membre (members[].readNotifs),
// partagés entre ses appareils. Deux appareils qui lisent en même temps
// provoquent un conflit d'enregistrement : la mutation est rejouée sur la version
// serveur. Si elle REMPLACE la liste par un instantané local, elle efface la
// lecture faite sur l'autre appareil. Elle doit donc faire l'UNION avec ce
// qu'elle trouve au moment où elle s'applique, d'où cette fonction pure, appelée
// dans la closure de mutation (et au rejeu, sur `members[].readNotifs` du serveur).

/**
 * Les identifiants lus après fusion : l'existant (celui trouvé à l'application)
 * uni aux nouveaux, puis restreint aux identifiants encore vivants (`live`) pour
 * que la liste n'enfle pas d'un identifiant par jour sans jamais rien oublier.
 */
export function mergeReadNotifs(existing: readonly string[], add: readonly string[], live: ReadonlySet<string>): string[] {
  const union = new Set(existing);
  for (const id of add) union.add(id);
  return [...union].filter((id) => live.has(id));
}
