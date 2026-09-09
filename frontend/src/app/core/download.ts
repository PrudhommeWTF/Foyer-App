// Un seul geste « télécharger un blob » pour toute l'application.
//
// La révocation est différée : au retour du clic, Safari n'a pas encore commencé
// le téléchargement, et révoquer l'URL tout de suite l'annule. Deux secondes
// suffisent, et l'onglet ne garde pas l'URL indéfiniment.
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
