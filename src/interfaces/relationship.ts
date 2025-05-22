import { ITransaction } from "./transaction";
import { IUser } from "./user";

// User relationship interfaces
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

// Transaction relationship interfaces
export interface ISharedAttributeRelation {
  relationshipType: string;
  transaction: Partial<ITransaction>;
}

export interface ITransactionConnections {
  sender: Partial<IUser>;
  receiver: Partial<IUser>;
  sharedDeviceTransactions: ISharedAttributeRelation[];
  sharedIPTransactions: ISharedAttributeRelation[];
}
