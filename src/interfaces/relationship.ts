import { ITransaction } from "./transaction";
import { IUser } from "./user";

export interface IDirectRelationship {
  relationshipType: string;
  user: Partial<IUser>;
}

export interface IConnectedTransactionInfo {
  transaction: ITransaction;
  relatedUser?: Partial<IUser>;
}


export interface IUserConnections {
  directRelationships: IDirectRelationship[];
  sentTransactions: IConnectedTransactionInfo[];
  transactionRelationships: IDirectRelationship[];
  receivedTransactions: IConnectedTransactionInfo[];
}
