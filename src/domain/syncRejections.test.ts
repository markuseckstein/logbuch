import { describe, expect, it } from 'vitest';
import { analyzeSyncExchange, describeRejection, parseSyncJson } from './syncRejections';

const request = {
  changes: [
    { table: 'members', muts: [{ type: 'update', keys: ['mmb1'], changeSpecs: [{ accepted: 1 }], txid: 'tx-a' }] },
    {
      table: 'entries',
      muts: [
        { type: 'insert', keys: ['e1'], values: [{ id: 'e1' }], txid: 'tx-b' },
        { type: 'update', keys: ['e1'], changeSpecs: [{ text: 'x', updatedAt: 2 }], txid: 'tx-b' },
      ],
    },
    { table: 'photos', muts: [{ type: 'insert', keys: ['p1'], values: [{ id: 'p1' }], txid: 'tx-b' }] },
    { table: 'entries', muts: [{ type: 'update', keys: ['e0'], changeSpecs: [{ text: 'y' }], txid: 'tx-c' }] },
  ],
};
const denied = {
  name: 'PermissionsDeniedError',
  message: 'User bob@demo.local (bob@demo.local) is not authorized to add entries in realm rlm~t',
  txid: 'tx-b',
};

describe('analyzeSyncExchange', () => {
  it('maps a rejection to every mutation of its transaction (keys, tables, changed props)', () => {
    const r = analyzeSyncExchange(request, { rejections: [denied] });
    expect(r.rejected).toEqual([
      { table: 'entries', key: 'e1', type: 'insert', props: ['text', 'updatedAt'], reason: denied.message },
      { table: 'photos', key: 'p1', type: 'insert', props: [], reason: denied.message },
    ]);
  });
  it('lists the keys the server took over (all other transactions)', () => {
    const r = analyzeSyncExchange(request, { rejections: [denied] });
    expect(r.accepted).toEqual([{ table: 'members', key: 'mmb1' }, { table: 'entries', key: 'e0' }]);
  });
  it('no rejections: everything accepted, nothing rejected', () => {
    const r = analyzeSyncExchange(request, { rejections: [] });
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(4);
  });
  it('a rejection without txid counts for all mutations (nothing gets lost)', () => {
    const r = analyzeSyncExchange(request, { rejections: [{ name: 'X', message: 'nope' }] });
    expect(r.rejected.map((c) => `${c.table}:${c.key}`)).toEqual(['members:mmb1', 'entries:e1', 'photos:p1', 'entries:e0']);
    expect(r.accepted).toEqual([]);
  });
  it('a key rejected in one transaction is not reported as accepted from another', () => {
    const req = {
      changes: [
        { table: 'entries', muts: [{ type: 'insert', keys: ['e1'], txid: 't1' }] },
        { table: 'entries', muts: [{ type: 'update', keys: ['e1'], changeSpecs: [{ text: 'a' }], txid: 't2' }] },
      ],
    };
    const r = analyzeSyncExchange(req, { rejections: [{ message: 'no', txid: 't1' }] });
    expect(r.rejected.map((c) => c.key)).toEqual(['e1']);
    expect(r.accepted).toEqual([]);
  });
  it('ignores non-string keys and malformed input', () => {
    const req = { changes: [{ table: 'roles', muts: [{ type: 'upsert', keys: [['rlm-public', 'crew']], txid: 't' }] }] };
    expect(analyzeSyncExchange(req, { rejections: [{ txid: 't' }] })).toEqual({ rejected: [], accepted: [] });
    expect(analyzeSyncExchange(undefined, undefined)).toEqual({ rejected: [], accepted: [] });
    expect(analyzeSyncExchange({ changes: 'x' }, { rejections: 'y' })).toEqual({ rejected: [], accepted: [] });
  });
  it('deletes keep their type (no props)', () => {
    const req = { changes: [{ table: 'entries', muts: [{ type: 'delete', keys: ['e1', 'e2'], txid: 't' }] }] };
    expect(analyzeSyncExchange(req, { rejections: [{ message: 'm', txid: 't' }] }).rejected).toEqual([
      { table: 'entries', key: 'e1', type: 'delete', props: [], reason: 'm' },
      { table: 'entries', key: 'e2', type: 'delete', props: [], reason: 'm' },
    ]);
  });
});

describe('parseSyncJson', () => {
  it('parses JSON text (TSON is JSON with $t-tagged values) and tolerates garbage', () => {
    expect(parseSyncJson('{"rejections":[]}')).toEqual({ rejections: [] });
    expect(parseSyncJson('not json')).toBeUndefined();
    expect(parseSyncJson(undefined)).toBeUndefined();
  });
});

describe('describeRejection', () => {
  it('gives a German reason for permission errors', () => {
    expect(describeRejection(denied.message)).toBe('Schreibrechte noch nicht wirksam');
    expect(describeRejection('duplicate key value violates unique constraint "objects_pkey"')).toBe('Datensatz existiert bereits in der Cloud');
    expect(describeRejection('anything else')).toBe('vom Server abgelehnt');
  });
});
