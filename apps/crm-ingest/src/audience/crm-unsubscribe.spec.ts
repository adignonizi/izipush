import { buildUnsubscribeUrl, signUnsubscribeToken, verifyUnsubscribeToken } from '@novu/dal';
import { expect } from 'chai';

const target = { environmentId: '6a622cdc8af82a48a945cd37', subscriberId: 'usr:abc 123' };

describe('lien de désinscription', () => {
  it('un jeton signé se vérifie et rend le client', () => {
    expect(verifyUnsubscribeToken('secret', signUnsubscribeToken('secret', target))).to.deep.equal(target);
  });

  it('refuse un jeton modifié, signé avec un autre secret, ou sans secret configuré', () => {
    const token = signUnsubscribeToken('secret', target);
    const forged = `${Buffer.from(`${target.environmentId}:autre`).toString('base64url')}.${token.split('.')[1]}`;

    expect(verifyUnsubscribeToken('secret', forged)).to.equal(null);
    expect(verifyUnsubscribeToken('autre-secret', token)).to.equal(null);
    expect(verifyUnsubscribeToken('', token)).to.equal(null);
    expect(verifyUnsubscribeToken('secret', 'pas-un-jeton')).to.equal(null);
  });

  it('construit une URL publique utilisable telle quelle', () => {
    const url = buildUnsubscribeUrl('https://izipush.example.com/api/', 'secret', target);
    const token = decodeURIComponent(new URL(url).searchParams.get('token') as string);

    expect(url.startsWith('https://izipush.example.com/api/v1/crm/public/unsubscribe?token=')).to.equal(true);
    expect(verifyUnsubscribeToken('secret', token)).to.deep.equal(target);
  });
});
