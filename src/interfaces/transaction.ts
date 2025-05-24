import {
  PaymentMethodType,
  TransactionStatus,
  TransactionType,
} from '../types/enums/TransactionEnums';

export interface ITransaction {
  id: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  senderId: string;
  receiverId: string;
  amount: number;
  currency: string;
  destinationAmount?: number;
  destinationCurrency?: string;
  timestamp: string;
  description?: string;
  deviceId?: string;
  deviceInfo?: {
    ipAddress?: string;
    geolocation?: {
      country?: string;
      state?: string;
    };
  };
  paymentMethod?: PaymentMethodType;
}
