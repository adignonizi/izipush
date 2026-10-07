import {
  applyEmailTracking,
  buildClickUrl,
  signOpenToken,
  signUnsubscribeToken,
  verifyClickToken,
  verifyOpenToken,
  verifyUnsubscribeToken,
} from '@novu/dal';
import { expect } from 'chai';

const secret = 'secret-de-test';
const environmentId = '68c0000000000000000000a1';
const messageId = '68c0000000000000000000b2';
const publicApiUrl = 'https://izipush.example.com';
const target = { environmentId, messageId };

describe('jetons de suivi', () => {
  it('un jeton d’ouverture se relit', () => {
    expect(verifyOpenToken(secret, signOpenToken(secret, target))).to.deep.equal(target);
  });

  it('un jeton de clic transporte la destination, y compris ses deux-points', () => {
    const url = 'https://izichange.com/offre?a=1&b=2';

    expect(verifyClickToken(secret, signClick(url))).to.deep.equal({ ...target, url });
  });

  it('un jeton signé avec un autre secret est rejeté', () => {
    expect(verifyOpenToken('autre-secret', signOpenToken(secret, target))).to.equal(null);
  });

  it('une charge modifiée est rejetée', () => {
    const [, signature] = signOpenToken(secret, target).split('.');
    const forged = `${Buffer.from(`${environmentId}:deadbeef`).toString('base64url')}.${signature}`;

    expect(verifyOpenToken(secret, forged)).to.equal(null);
  });

  it('un jeton d’ouverture ne peut pas servir de jeton de clic, ni l’inverse', () => {
    expect(verifyClickToken(secret, signOpenToken(secret, target))).to.equal(null);
    expect(verifyOpenToken(secret, signClick('https://izichange.com'))).to.equal(null);
  });

  it('un jeton de suivi ne peut pas servir de jeton de désinscription, ni l’inverse', () => {
    expect(verifyUnsubscribeToken(secret, signOpenToken(secret, target))).to.equal(null);
    expect(verifyOpenToken(secret, signUnsubscribeToken(secret, { environmentId, subscriberId: 'u-1' }))).to.equal(
      null
    );
  });

  it('une destination qui n’est pas une adresse web est refusée', () => {
    const forged = signClick('javascript:alert(1)' as string);

    expect(verifyClickToken(secret, forged)).to.equal(null);
  });

  function signClick(url: string) {
    const built = buildClickUrl(publicApiUrl, secret, { ...target, url });

    return decodeURIComponent(built.slice(built.indexOf('?t=') + 3));
  }
});

describe('applyEmailTracking', () => {
  const unsubscribeUrl = 'https://izipush.example.com/v1/crm/public/unsubscribe?token=abc';
  const options = { ...target, publicApiUrl, secret, unsubscribeUrl };

  it('réécrit les liens et ajoute le pixel avant la fermeture du corps', () => {
    const html = `<html><body><a href="https://izichange.com/offre">Voir</a></body></html>`;
    const out = applyEmailTracking(html, options);

    expect(out).to.not.contain('href="https://izichange.com/offre"');
    expect(out).to.contain('/v1/crm/public/click?t=');
    expect(out.indexOf('/v1/crm/public/open.gif')).to.be.greaterThan(-1);
    expect(out.indexOf('open.gif')).to.be.lessThan(out.indexOf('</body>'));
  });

  it('la destination réécrite est bien celle d’origine', () => {
    const out = applyEmailTracking(`<a href="https://izichange.com/offre?x=1">Voir</a>`, options);
    const token = decodeURIComponent(/click\?t=([^"&]+)/.exec(out.replace(/&amp;/g, '&'))?.[1] ?? '');

    expect(verifyClickToken(secret, token)?.url).to.equal('https://izichange.com/offre?x=1');
  });

  it('ne touche jamais au lien de désinscription', () => {
    const out = applyEmailTracking(`<a href="${unsubscribeUrl}">Se désinscrire</a>`, options);

    expect(out).to.contain(`href="${unsubscribeUrl}"`);
  });

  it('laisse mailto, tel et les ancres tels quels', () => {
    const html = `<a href="mailto:a@b.c">M</a><a href="tel:+225">T</a><a href="#bas">A</a>`;

    expect(applyEmailTracking(html, options)).to.contain(html);
  });

  it('un rendu rejoué ne s’empile pas', () => {
    const once = applyEmailTracking(`<body><a href="https://izichange.com">Voir</a></body>`, options);
    const twice = applyEmailTracking(once, options);

    expect(count(twice, '/click?t=')).to.equal(count(once, '/click?t='));
  });

  it('sans secret ni URL publique, l’email part inchangé', () => {
    const html = `<body><a href="https://izichange.com">Voir</a></body>`;

    expect(applyEmailTracking(html, { ...options, secret: '' })).to.equal(html);
    expect(applyEmailTracking(html, { ...options, publicApiUrl: '' })).to.equal(html);
  });

  function count(value: string, needle: string): number {
    return value.split(needle).length - 1;
  }
});
