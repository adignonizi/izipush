import { expect } from 'chai';

import { adresseAutorisee, analyserAdresse, entreeValide } from './ip-allow-list';

describe('liste d’autorisation d’adresses — analyse', () => {
  it('lit une IPv4 et une IPv6', () => {
    expect(analyserAdresse('203.0.113.7')?.famille).to.equal('v4');
    expect(analyserAdresse('2001:db8::1')?.famille).to.equal('v6');
  });

  /* Les piles réseau rendent couramment cette forme pour une IPv4 arrivée sur une
     socket IPv6. Sans la ramener à sa famille, une liste IPv4 ne reconnaîtrait
     jamais l'appelant — et la restriction refuserait tout le monde. */
  it('ramène une IPv4 encapsulée en IPv6 à sa forme IPv4', () => {
    const lue = analyserAdresse('::ffff:203.0.113.7');

    expect(lue?.famille).to.equal('v4');
    expect(lue?.octets).to.deep.equal(analyserAdresse('203.0.113.7')?.octets);
  });

  it('rejette ce qui n’est pas une adresse', () => {
    for (const texte of ['', '  ', '203.0.113', '203.0.113.256', '1.2.3.4.5', 'localhost', '2001:db8::1::2']) {
      expect(analyserAdresse(texte), texte).to.equal(null);
    }
  });

  /* Un zéro en tête se lit en octal dans trop d'implémentations : `010` vaudrait 8
     ici et 10 ailleurs. Deux lectures d'une même liste ne doivent pas diverger. */
  it('rejette un octet à zéro en tête', () => {
    expect(analyserAdresse('010.0.0.1')).to.equal(null);
  });

  it('valide les entrées de liste, adresse seule ou CIDR', () => {
    for (const bonne of ['203.0.113.7', '203.0.113.0/24', '0.0.0.0/0', '2001:db8::/32', '::1']) {
      expect(entreeValide(bonne), bonne).to.equal(true);
    }
    for (const mauvaise of ['203.0.113.0/33', '203.0.113.0/', '203.0.113.0/24/8', 'pas-une-ip', '2001:db8::/129']) {
      expect(entreeValide(mauvaise), mauvaise).to.equal(false);
    }
  });
});

describe('liste d’autorisation d’adresses — décision', () => {
  /* Le défaut qui compte : la restriction est une option. Un champ vide — ou absent,
     pour les environnements créés avant la fonctionnalité — ne doit couper personne. */
  it('une liste vide ou absente autorise tout', () => {
    expect(adresseAutorisee('203.0.113.7', [])).to.equal(true);
    expect(adresseAutorisee('203.0.113.7', undefined)).to.equal(true);
    expect(adresseAutorisee('203.0.113.7', ['  ', ''])).to.equal(true);
  });

  it('autorise une adresse exacte, refuse ses voisines', () => {
    expect(adresseAutorisee('203.0.113.7', ['203.0.113.7'])).to.equal(true);
    expect(adresseAutorisee('203.0.113.8', ['203.0.113.7'])).to.equal(false);
  });

  it('autorise selon le préfixe CIDR', () => {
    expect(adresseAutorisee('203.0.113.200', ['203.0.113.0/24'])).to.equal(true);
    expect(adresseAutorisee('203.0.114.1', ['203.0.113.0/24'])).to.equal(false);
    expect(adresseAutorisee('198.51.100.9', ['0.0.0.0/0'])).to.equal(true);
  });

  /* `203.0.113.7/24` est ce qu'on écrit en se trompant. Sans effacer les bits d'hôte,
     la règle n'autoriserait jamais rien, et le symptôme serait « ma liste ne marche
     pas » sans rien pour l'expliquer. */
  it('ignore les bits d’hôte d’une base CIDR mal écrite', () => {
    expect(adresseAutorisee('203.0.113.200', ['203.0.113.7/24'])).to.equal(true);
  });

  it('prend la bonne entrée dans une liste de plusieurs', () => {
    const liste = ['198.51.100.0/24', '203.0.113.7', '2001:db8::/32'];

    expect(adresseAutorisee('198.51.100.42', liste)).to.equal(true);
    expect(adresseAutorisee('203.0.113.7', liste)).to.equal(true);
    expect(adresseAutorisee('2001:db8:1::9', liste)).to.equal(true);
    expect(adresseAutorisee('192.0.2.1', liste)).to.equal(false);
  });

  /* Les familles ne se mélangent pas : autoriser tout l'IPv4 n'autorise pas l'IPv6. */
  it('ne franchit pas la frontière entre familles', () => {
    expect(adresseAutorisee('2001:db8::1', ['0.0.0.0/0'])).to.equal(false);
    expect(adresseAutorisee('203.0.113.7', ['::/0'])).to.equal(false);
  });

  /* Si on ne sait pas d'où vient l'appel, on ne peut pas affirmer qu'il est autorisé.
     Une liste d'autorisation qui laisse passer l'inconnu n'en est pas une. */
  it('refuse une adresse illisible ou absente dès qu’une liste existe', () => {
    expect(adresseAutorisee(undefined, ['203.0.113.0/24'])).to.equal(false);
    expect(adresseAutorisee('pas-une-ip', ['203.0.113.0/24'])).to.equal(false);
  });

  /* Mais une entrée fautive ne doit pas emporter les entrées correctes avec elle :
     une faute de frappe dans la liste ne doit pas devenir une panne d'accès. */
  it('ignore une entrée illisible sans invalider les autres', () => {
    expect(adresseAutorisee('203.0.113.7', ['pas-une-ip', '203.0.113.0/24'])).to.equal(true);
    expect(adresseAutorisee('198.51.100.1', ['pas-une-ip'])).to.equal(false);
  });
});
