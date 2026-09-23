/** Reponses de l'API Elastic Email v4 (https://api.elasticemail.com/v4). */
export interface IElasticEmailSendResponse {
  MessageID?: string;
  TransactionID?: string;
}

export interface IElasticEmailErrorResponse {
  Error?: string;
  error?: string;
}
