// izipush-crm — mjml-browser n'embarque pas ses types : seul l'appel utilisé par l'éditeur de templates est décrit.
// Depuis MJML 5, la conversion est asynchrone : toujours attendre le résultat.
declare module 'mjml-browser' {
  type MjmlError = { line: number; message: string; tagName: string; formattedMessage: string };
  type MjmlResult = { html: string; errors: MjmlError[] };

  export default function mjml2html(
    mjml: string,
    options?: { validationLevel?: 'strict' | 'soft' | 'skip'; minify?: boolean }
  ): Promise<MjmlResult> | MjmlResult;
}
