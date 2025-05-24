import { PaymentMethodType } from '../types/enums/UserEnums';

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
