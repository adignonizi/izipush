/**
 * Correspondance d'une adresse IP à une liste d'autorisation.
 *
 * Écrit ici plutôt que pris d'une bibliothèque : `ipaddr.js` n'est présent qu'en
 * dépendance transitive d'Express, et s'appuyer sur un paquet qu'on ne déclare pas est
 * une panne qui attend une montée de version. Le besoin tient en une centaine de lignes
 * et il est entièrement couvert par des tests.
 *
 * Les adresses sont représentées en **tableaux d'octets** — quatre pour IPv4, seize pour
 * IPv6 — et non en entiers. Un entier de 128 bits demanderait `BigInt`, dont les
 * littéraux exigent une cible ES2020 ; l'API compile en ES6. Comparer octet par octet
 * évite la question, et se lit mieux qu'un décalage de masque.
 *
 * IPv4 et IPv6 sont tous deux gérés, en notation simple (`203.0.113.7`) ou CIDR
 * (`203.0.113.0/24`). Les familles ne se mélangent jamais : une entrée IPv4 ne peut pas
 * autoriser une adresse IPv6, et réciproquement — sauf pour les adresses IPv4
 * encapsulées en IPv6 (`::ffff:203.0.113.7`), que les piles réseau produisent
 * couramment et qui sont donc ramenées à leur forme IPv4.
 */

type Famille = 'v4' | 'v6';
type Adresse = { famille: Famille; octets: number[] };

/** Préfixe que les piles réseau posent devant une IPv4 vue par une socket IPv6. */
const IPV4_EN_IPV6 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

function analyserIpv4(texte: string): number[] | null {
  const morceaux = texte.split('.');
  if (morceaux.length !== 4) return null;

  const octets: number[] = [];
  for (const morceau of morceaux) {
    // `Number('')` vaut 0 et `Number(' 7')` vaut 7 : on exige des chiffres. Et pas de
    // zéro en tête, qui se lit en octal dans trop d'implémentations — `010` vaudrait 8
    // ici et 10 ailleurs, et deux lectures d'une même liste divergeraient.
    if (!/^(0|[1-9]\d{0,2})$/.test(morceau)) return null;
    const octet = Number(morceau);
    if (octet > 255) return null;
    octets.push(octet);
  }

  return octets;
}

function analyserIpv6(texte: string): number[] | null {
  const parties = texte.split('::');
  if (parties.length > 2) return null;

  const lire = (bloc: string): string[] | null => {
    if (bloc === '') return [];
    const groupes = bloc.split(':');

    return groupes.every((g) => /^[0-9a-f]{1,4}$/i.test(g)) ? groupes : null;
  };

  const gauche = lire(parties[0]);
  const droite = lire(parties[1] ?? '');
  if (!gauche || !droite) return null;

  const manquants = 8 - (gauche.length + droite.length);
  // Sans `::`, il faut exactement huit groupes ; avec, il doit en combler au moins un.
  if (parties.length === 1 ? manquants !== 0 : manquants < 1) return null;

  const groupes = [...gauche, ...Array<string>(manquants).fill('0'), ...droite];

  const octets: number[] = [];
  for (const groupe of groupes) {
    const valeur = parseInt(groupe, 16);
    octets.push((valeur >> 8) & 0xff, valeur & 0xff);
  }

  return octets;
}

/** Analyse une adresse, en ramenant une IPv4 encapsulée à sa forme IPv4. */
export function analyserAdresse(texte: string): Adresse | null {
  const propre = texte.trim();
  if (!propre) return null;

  const encapsulee = IPV4_EN_IPV6.exec(propre);
  const candidat = encapsulee ? encapsulee[1] : propre;

  if (candidat.includes(':')) {
    const octets = analyserIpv6(candidat);

    return octets === null ? null : { famille: 'v6', octets };
  }

  const octets = analyserIpv4(candidat);

  return octets === null ? null : { famille: 'v4', octets };
}

type Regle = { famille: Famille; base: number[]; prefixe: number };

/**
 * Analyse une entrée de liste d'autorisation : adresse seule ou notation CIDR.
 *
 * Une adresse seule équivaut au préfixe le plus étroit de sa famille — /32 ou /128.
 */
export function analyserRegle(entree: string): Regle | null {
  const propre = entree.trim();
  if (!propre) return null;

  const [adresseTexte, prefixeTexte, ...reste] = propre.split('/');
  if (reste.length > 0) return null;

  const adresse = analyserAdresse(adresseTexte);
  if (!adresse) return null;

  const bits = adresse.octets.length * 8;
  let prefixe = bits;
  if (prefixeTexte !== undefined) {
    if (!/^\d{1,3}$/.test(prefixeTexte)) return null;
    prefixe = Number(prefixeTexte);
    if (prefixe > bits) return null;
  }

  return { famille: adresse.famille, base: adresse.octets, prefixe };
}

/** Vrai si l'entrée est une adresse ou un CIDR exploitable. */
export function entreeValide(entree: string): boolean {
  return analyserRegle(entree) !== null;
}

/**
 * Compare deux adresses sur leurs `prefixe` premiers bits.
 *
 * Les deux côtés sont masqués, et non seulement l'adresse testée : `203.0.113.7/24` se
 * comporte ainsi comme `203.0.113.0/24`. Sans ça, cette entrée — qu'on écrit en se
 * trompant — n'autoriserait jamais rien, et le symptôme serait « ma liste ne marche
 * pas » sans rien pour l'expliquer.
 */
function memePrefixe(octets: number[], base: number[], prefixe: number): boolean {
  const pleins = prefixe >> 3;
  for (let i = 0; i < pleins; i += 1) {
    if (octets[i] !== base[i]) return false;
  }

  const bitsRestants = prefixe & 7;
  if (bitsRestants === 0) return true;

  const masque = (0xff << (8 - bitsRestants)) & 0xff;

  return (octets[pleins] & masque) === (base[pleins] & masque);
}

/**
 * Décide si une adresse est autorisée.
 *
 * **Une liste vide autorise tout.** C'est volontaire : la restriction est une option, et
 * un champ laissé vide ne doit pas couper l'accès de ceux qui ne s'en servent pas.
 *
 * Une adresse illisible est REFUSÉE dès lors qu'une liste existe. Si on ne sait pas d'où
 * vient l'appel, on ne peut pas affirmer qu'il est autorisé — et une liste
 * d'autorisation qui laisse passer l'inconnu n'en est pas une. Une entrée illisible dans
 * la liste, elle, est simplement ignorée : elle n'autorise rien, mais elle ne doit pas
 * invalider les entrées correctes à côté d'elle, sans quoi une faute de frappe
 * deviendrait une panne d'accès.
 */
export function adresseAutorisee(adresseTexte: string | undefined, liste: string[] | undefined): boolean {
  const entrees = (liste ?? []).map((e) => e.trim()).filter((e) => e !== '');
  if (entrees.length === 0) return true;

  const adresse = adresseTexte ? analyserAdresse(adresseTexte) : null;
  if (!adresse) return false;

  for (const entree of entrees) {
    const regle = analyserRegle(entree);
    if (!regle || regle.famille !== adresse.famille) continue;
    if (memePrefixe(adresse.octets, regle.base, regle.prefixe)) return true;
  }

  return false;
}
