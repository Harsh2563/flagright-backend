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

export interface ITransactionSearchFilters {
  transactionType?: TransactionType;
  status?: TransactionStatus;
  senderId?: string;
  receiverId?: string;
  currency?: string;
  paymentMethod?: PaymentMethodType;
  amountMin?: number;
  amountMax?: number;
  createdAfter?: string;
  createdBefore?: string;
}

export interface ITransactionSearchQuery {
  searchText?: string;
  page: number;
  limit: number;
  sortBy:
    | 'timestamp'
    | 'amount'
    | 'status'
    | 'transactionType'
    | 'currency'
    | 'createdAt';
  sortOrder: 'asc' | 'desc';
  filters: ITransactionSearchFilters;
}

export interface ITransactionSearchResult {
  transactions: any[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalTransactions: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}
