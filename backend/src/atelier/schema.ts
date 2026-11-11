// Schéma du module « Atelier code ». Relationnel, tables `atl_*`, hors du
// document du foyer : un projet est un JSON de plusieurs dizaines de kilo-octets
// réécrit toutes les trente secondes pendant qu'un enfant travaille, et deux
// enfants travaillent en même temps sur deux appareils.
//
// Le projet est gardé **au format de son éditeur**, sans y toucher : le serveur
// en valide la taille et la forme générale, pas le sens. C'est ce qui laisse
// deux éditeurs (`level`) partager les mêmes tables, et un fichier de projet
// d'origine redevenir importable un jour.
//
// Rien n'est supprimé par un enfant : « supprimer » pose `archived_at`. La purge
// (voir repo.ts) ne retire qu'après le délai du réglage `atelierCorbeilleJours`.
//
// Migrations versionnées comme les autres modules : on ajoute, on ne modifie
// jamais une migration livrée.
import type { Database } from 'better-sqlite3';
import { Migration, runMigrations } from '../storage/migrate';

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    label: 'tables du module Atelier code',
    up: (db) => {
      db.exec(`
        -- Un projet. L'identifiant est un uuid donné par le serveur. version : un
        -- compteur que chaque enregistrement doit présenter et que le serveur
        -- incrémente, pour que deux appareils ne s'écrasent jamais en silence.
        -- thumbnail_json : la vignette telle que l'éditeur la décrit
        -- ({pagecount, md5}), md5 étant le nom d'un média du même membre.
        CREATE TABLE atl_projects (
          id TEXT PRIMARY KEY,
          member_id TEXT NOT NULL,
          level TEXT NOT NULL,
          name TEXT NOT NULL,
          json TEXT,
          thumbnail_json TEXT,
          editor_version TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          is_sample INTEGER NOT NULL DEFAULT 0,
          copied_from TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        );
        CREATE INDEX idx_atl_projects_member ON atl_projects(member_id, archived_at, updated_at);

        -- Un fichier d'un membre (dessin en SVG, vignette en PNG). name est la clé
        -- que les projets citent : <empreinte md5>.<extension>, calculée par le
        -- serveur sur le contenu qu'il a lui-même nettoyé. Les octets sont une
        -- ligne de hh_attachments (genre gardé « atelier »), donc un fichier sur
        -- le disque, dédoublonné par empreinte.
        CREATE TABLE atl_media (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id TEXT NOT NULL,
          name TEXT NOT NULL,
          mime TEXT NOT NULL,
          size INTEGER NOT NULL,
          file_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (member_id, name)
        );

        -- « Mes personnages » et « mes décors » : ce que l'enfant a dessiné et
        -- retrouve d'un projet à l'autre. md5 et altmd5 nomment deux médias du
        -- membre (le dessin et sa vignette).
        CREATE TABLE atl_assets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          md5 TEXT NOT NULL,
          altmd5 TEXT,
          name TEXT,
          scale TEXT,
          width TEXT,
          height TEXT,
          ext TEXT,
          editor_version TEXT,
          created_at TEXT NOT NULL,
          archived_at TEXT
        );
        CREATE INDEX idx_atl_assets_member ON atl_assets(member_id, kind, archived_at);
      `);
    },
  },
];

/** Met le schéma du module à jour. Idempotent, chaque migration dans sa propre transaction. */
export function migrateAtelier(db: Database): number {
  return runMigrations(db, {
    metaTable: 'atl_meta',
    label: 'Atelier code',
    restoreHint: 'Restaurez votre sauvegarde si nécessaire (voir docs/sauvegarde-restauration.md) et signalez l’erreur.',
    migrations: MIGRATIONS,
  });
}
