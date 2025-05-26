import { PaymentMethodType } from '../types/enums/UserEnums';

export interface IUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  paymentMethods?: Array<{
    id: string;
    type: PaymentMethodType;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface IPathNode {
  type: 'User' | 'Transaction';
  properties: any;
}

export interface IPathRelationship {
  type: 'SENT' | 'RECEIVED_BY';
  startNodeId: string;
  endNodeId: string;
}

export interface IShortestPathResult {
  path: {
    nodes: IPathNode[];
    relationships: IPathRelationship[];
  };
  length: number;
}

export interface IUserSearchFilters {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  paymentMethodTypes?: PaymentMethodType[];
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
}

export interface IUserSearchQuery {
  searchText?: string;
  page: number;
  limit: number;
  sortBy: 'firstName' | 'lastName' | 'email' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
  filters: IUserSearchFilters;
}

export interface IUserSearchResult {
  users: any[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalUsers: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface ISearchableFields {
  name: string;
  value: string;
}
