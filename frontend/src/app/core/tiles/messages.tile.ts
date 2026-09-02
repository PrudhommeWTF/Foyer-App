import { Message } from '../models';
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface MessagesTileData { msgs: Message[]; }

const SHOWN = 3;

export const messagesTile = {
  id: 'messages',
  title: 'Messagerie',
  screen: 'messages',
  link: 'Ouvrir',
  source: 'document',
  state: (ctx): TileState<MessagesTileData> => fromSource(ctx.doc, (d, asOf) => {
    const msgs = d.msgs || [];
    return msgs.length ? ok({ msgs: msgs.slice(-SHOWN) }, asOf) : empty('Aucun message pour le moment.');
  }),
} satisfies TileProvider<MessagesTileData>;
