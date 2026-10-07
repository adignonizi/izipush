/**
 * izipush-crm — templatical charge `pusher-js` uniquement pour ses fonctions cloud (collaboration temps réel),
 * que nous n'utilisons pas. Le paquet n'est pas installé : ce module le remplace et échoue seulement s'il est appelé.
 */
export default class Pusher {
  constructor() {
    throw new Error('pusher-js indisponible : les fonctions cloud de templatical ne sont pas utilisées');
  }
}
