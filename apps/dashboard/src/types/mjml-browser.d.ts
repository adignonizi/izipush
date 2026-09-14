// izipush-crm — mjml-browser n'embarque pas ses types : seul l'appel utilisé par l'éditeur de templates est décrit.
declare module 'mjml-browser' {
  type MjmlError = { line: number; message: string; tagName: string; formattedMessage: string };

  export default function mjml2html(
    mjml: string,
    options?: { validationLevel?: 'strict' | 'soft' | 'skip'; minify?: boolean }
  ): { html: string; errors: MjmlError[] };
}
